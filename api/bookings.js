function send(res, status, data) {
    res.status(status).json(data);
  }
  
  function getConfig() {
    const url = process.env.SUPABASE_URL;
    const secret =
      process.env.SUPABASE_SECRET_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY;
  
    if (!url) {
      throw new Error("SUPABASE_URL is missing.");
    }
  
    if (!secret) {
      throw new Error(
        "No Supabase secret key was found. Add SUPABASE_SECRET_KEY in Vercel."
      );
    }
  
    return {
      url: url.replace(/\/$/, ""),
      secret
    };
  }
  
  async function supabaseRequest(url, secret, options = {}) {
    const headers = {
      apikey: secret,
      "Content-Type": "application/json",
      Prefer: options.prefer || "return=representation"
    };
  
    if (options.authorization) {
      headers.Authorization = options.authorization;
    }
  
    const response = await fetch(url, {
      method: options.method || "GET",
      headers,
      body: options.body
    });
  
    const text = await response.text();
  
    let data;
  
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      throw new Error(
        "Supabase returned an invalid response. HTTP " + response.status
      );
    }
  
    if (!response.ok) {
      throw new Error(
        data?.message ||
        data?.details ||
        data?.hint ||
        data?.error_description ||
        data?.error ||
        "Supabase request failed. HTTP " + response.status
      );
    }
  
    return data;
  }
  
  function getDayNumber(dateString) {
    const parts = dateString.split("-").map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]).getDay();
  }
  
  function isValidDate(dateString) {
    return /^\d{4}-\d{2}-\d{2}$/.test(dateString);
  }
  
  const allowedTimes = [
    "09:30",
    "10:00",
    "10:30",
    "11:00",
    "11:30",
    "12:00",
    "12:30",
    "13:00",
    "13:30",
    "14:00",
    "14:30"
  ];
  
  const allowedSessions = [
    "Wellbeing Talk",
    "Project Session",
    "General Support"
  ];
  
  module.exports = async function handler(req, res) {
    if (req.method !== "POST") {
      return send(res, 405, {
        error: "Method not allowed."
      });
    }
  
    try {
      const config = getConfig();
  
      const {
        student_name,
        student_class,
        session_type,
        booking_date,
        booking_time,
        student_message
      } = req.body || {};
  
      if (!student_name || !student_class) {
        return send(res, 400, {
          error: "Please enter your name and class."
        });
      }
  
      if (!allowedSessions.includes(session_type)) {
        return send(res, 400, {
          error: "Please choose a valid session type."
        });
      }
  
      if (!isValidDate(booking_date)) {
        return send(res, 400, {
          error: "Please choose a valid date."
        });
      }
  
      if (!allowedTimes.includes(booking_time)) {
        return send(res, 400, {
          error: "Please choose a valid time."
        });
      }
  
      const dayNumber = getDayNumber(booking_date);
  
      const availability = await supabaseRequest(
        config.url +
          "/rest/v1/availability?select=day_number,day_name,is_closed&order=day_number.asc",
        config.secret
      );
  
      if (!Array.isArray(availability)) {
        return send(res, 500, {
          error: "Supabase did not return availability data."
        });
      }
  
      const dayAvailability = availability.find(function(row) {
        return Number(row.day_number) === dayNumber;
      });
  
      if (!dayAvailability) {
        return send(res, 500, {
          error:
            "The server can reach Supabase, but Supabase returned no availability rows. Check that SUPABASE_SECRET_KEY is the Supabase Secret key."
        });
      }
  
      if (dayAvailability.is_closed === true) {
        return send(res, 400, {
          error: "Bookings are closed on this day."
        });
      }
  
      const existing = await supabaseRequest(
        config.url +
          "/rest/v1/bookings?select=id&booking_date=eq." +
          encodeURIComponent(booking_date) +
          "&booking_time=eq." +
          encodeURIComponent(booking_time) +
          "&status=in.(Pending,Approved)&limit=1",
        config.secret
      );
  
      if (Array.isArray(existing) && existing.length > 0) {
        return send(res, 409, {
          error: "That time has already been booked. Please choose another time."
        });
      }
  
      const bookingCode =
        "MAC-" +
        Math.random()
          .toString(36)
          .substring(2, 8)
          .toUpperCase();
  
      const booking = await supabaseRequest(
        config.url + "/rest/v1/bookings",
        config.secret,
        {
          method: "POST",
          body: JSON.stringify({
            booking_code: bookingCode,
            student_name: String(student_name).trim(),
            student_class: String(student_class).trim(),
            session_type,
            booking_date,
            booking_time,
            student_message: student_message
              ? String(student_message).trim()
              : null,
            status: "Pending"
          })
        }
      );
  
      if (!Array.isArray(booking) || booking.length === 0) {
        return send(res, 500, {
          error: "The booking could not be created."
        });
      }
  
      return send(res, 200, {
        success: true,
        booking_code: bookingCode
      });
    } catch (error) {
      return send(res, 500, {
        error: error.message || "Server error."
      });
    }
  };