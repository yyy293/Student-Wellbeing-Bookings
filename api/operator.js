const SUPABASE_URL = process.env.SUPABASE_URL;

const SUPABASE_SECRET_KEY =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
}

function getBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", chunk => {
      body += chunk;
    });

    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });

    req.on("error", reject);
  });
}

function requireConfig() {
  if (!SUPABASE_URL) {
    throw new Error("SUPABASE_URL is not configured.");
  }

  if (!SUPABASE_SECRET_KEY) {
    throw new Error(
      "SUPABASE_SECRET_KEY is not configured."
    );
  }
}

async function supabaseRequest(path, options = {}) {
  requireConfig();

  const response = await fetch(
    SUPABASE_URL + path,
    {
      ...options,
      headers: {
        "apikey": SUPABASE_SECRET_KEY,
        "Authorization": "Bearer " + SUPABASE_SECRET_KEY,
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    }
  );

  const text = await response.text();

  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const message =
      data &&
      typeof data === "object" &&
      (data.message || data.error_description || data.error);

    throw new Error(
      message ||
      `Supabase request failed with HTTP ${response.status}.`
    );
  }

  return data;
}

async function verifyUser(token) {
  requireConfig();

  if (!token) {
    return null;
  }

  const response = await fetch(
    SUPABASE_URL + "/auth/v1/user",
    {
      headers: {
        "apikey": SUPABASE_SECRET_KEY,
        "Authorization": "Bearer " + token
      }
    }
  );

  if (!response.ok) {
    return null;
  }

  return await response.json();
}

/*
  Operator authorization

  By default this allows an authenticated Supabase user.

  If you want ONLY specific emails to be operators,
  create a Vercel environment variable:

  OPERATOR_EMAILS=operator@example.com,another@example.com

  Then only those accounts can enter the dashboard.
*/
function isAuthorizedOperator(user) {
  if (!user || !user.email) {
    return false;
  }

  const allowed = String(
    process.env.OPERATOR_EMAILS || ""
  )
    .split(",")
    .map(email => email.trim().toLowerCase())
    .filter(Boolean);

  if (!allowed.length) {
    return true;
  }

  return allowed.includes(
    String(user.email).trim().toLowerCase()
  );
}

function getQuery(req) {
  const base = req.headers.host
    ? `https://${req.headers.host}`
    : "http://localhost";

  return new URL(req.url, base);
}

async function getAvailability() {
  return await supabaseRequest(
    "/rest/v1/availability?select=*&order=day_number.asc",
    {
      method: "GET"
    }
  );
}

async function updateAvailability(body) {
  const dayNumber =
    body.dayNumber ??
    body.day_number;

  const isClosed =
    body.isClosed ??
    body.is_closed;

  if (
    dayNumber === undefined ||
    dayNumber === null ||
    isClosed === undefined
  ) {
    throw new Error(
      "day_number and is_closed are required."
    );
  }

  const rows = await supabaseRequest(
    "/rest/v1/availability?day_number=eq." +
      encodeURIComponent(dayNumber),
    {
      method: "PATCH",
      headers: {
        "Prefer": "return=representation"
      },
      body: JSON.stringify({
        is_closed: Boolean(isClosed)
      })
    }
  );

  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Error(
      "Availability was not updated. Check that the day exists."
    );
  }

  return rows[0];
}

async function getBookings() {
  return await supabaseRequest(
    "/rest/v1/bookings?select=*&order=created_at.desc",
    {
      method: "GET"
    }
  );
}

