const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;

function json(res, status, data) {
  res
    .status(status)
    .setHeader("Content-Type", "application/json")
    .setHeader("Cache-Control", "no-store, max-age=0");

  res.end(JSON.stringify(data));
}

function getConfig() {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    throw new Error("Supabase server configuration is missing.");
  }

  return {
    url: SUPABASE_URL.replace(/\/$/, ""),
    key: SUPABASE_SECRET_KEY
  };
}

function getAccessToken(req) {
  const h = req.headers.authorization || "";

  return h.startsWith("Bearer ")
    ? h.slice(7)
    : null;
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
    data = null;
  }

  if (!response.ok) {
    const message =
      data?.message ||
      data?.error_description ||
      data?.error ||
      text ||
      `Supabase request failed (${response.status})`;

    throw new Error(message);
  }

  return data;
}

async function verifyOperator(req, config) {
  const token = getAccessToken(req);

  if (!token) {
    return {
      ok: false,
      status: 401,
      error: "Please sign in first."
    };
  }

  const response = await fetch(
    `${config.url}/auth/v1/user`,
    {
      headers: {
        apikey: config.key,
        Authorization: `Bearer ${token}`
      }
    }
  );

  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.id) {
    return {
      ok: false,
      status: 401,
      error: "Invalid or expired operator session."
    };
  }

  return {
    ok: true,
    user: data
  };
}

async function getAvailability(config) {
  return supabaseRequest(
    config,
    "/rest/v1/availability?select=*&order=day_number.asc"
  );
}

async function getBookings(config) {
  return supabaseRequest(
    config,
    "/rest/v1/bookings?select=*&order=created_at.desc"
  );
}

async function updateBooking(config, id, status) {
  const allowed = [
    "Pending",
    "Approved",
    "Cancelled",
    "Completed"
  ];

  if (!id) {
    throw new Error("Booking id is required.");
  }

  if (!allowed.includes(status)) {
    throw new Error("Invalid booking status.");
  }

  const rows = await supabaseRequest(
    config,
    `/rest/v1/bookings?id=eq.${encodeURIComponent(
      String(id)
    )}&select=*`,
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

  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Error(
      "The booking was not updated. Check the booking id."
    );
  }

  return rows[0];
}

async function rescheduleBooking(
  config,
  id,
  bookingDate,
  bookingTime
) {
  if (!id) {
    throw new Error("Booking id is required.");
  }

  if (!bookingDate || !bookingTime) {
    throw new Error(
      "Booking date and time are required."
    );
  }

  const rows = await supabaseRequest(
    config,
    `/rest/v1/bookings?id=eq.${encodeURIComponent(
      String(id)
    )}&select=*`,
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

  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Error(
      "Booking was not found or was not rescheduled."
    );
  }

  return rows[0];
}

async function updateAvailability(
  config,
  dayNumber,
  isClosed
) {
  if (
    dayNumber === undefined ||
    dayNumber === null
  ) {
    throw new Error("Day number is required.");
  }

  const rows = await supabaseRequest(
    config,
    `/rest/v1/availability?day_number=eq.${encodeURIComponent(
      dayNumber
    )}&select=*`,
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

  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Error(
      "Availability day was not found or was not updated."
    );
  }

  return rows[0];
}

export default async function handler(req, res) {
  try {
    const config = getConfig();

    const base = req.headers.host
      ? `https://${req.headers.host}`
      : "http://localhost";

    const url = new URL(req.url, base);

    const action =
      url.searchParams.get("action") || "";

    /*
      Public availability
    */

    if (
      req.method === "GET" &&
      action === "availability"
    ) {
      return json(res, 200, {
        success: true,
        availability:
          await getAvailability(config)
      });
    }

    /*
      Operator authentication
    */

    const auth =
      await verifyOperator(req, config);

    if (!auth.ok) {
      return json(
        res,
        auth.status,
        {
          success: false,
          error: auth.error
        }
      );
    }

    /*
      Check operator
    */

    if (
      req.method === "GET" &&
      action === "check"
    ) {
      return json(res, 200, {
        success: true,
        authorized: true,
        user: auth.user
      });
    }

    /*
      Get bookings
    */

    if (
      req.method === "GET" &&
      action === "bookings"
    ) {
      return json(res, 200, {
        success: true,
        bookings:
          await getBookings(config)
      });
    }

    /*
      Approve / Cancel / Restore
    */

    if (
      req.method === "PUT" &&
      (
        action === "booking" ||
        action === "status"
      )
    ) {
      const body = req.body || {};

      const booking =
        await updateBooking(
          config,
          body.id,
          body.status
        );

      return json(res, 200, {
        success: true,
        booking
      });
    }

    /*
      Reschedule
    */

    if (
      req.method === "PUT" &&
      action === "reschedule"
    ) {
      const body = req.body || {};

      const booking =
        await rescheduleBooking(
          config,
          body.id,
          body.bookingDate ??
            body.booking_date,
          body.bookingTime ??
            body.booking_time
        );

      return json(res, 200, {
        success: true,
        booking
      });
    }

    /*
      Open / Close availability
    */

    if (
      req.method === "PUT" &&
      action === "availability"
    ) {
      const body = req.body || {};

      const availability =
        await updateAvailability(
          config,
          body.dayNumber ??
            body.day_number,
          body.isClosed ??
            body.is_closed
        );

      return json(res, 200, {
        success: true,
        availability
      });
    }

    return json(res, 404, {
      success: false,
      error: "Unknown operator action."
    });

  } catch (error) {

    console.error(
      "Operator API error:",
      error
    );

    return json(res, 500, {
      success: false,
      error:
        error.message ||
        "Server error."
    });
  }
}