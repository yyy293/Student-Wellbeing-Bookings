const { createClient } = require("@supabase/supabase-js");

function getAdminClient() {
    const url = process.env.SUPABASE_URL;
    const secretKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !secretKey) {
        throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    }

    return createClient(url, secretKey);
}

function getAuthClient() {
    const url = process.env.SUPABASE_URL;
    const publishableKey = process.env.SUPABASE_ANON_KEY;

    if (!url || !publishableKey) {
        throw new Error("Missing SUPABASE_URL or SUPABASE_ANON_KEY");
    }

    return createClient(url, publishableKey);
}

async function getOperator(req) {
    const authorization = req.headers.authorization || "";

    if (!authorization.startsWith("Bearer ")) {
        return null;
    }

    const token = authorization.slice(7).trim();

    if (!token) {
        return null;
    }

    const authClient = getAuthClient();

    const { data: userData, error: userError } =
        await authClient.auth.getUser(token);

    if (userError || !userData.user) {
        return null;
    }

    const admin = getAdminClient();

    const { data: operator, error: operatorError } = await admin
        .from("operator_users")
        .select("user_id")
        .eq("user_id", userData.user.id)
        .maybeSingle();

    if (operatorError || !operator) {
        return null;
    }

    return userData.user;
}

function send(res, status, data) {
    res.status(status).json(data);
}

module.exports = async function handler(req, res) {
    try {
        const admin = getAdminClient();

        if (req.method === "GET") {
            const action = req.query.action;

            if (action === "availability") {
                const { data, error } = await admin
                    .from("availability")
                    .select("day_number, day_name, is_closed")
                    .order("day_number");

                if (error) {
                    return send(res, 500, {
                        error: error.message
                    });
                }

                return send(res, 200, data || []);
            }

            if (action === "check") {
                const user = await getOperator(req);

                if (!user) {
                    return send(res, 401, {
                        error: "Not authorized"
                    });
                }

                return send(res, 200, {
                    authorized: true
                });
            }

            if (action === "bookings") {
                const user = await getOperator(req);

                if (!user) {
                    return send(res, 401, {
                        error: "Not authorized"
                    });
                }

                const { data, error } = await admin
                    .from("bookings")
                    .select(
                        "id, booking_code, student_name, student_class, session_type, booking_date, booking_time, student_message, status, created_at"
                    )
                    .order("booking_date", {
                        ascending: true
                    })
                    .order("booking_time", {
                        ascending: true
                    });

                if (error) {
                    return send(res, 500, {
                        error: error.message
                    });
                }

                return send(res, 200, data || []);
            }

            return send(res, 400, {
                error: "Invalid action"
            });
        }

        if (req.method === "PUT") {
            const user = await getOperator(req);

            if (!user) {
                return send(res, 401, {
                    error: "Not authorized"
                });
            }

            const action = req.query.action;

            if (action === "status") {
                const { id, status } = req.body || {};

                if (!id || !["Approved", "Cancelled"].includes(status)) {
                    return send(res, 400, {
                        error: "Invalid booking update"
                    });
                }

                if (status === "Approved") {
                    const { data: booking, error: bookingError } =
                        await admin
                            .from("bookings")
                            .select("booking_date, booking_time")
                            .eq("id", id)
                            .maybeSingle();

                    if (bookingError) {
                        return send(res, 500, {
                            error: bookingError.message
                        });
                    }

                    if (!booking) {
                        return send(res, 404, {
                            error: "Booking not found"
                        });
                    }

                    const { data: conflict, error: conflictError } =
                        await admin
                            .from("bookings")
                            .select("id")
                            .eq("booking_date", booking.booking_date)
                            .eq("booking_time", booking.booking_time)
                            .eq("status", "Approved")
                            .neq("id", id)
                            .maybeSingle();

                    if (conflictError) {
                        return send(res, 500, {
                            error: conflictError.message
                        });
                    }

                    if (conflict) {
                        return send(res, 409, {
                            error: "Another approved booking already uses this time."
                        });
                    }
                }

                const { error } = await admin
                    .from("bookings")
                    .update({
                        status
                    })
                    .eq("id", id);

                if (error) {
                    return send(res, 500, {
                        error: error.message
                    });
                }

                return send(res, 200, {
                    success: true
                });
            }

            if (action === "availability") {
                const { day_number, is_closed } = req.body || {};

                if (
                    !Number.isInteger(day_number) ||
                    day_number < 0 ||
                    day_number > 6
                ) {
                    return send(res, 400, {
                        error: "Invalid day"
                    });
                }

                const { error } = await admin
                    .from("availability")
                    .update({
                        is_closed: Boolean(is_closed)
                    })
                    .eq("day_number", day_number);

                if (error) {
                    return send(res, 500, {
                        error: error.message
                    });
                }

                return send(res, 200, {
                    success: true
                });
            }

            return send(res, 400, {
                error: "Invalid action"
            });
        }

        return send(res, 405, {
            error: "Method not allowed"
        });
    } catch (error) {
        console.error(error);

        return send(res, 500, {
            error: error.message || "Server error"
        });
    }
};