const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;

function json(res, status, data) {
  res.status(status).setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

function getConfig() {
  if (!SUPABASE_URL) {
    throw new Error("SUPABASE_URL is not configured.");
  }

  if (!SUPABASE_SECRET_KEY) {
    throw new Error("SUPABASE_SECRET_KEY is not configured.");
  }

  return {
    url: SUPABASE_URL.replace(/\/$/, ""),
    key: SUPABASE_SECRET_KEY
  };
}

function getAccessToken(req) {
  const auth = req.headers.authorization || "";

  if (!auth.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  return auth.slice(7).trim();
}

async function supabaseRequest(config, path, options = {}) {
  const response = await fetch(`${config.url}${path}`, {
    ...options,
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const text = await response.text();

  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    let message = "Supabase request failed.";

    if (data && typeof data === "object") {
      message =
        data.message ||
        data.error_description ||
        data.error ||
        message;
    } else if (typeof data === "string" && data.trim()) {
      message = data;
    }

    throw new Error(message);
  }

  return data;
}

async function verifyOperator(req, config) {
  const accessToken = getAccessToken(req);

  if (!accessToken) {
    return {
      ok: false,
      status: 401,
      message: "Please sign in again."
    };
  }

  try {
    const response = await fetch(`${config.url}/auth/v1/user`, {
      method: "GET",
      headers: {
        apikey: config.key,
        Authorization: `Bearer ${accessToken}`
      }
    });

    const text = await response.text();

    let data = null;

    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    if (!response.ok || !data || !data.id) {
      return {
        ok: false,
        status: 401,
        message: "Invalid operator login session. Please sign in again."
      };
    }

    return {
      ok: true,
      user: data
    };
  } catch {
    return {
      ok: false,
      status: 401,
      message: "Invalid operator login session. Please sign in again."
    };
  }
}

async function getAvailability(config) {
  return await supabaseRequest(
    config,
    "/rest/v1/availability?select=*&order=day_number.asc"
  );
}

async function getBookings(config) {
  return await supabaseRequest(
    config,
    "/rest/v1/bookings?select=*&order=created_at.desc"
  );
}

async function updateBooking(config, id, status) {
  const allowedStatuses = [
    "Pending",
    "Approved",
    "Cancelled",
    "Completed"
  ];

  if (!allowedStatuses.includes(status)) {
    throw new Error("Invalid booking status.");
  }

  return await supabaseRequest(
    config,
    `/rest/v1/bookings?id=eq.${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: {
        Prefer: "return=representation"
      },
      body: JSON.stringify({
        status
      })
    }
  );
}

async function rescheduleBooking(
  config,
  id,
  bookingDate,
  bookingTime
) {
  if (!bookingDate || !bookingTime) {
    throw new Error("Booking date and time are required.");
  }

  return await supabaseRequest(
    config,
    `/rest/v1/bookings?id=eq.${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: {
        Prefer: "return=representation"
      },
      body: JSON.stringify({
        booking_date: bookingDate,
        booking_time: bookingTime
      })
    }
  );
}

async function updateAvailability(
  config,
  dayNumber,
  isClosed
) {
  if (dayNumber === undefined || dayNumber === null) {
    throw new Error("Day number is required.");
  }

  return await supabaseRequest(
    config,
    `/rest/v1/availability?day_number=eq.${encodeURIComponent(dayNumber)}`,
    {
      method: "PATCH",
      headers: {
        Prefer: "return=representation"
      },
      body: JSON.stringify({
        is_closed: Boolean(isClosed)
      })
    }
  );
}

export default async function handler(req, res) {
  try {
    const config = getConfig();

    const url = new URL(
      req.url,
      `https://${req.headers.host || "localhost"}`
    );

    const action = url.searchParams.get("action") || "";

    if (req.method === "GET" && action === "availability") {
      const availability = await getAvailability(config);

      return json(res, 200, {
        success: true,
        availability
      });
    }

    const auth = await verifyOperator(req, config);

    if (!auth.ok) {
      return json(res, auth.status, {
        success: false,
        error: auth.message
      });
    }

    if (req.method === "GET" && action === "check") {
      return json(res, 200, {
        success: true,
        authorized: true,
        user: {
          id: auth.user.id,
          email: auth.user.email
        }
      });
    }

    if (req.method === "GET" && action === "bookings") {
      const bookings = await getBookings(config);

      return json(res, 200, {
        success: true,
        bookings
      });
    }

    if (req.method === "PUT" && action === "booking") {
      const body = req.body || {};

      const id = body.id;
      const status = body.status;

      if (!id) {
        return json(res, 400, {
          success: false,
          error: "Booking ID is required."
        });
      }

      const updated = await updateBooking(
        config,
        id,
        status
      );

      return json(res, 200, {
        success: true,
        booking: Array.isArray(updated)
          ? updated[0] || null
          : updated
      });
    }

    if (req.method === "PUT" && action === "status") {
      const body = req.body || {};

      const id = body.id;
      const status = body.status;

      if (!id) {
        return json(res, 400, {
          success: false,
          error: "Booking ID is required."
        });
      }

      const updated = await updateBooking(
        config,
        id,
        status
      );

      return json(res, 200, {
        success: true,
        booking: Array.isArray(updated)
          ? updated[0] || null
          : updated
      });
    }

    if (req.method === "PUT" && action === "reschedule") {
      const body = req.body || {};

      const id = body.id;
      const bookingDate = body.bookingDate;
      const bookingTime = body.bookingTime;

      if (!id) {
        return json(res, 400, {
          success: false,
          error: "Booking ID is required."
        });
      }

      const updated = await rescheduleBooking(
        config,
        id,
        bookingDate,
        bookingTime
      );

      return json(res, 200, {
        success: true,
        booking: Array.isArray(updated)
          ? updated[0] || null
          : updated
      });
    }

    if (req.method === "PUT" && action === "availability") {
      const body = req.body || {};

      const dayNumber = body.dayNumber;
      const isClosed = body.isClosed;

      if (
        dayNumber === undefined ||
        dayNumber === null
      ) {
        return json(res, 400, {
          success: false,
          error: "Day number is required."
        });
      }

      const updated = await updateAvailability(
        config,
        dayNumber,
        isClosed
      );

      return json(res, 200, {
        success: true,
        availability: Array.isArray(updated)
          ? updated[0] || null
          : updated
      });
    }

    return json(res, 404, {
      success: false,
      error: "Unknown operator action."
    });
  } catch (error) {
    console.error("Operator API error:", error);

    return json(res, 500, {
      success: false,
      error: error.message || "Server error."
    });
  }
}