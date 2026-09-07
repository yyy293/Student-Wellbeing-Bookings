const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({
            error: "Method not allowed."
        });
    }

    const code = String(req.query.code || "").trim().toUpperCase();

    if (!/^MAC-[A-Z2-9]{10}$/.test(code)) {
        return res.status(400).json({
            error: "Invalid booking code."
        });
    }

    try {
        const { data, error } = await supabase
            .from("bookings")
            .select(
                "booking_code,session_type,booking_date,booking_time,status"
            )
            .eq("booking_code", code)
            .maybeSingle();

        if (error) {
            return res.status(500).json({
                error: "Unable to check booking."
            });
        }

        if (!data) {
            return res.status(404).json({
                error: "Booking not found."
            });
        }

        return res.status(200).json(data);
    } catch (error) {
        return res.status(500).json({
            error: "Server error."
        });
    }
};