function send(res, status, data) {
    res.status(status).json(data);
  }
  
  function getConfig() {
    const url = process.env.SUPABASE_URL;
    const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
    if (!url) {
      throw new Error("SUPABASE_URL is missing.");
    }
  
    if (!secret) {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing.");
    }
  
    return {
      url: url.replace(/\/$/, ""),
      secret
    };
  }
  
  async function supabaseRequest(url, options = {}) {
    const response = await fetch(url, {
      method: options.method || "GET",
      headers: {
        apikey: options.apikey,
        Authorization: "Bearer " + options.apikey,
        "Content-Type": "application/json"
      }
    });
  
    const text = await response.text();
  
    let data = null;
  
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      throw new Error("Supabase returned invalid JSON: " + text);
    }
  
    if (!response.ok) {
      throw new Error(
        "Supabase HTTP " +
        response.status +
        ": " +
        (
          data?.message ||
          data?.error_description ||
          data?.hint ||
          data?.details ||
          data?.error ||
          text ||
          "Supabase request failed."
        )
      );
    }
  
    return data;
  }
  
  function getDayNumber(dateString) {
    const [year, month, day] = dateString.split("-").map(Number);
    return new Date(year, month - 1, day).getDay();
  }
  
  module.exports = async function handler(req, res) {
    if (req.method !== "POST") {
      return send(res, 405, {
        error: "Method not allowed."
      });
    }
  
    try {
      const config = getConfig();
  
      const booking_date = req.body?.booking_date;
  
      if (!booking_date) {
        return send(res, 400, {
          error: "No booking date received."
        });
      }
  
      const dayNumber = getDayNumber(booking_date);
  
      const url =
        config.url +
        "/rest/v1/availability?select=day_number,day_name,is_closed&order=day_number.asc";
  
      const availability = await supabaseRequest(url, {
        apikey: config.secret
      });
  
      return send(res, 200, {
        diagnostic: true,
        booking_date,
        calculated_day_number: dayNumber,
        returned_type: typeof availability,
        returned_is_array: Array.isArray(availability),
        returned_count: Array.isArray(availability)
          ? availability.length
          : null,
        availability
      });
    } catch (error) {
      return send(res, 500, {
        diagnostic: true,
        error: error.message || "Server error."
      });
    }
  };