async function updateBookingStatus(body) {
  const id = body.id;

  const status =
    body.status === "Approved"
      ? "Approved"
      : body.status === "Cancelled" ||
        body.status === "Canceled"
        ? "Cancelled"
        : body.status === "Pending"
          ? "Pending"
          : null;

  if (!id) {
    throw new Error(
      "Booking id is required."
    );
  }

  if (!status) {
    throw new Error(
      "Invalid booking status."
    );
  }

  /*
    IMPORTANT:

    This updates the REAL Supabase booking.

    Therefore:
      Pending -> Approved
      Pending -> Cancelled
      Approved -> Cancelled
      Cancelled -> Pending
  */

  const rows = await supabaseRequest(
    "/rest/v1/bookings?id=eq." +
      encodeURIComponent(id),
    {
      method: "PATCH",
      headers: {
        "Prefer": "return=representation"
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

async function rescheduleBooking(body) {
  const id = body.id;

  const bookingDate =
    body.bookingDate ??
    body.booking_date;

  const bookingTime =
    body.bookingTime ??
    body.booking_time;

  if (!id) {
    throw new Error(
      "Booking id is required."
    );
  }

  if (!bookingDate) {
    throw new Error(
      "Booking date is required."
    );
  }

  if (!bookingTime) {
    throw new Error(
      "Booking time is required."
    );
  }

  const rows = await supabaseRequest(
    "/rest/v1/bookings?id=eq." +
      encodeURIComponent(id),
    {
      method: "PATCH",
      headers: {
        "Prefer": "return=representation"
      },
      body: JSON.stringify({
        booking_date: bookingDate,
        booking_time: bookingTime
      })
    }
  );

  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Error(
      "The booking was not rescheduled."
    );
  }

  return rows[0];
}

module.exports = async function handler(req, res) {
  try {
    const url = getQuery(req);

    const action =
      url.searchParams.get("action") || "";

    /*
      Availability is public because the student
      booking page uses it to determine which days
      are open.
    */
    if (
      action === "availability" &&
      req.method === "GET"
    ) {
      const availability =
        await getAvailability();

      return json(res, 200, {
        availability
      });
    }

    /*
      Everything else requires a Supabase login.
    */
    const authorization =
      req.headers.authorization || "";

    const token =
      authorization.startsWith("Bearer ")
        ? authorization.slice(7)
        : null;

    const user =
      await verifyUser(token);

    if (!user) {
      return json(res, 401, {
        error: "You must be signed in."
      });
    }

    if (!isAuthorizedOperator(user)) {
      return json(res, 403, {
        authorized: false,
        error:
          "This account is not an authorised operator."
      });
    }

    /*
      Used by the HTML login check.
    */
    if (
      action === "check" &&
      req.method === "GET"
    ) {
      return json(res, 200, {
        authorized: true,
        user: {
          id: user.id,
          email: user.email
        }
      });
    }

    /*
      Get all bookings.
    */
    if (
      action === "bookings" &&
      req.method === "GET"
    ) {
      const bookings =
        await getBookings();

      return json(res, 200, {
        bookings
      });
    }

    /*
      Availability update.
    */
    if (
      action === "availability" &&
      req.method === "PUT"
    ) {
      const body =
        await getBody(req);

      const bookingDay =
        await updateAvailability(body);

      return json(res, 200, {
        success: true,
        availability: bookingDay
      });
    }

    /*
      Approve / Cancel / Restore.
    */
    if (
      action === "booking" &&
      req.method === "PUT"
    ) {
      const body =
        await getBody(req);

      const booking =
        await updateBookingStatus(body);

      return json(res, 200, {
        success: true,
        booking
      });
    }

    /*
      Reschedule.
    */
    if (
      action === "reschedule" &&
      req.method === "PUT"
    ) {
      const body =
        await getBody(req);

      const booking =
        await rescheduleBooking(body);

      return json(res, 200, {
        success: true,
        booking
      });
    }

    /*
      Backwards-compatible status endpoint.
    */
    if (
      action === "status" &&
      req.method === "PUT"
    ) {
      const body =
        await getBody(req);

      const booking =
        await updateBookingStatus(body);

      return json(res, 200, {
        success: true,
        booking
      });
    }

    return json(res, 404, {
      error: "Operator action not found."
    });

  } catch (error) {
    console.error(
      "Operator API error:",
      error
    );

    return json(res, 500, {
      error:
        error.message ||
        "Internal server error."
    });
  }
};