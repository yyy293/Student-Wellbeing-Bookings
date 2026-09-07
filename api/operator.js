const { createClient } = require("@supabase/supabase-js");

const adminClient = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

const authClient = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

async function getOperator(req) {
    const authorization = req.headers.authorization || "";

    if (!authorization.startsWith("Bearer ")) {
        return null;
    }

    const token = authorization.substring(7);

    const { data, error } = await authClient.auth.getUser(token);

    if (error || !data.user) {
        return null;
    }

    const { data: operator, error: operatorError } =
        await adminClient
            .from("operator_users")
            .select("user_id")
            .eq("user_id", data.user.id)
            .maybeSingle();

    if (operatorError || !operator) {
        return null;
    }

    return data.user;
}

module.exports = async function handler(req, res) {
    try {
        if (req.method === "GET") {
            const action = req.query.action;

            if (action === "availability") {
                const { data, error } = await adminClient
                    .from("availability")
                    .select("day_number,day_name,is_closed")
                    .order("day_number");

                if (error) {
                    return res.status(500).json({
                        error: "Unable to load availability."
                    });
                }

                return res.status(200).json({
                    availability: data
                });
            }

            const operator = await getOperator(req);

            if (!operator) {
                return res.status(401).json({
                    error: "Unauthorized."
                });
            }

            if (action === "check") {
                return res.status(200).json({
                    operator: true
                });
            }

            if (action === "bookings") {
                const { data, error } = await adminClient
                    .from("bookings")
                    .select(
                        "id,booking_code,student_name,student_class,session_type,booking_date,booking_time,student_message,status,created_at"
                    )
                    .order("booking_date", {
                        ascending: true
                    })
                    .order("booking_time", {
                        ascending: true
                    });

                if (error) {
                    return res.status(500).json({
                        error: "Unable to load bookings."
                    });
                }

                return res.status(200).json({
                    bookings: data
                });
            }

            return res.status(400).json({
                error: "Invalid action."
            });
        }

        if (req.method === "PUT") {
            const operator = await getOperator(req);

            if (!operator) {
                return res.status(401).json({
                    error: "Unauthorized."
                });
            }

            const body = req.body || {};

            if (body.action === "status") {
                const { id, status } = body;

                if (!id || !["Approved", "Cancelled"].includes(status)) {
                    return res.status(400).json({
                        error: "Invalid booking update."
                    });
                }

                if (status === "Approved") {
                    const { data: booking, error: bookingError } =
                        await adminClient
                            .from("bookings")
                            .select("booking_date,booking_time,status")
                            .eq("id", id)
                            .single();

                    if (bookingError || !booking) {
                        return res.status(404).json({
                            error: "Booking not found."
                        });
                    }

                    const { data: conflict, error: conflictError } =
                        await adminClient
                            .from("bookings")
                            .select("id")
                            .eq("booking_date", booking.booking_date)
                            .eq("booking_time", booking.booking_time)
                            .eq("status", "Approved")
                            .neq("id", id)
                            .maybeSingle();

                    if (conflictError) {
                        return res.status(500).json({
                            error: "Unable to check booking conflict."
                        });
                    }

                    if (conflict) {
                        return res.status(409).json({
                            error: "Another approved booking already uses this time."
                        });
                    }
                }

                const { error } = await adminClient
                    .from("bookings")
                    .update({
                        status
                    })
                    .eq("id", id);

                if (error) {
                    return res.status(500).json({
                        error: "Unable to update booking."
                    });
                }

                return res.status(200).json({
                    success: true
                });
            }

            if (body.action === "availability") {
                if (!Array.isArray(body.days)) {
                    return res.status(400).json({
                        error: "Invalid availability data."
                    });
                }

                for (const day of body.days) {
                    if (
                        !Number.isInteger(day.day_number) ||
                        day.day_number < 0 ||
                        day.day_number > 6 ||
                        typeof day.is_closed !== "boolean"
                    ) {
                        return res.status(400).json({
                            error: "Invalid availability data."
                        });
                    }

                    const { error } = await adminClient
                        .from("availability")
                        .update({
                            is_closed: day.is_closed
                        })
                        .eq("day_number", day.day_number);

                    if (error) {
                        return res.status(500).json({
                            error: "Unable to save availability."
                        });
                    }
                }

                return res.status(200).json({
                    success: true
                });
            }

            return res.status(400).json({
                error: "Invalid action."
            });
        }

        return res.status(405).json({
            error: "Method not allowed."
        });
    } catch (error) {
        return res.status(500).json({
            error: "Server error."
        });
    }
};