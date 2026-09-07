const { createClient } = require("@supabase/supabase-js");

function response(res, status, data) {
    res.status(status).json(data);
}

module.exports = async function handler(req, res) {
    try {
        const url = process.env.SUPABASE_URL;
        const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
        const publishable = process.env.SUPABASE_ANON_KEY;

        if (!url) {
            return response(res, 500, {
                error: "Vercel is missing SUPABASE_URL"
            });
        }

        if (!secret) {
            return response(res, 500, {
                error: "Vercel is missing SUPABASE_SERVICE_ROLE_KEY"
            });
        }

        if (!publishable) {
            return response(res, 500, {
                error: "Vercel is missing SUPABASE_ANON_KEY"
            });
        }

        const admin = createClient(url, secret);

        if (req.method === "GET") {
            const action = req.query.action;

            if (action === "availability") {
                const { data, error } = await admin
                    .from("availability")
                    .select("day_number, day_name, is_closed")
                    .order("day_number");

                if (error) {
                    return response(res, 500, {
                        error: "Supabase availability error: " + error.message
                    });
                }

                return response(res, 200, data || []);
            }

            if (action === "check") {
                const authorization = req.headers.authorization || "";

                if (!authorization.startsWith("Bearer ")) {
                    return response(res, 401, {
                        error: "No operator authorization token"
                    });
                }

                const token = authorization.slice(7);

                const authClient = createClient(url, publishable);

                const { data: userData, error: userError } =
                    await authClient.auth.getUser(token);

                if (userError || !userData.user) {
                    return response(res, 401, {
                        error: "Invalid operator login session"
                    });
                }

                const { data: operator, error: operatorError } =
                    await admin
                        .from("operator_users")
                        .select("user_id")
                        .eq("user_id", userData.user.id)
                        .maybeSingle();

                if (operatorError) {
                    return response(res, 500, {
                        error: "Operator database error: " + operatorError.message
                    });
                }

                if (!operator) {
                    return response(res, 403, {
                        error: "This Supabase user is not an authorized operator"
                    });
                }

                return response(res, 200, {
                    authorized: true
                });
            }

            if (action === "bookings") {
                const authorization = req.headers.authorization || "";

                if (!authorization.startsWith("Bearer ")) {
                    return response(res, 401, {
                        error: "No operator authorization token"
                    });
                }

                const token = authorization.slice(7);
                const authClient = createClient(url, publishable);

                const { data: userData, error: userError } =
                    await authClient.auth.getUser(token);

                if (userError || !userData.user) {
                    return response(res, 401, {
                        error: "Invalid operator login session"
                    });
                }

                const { data: operator, error: operatorError } =
                    await admin
                        .from("operator_users")
                        .select("user_id")
                        .eq("user_id", userData.user.id)
                        .maybeSingle();

                if (operatorError) {
                    return response(res, 500, {
                        error: operatorError.message
                    });
                }

                if (!operator) {
                    return response(res, 403, {
                        error: "Not an authorized operator"
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
                    return response(res, 500, {
                        error: "Supabase bookings error: " + error.message
                    });
                }

                return response(res, 200, data || []);
            }

            return response(res, 400, {
                error: "Invalid action"
            });
        }

        if (req.method === "PUT") {
            const authorization = req.headers.authorization || "";

            if (!authorization.startsWith("Bearer ")) {
                return response(res, 401, {
                    error: "No operator authorization token"
                });
            }

            const token = authorization.slice(7);
            const authClient = createClient(url, publishable);

            const { data: userData, error: userError } =
                await authClient.auth.getUser(token);

            if (userError || !userData.user) {
                return response(res, 401, {
                    error: "Invalid operator login session"
                });
            }

            const { data: operator, error: operatorError } =
                await admin
                    .from("operator_users")
                    .select("user_id")
                    .eq("user_id", userData.user.id)
                    .maybeSingle();

            if (operatorError) {
                return response(res, 500, {
                    error: operatorError.message
                });
            }

            if (!operator) {
                return response(res, 403, {
                    error: "Not an authorized operator"
                });
            }

            const action = req.query.action;

            if (action === "availability") {
                const { day_number, is_closed } = req.body || {};

                const { error } = await admin
                    .from("availability")
                    .update({
                        is_closed: Boolean(is_closed)
                    })
                    .eq("day_number", day_number);

                if (error) {
                    return response(res, 500, {
                        error: "Availability update error: " + error.message
                    });
                }

                return response(res, 200, {
                    success: true
                });
            }

            if (action === "status") {
                const { id, status } = req.body || {};

                if (!id || !["Approved", "Cancelled"].includes(status)) {
                    return response(res, 400, {
                        error: "Invalid booking update"
                    });
                }

                const { error } = await admin
                    .from("bookings")
                    .update({ status })
                    .eq("id", id);

                if (error) {
                    return response(res, 500, {
                        error: "Booking update error: " + error.message
                    });
                }

                return response(res, 200, {
                    success: true
                });
            }

            return response(res, 400, {
                error: "Invalid action"
            });
        }

        return response(res, 405, {
            error: "Method not allowed"
        });

    } catch (error) {
        return response(res, 500, {
            error: "Server error: " + (error.message || "Unknown error")
        });
    }
};