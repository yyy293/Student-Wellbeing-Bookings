const { createClient } = require("@supabase/supabase-js");

function send(res, status, data) {
  res.status(status).json(data);
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return send(res, 405, {
      error: "Method not allowed"
    });
  }

  try {
    const url = process.env.SUPABASE_URL;
    const secret =
      process.env.SUPABASE_SECRET_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url) {
      return send(res, 500, {
        error: "Vercel is missing SUPABASE_URL"
      });
    }

    if (!secret) {
      return send(res, 500, {
        error: "Vercel is missing the Supabase server key"
      });
    }

    const supabase = createClient(url, secret);

    const code = String(req.query.code || "")
      .trim()
      .toUpperCase();

    if (!/^MAC-[A-Z0-9]{6}$/.test(code)) {
      return send(res, 400, {
        error: "Invalid booking code."
      });
    }

    const { data, error } = await supabase
      .from("bookings")
      .select(
        "booking_code, session_type, booking_date, booking_time, status"
      )
      .eq("booking_code", code)
      .limit(1);

    if (error) {
      return send(res, 500, {
        error: "Supabase status error: " + error.message
      });
    }

    if (!data || data.length === 0) {
      return send(res, 404, {
        error: "Booking not found."
      });
    }

    return send(res, 200, data[0]);
  } catch (error) {
    return send(res, 500, {
      error: "Server error: " + (error.message || "Unknown error")
    });
  }
};