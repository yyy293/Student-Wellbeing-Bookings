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
  const header = req.headers.authorization || "";

  if (!header.startsWith("Bearer ")) {
    return null;
  }

  return header.slice(7);
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

  const response = await fetch(`${config.url}/auth/v1/user`, {
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${token}`
    }
  });

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

/* -------------------------------------------------------
   AVAILABILITY
------------------------------------------------------- */

async function getAvailability(config) {
  return supabaseRequest(
    config,
    "/rest/v1/availability?select=*&order=day_number.asc"
  );
}

async function updateAvailability(config, dayNumber, isClosed) {
  if (dayNumber === undefined || dayNumber === null) {
    throw new Error("Day number is required.");
  }

  const number = Number(dayNumber);

  if (!Number.isInteger(number) || number < 0 || number > 6) {
    throw new Error("Invalid day number.");
  }

  const closed =
    isClosed === true ||
    isClosed === "true" ||
    isClosed === 1 ||
    isClosed === "1";

  const rows = await supabaseRequest(
    config,
    `/rest/v1/availability?day_number=eq.${encodeURIComponent(number)}&select=*`,
    {
      method: "PATCH",
      headers: {
        Prefer: "return=representation"
      },
      body: JSON.stringify({
        is_closed: closed
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

/* -------------------------------------------------------
   BOOKINGS
------------------------------------------------------- */

async function getBookings(config) {
  return supabaseRequest(
    config,
    "/rest/v1/bookings?select=*&order=created_at.desc"
  );
}

/*
  Find a booking safely.

  We try booking ID first when supplied.
  If that fails, we try booking_code.

  This is important because the operator page may have
  either identifier depending on how the booking was loaded.
*/
async function findBooking(config, id, bookingCode) {
  const cleanId =
    id !== undefined &&
    id !== null &&
    String(id).trim() !== ""
      ? String(id).trim()
      : "";

  const cleanCode =
    bookingCode !== undefined &&
    bookingCode !== null &&
    String(bookingCode).trim() !== ""
      ? String(bookingCode).trim()
      : "";

  /* Try database ID */
  if (cleanId) {
    const rows = await supabaseRequest(
      config,
      `/rest/v1/bookings?id=eq.${encodeURIComponent(cleanId)}&select=*`
    );

    if (Array.isArray(rows) && rows.length === 1) {
      return rows[0];
    }
  }

  /* Try booking code */
  if (cleanCode) {
    const rows = await supabaseRequest(
      config,
      `/rest/v1/bookings?booking_code=eq.${encodeURIComponent(cleanCode)}&select=*`
    );

    if (Array.isArray(rows) && rows.length === 1) {
      return rows[0];
    }
  }

  return null;
}

/* -------------------------------------------------------
   STATUS UPDATE
------------------------------------------------------- */

async function updateBooking(
  config,
  id,
  bookingCode,
  status
) {
  const allowedStatuses = [
    "Pending",
    "Approved",
    "Cancelled",
    "Completed"
  ];

  const cleanStatus = String(status || "").trim();

  if (!allowedStatuses.includes(cleanStatus)) {
    throw new Error("Invalid booking status.");
  }

  const existing = await findBooking(
    config,
    id,
    bookingCode
  );

  if (!existing) {
    throw new Error(
      "Booking was not found. Check the booking ID or booking code."
    );
  }

  /*
    Prevent approving a cancelled booking.
  */
  if (
    cleanStatus === "Approved" &&
    String(existing.status || "").toLowerCase() === "cancelled"
  ) {
    throw new Error(
      "A cancelled booking cannot be approved. Restore it first."
    );
  }

  /*
    If approving, check whether another approved booking
    already occupies the same date/time.
  */
  if (
    cleanStatus === "Approved" &&
    existing.booking_date &&
    existing.booking_time
  ) {
    const conflicts = await supabaseRequest(
      config,
      `/rest/v1/bookings?` +
        `booking_date=eq.${encodeURIComponent(
          String(existing.booking_date)
        )}` +
        `&booking_time=eq.${encodeURIComponent(
          String(existing.booking_time)
        )}` +
        `&status=eq.Approved` +
        `&select=id,booking_code`
    );

    if (Array.isArray(conflicts)) {
      const otherConflict = conflicts.find(
        row => String(row.id) !== String(existing.id)
      );

      if (otherConflict) {
        throw new Error(
          "Another approved booking already uses this time."
        );
      }
    }
  }

  /*
    IMPORTANT:
    We patch using the REAL ID returned from Supabase,
    not whatever ID the browser happened to send.
  */
  const realId = String(existing.id);

  const rows = await supabaseRequest(
    config,
    `/rest/v1/bookings?id=eq.${encodeURIComponent(realId)}&select=*`,
    {
      method: "PATCH",
      headers: {
        Prefer: "return=representation"
      },
      body: JSON.stringify({
        status: cleanStatus
      })
    }
  );

  /*
    Some Supabase/PostgREST configurations can return an
    empty representation even when the update succeeds.

    Therefore, verify the booking again instead of treating
    an empty response alone as failure.
  */
  let updated = null;

  if (Array.isArray(rows) && rows.length === 1) {
    updated = rows[0];
  } else {
    const verification = await findBooking(
      config,
      realId,
      existing.booking_code
    );

    if (verification) {
      updated = verification;
    }
  }

  if (!updated) {
    throw new Error(
      "The booking status could not be saved."
    );
  }

  if (
    String(updated.status || "").toLowerCase() !==
    cleanStatus.toLowerCase()
  ) {
    throw new Error(
      `The booking status could not be saved. Supabase returned "${updated.status}".`
    );
  }

  return updated;
}

/* -------------------------------------------------------
   RESCHEDULE
------------------------------------------------------- */

async function rescheduleBooking(
  config,
  id,
  bookingCode,
  bookingDate,
  bookingTime
) {
  const cleanDate = String(bookingDate || "").trim();
  const cleanTime = String(bookingTime || "").trim();

  if (!cleanDate) {
    throw new Error("Booking date is required.");
  }

  if (!cleanTime) {
    throw new Error("Booking time is required.");
  }

  const existing = await findBooking(
    config,
    id,
    bookingCode
  );

  if (!existing) {
    throw new Error(
      "Booking was not found. Check the booking ID or booking code."
    );
  }

  const realId = String(existing.id);

  /*
    Check for an approved booking conflict at the new
    date/time.
  */
  if (
    String(existing.status || "").toLowerCase() === "approved"
  ) {
    const conflicts = await supabaseRequest(
      config,
      `/rest/v1/bookings?` +
        `booking_date=eq.${encodeURIComponent(cleanDate)}` +
        `&booking_time=eq.${encodeURIComponent(cleanTime)}` +
        `&status=eq.Approved` +
        `&select=id,booking_code`
    );

    if (Array.isArray(conflicts)) {
      const otherConflict = conflicts.find(
        row => String(row.id) !== realId
      );

      if (otherConflict) {
        throw new Error(
          "Another approved booking already uses that date and time."
        );
      }
    }
  }

  const rows = await supabaseRequest(
    config,
    `/rest/v1/bookings?id=eq.${encodeURIComponent(realId)}&select=*`,
    {
      method: "PATCH",
      headers: {
        Prefer: "return=representation"
      },
      body: JSON.stringify({
        booking_date: cleanDate,
        booking_time: cleanTime
      })
    }
  );

  let updated = null;

  if (Array.isArray(rows) && rows.length === 1) {
    updated = rows[0];
  } else {
    updated = await findBooking(
      config,
      realId,
      existing.booking_code
    );
  }

  if (!updated) {
    throw new Error(
      "The booking date/time could not be saved."
    );
  }

  return updated;
}

/* -------------------------------------------------------
   MAIN VERCEL HANDLER
------------------------------------------------------- */

export default async function handler(req, res) {
  try {
    const config = getConfig();

    const base =
      req.headers.host
        ? `https://${req.headers.host}`
        : "http://localhost";

    const url = new URL(
      req.url || "/api/operator",
      base
    );

    const action =
      url.searchParams.get("action") || "";

    /* -----------------------------------------------
       PUBLIC AVAILABILITY
       Students need to see which days are closed.
    ------------------------------------------------ */

    if (
      req.method === "GET" &&
      action === "availability"
    ) {
      const availability =
        await getAvailability(config);

      return json(res, 200, {
        success: true,
        availability
      });
    }

    /* -----------------------------------------------
       EVERYTHING BELOW THIS POINT REQUIRES OPERATOR
       AUTHENTICATION.
    ------------------------------------------------ */

    const auth =
      await verifyOperator(req, config);

    if (!auth.ok) {
      return json(res, auth.status, {
        success: false,
        error: auth.error
      });
    }

    /* -----------------------------------------------
       CHECK OPERATOR
    ------------------------------------------------ */

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

    /* -----------------------------------------------
       GET BOOKINGS
    ------------------------------------------------ */

    if (
      req.method === "GET" &&
      action === "bookings"
    ) {
      const bookings =
        await getBookings(config);

      return json(res, 200, {
        success: true,
        bookings
      });
    }

    /* -----------------------------------------------
       UPDATE BOOKING STATUS
       Supports:
       action=booking
       action=status
    ------------------------------------------------ */

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
          body.booking_code,
          body.status
        );

      return json(res, 200, {
        success: true,
        booking
      });
    }

    /* -----------------------------------------------
       RESCHEDULE BOOKING
    ------------------------------------------------ */

    if (
      req.method === "PUT" &&
      action === "reschedule"
    ) {
      const body = req.body || {};

      const booking =
        await rescheduleBooking(
          config,
          body.id,
          body.booking_code,
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

    /* -----------------------------------------------
       OPEN / CLOSE AVAILABILITY DAY
    ------------------------------------------------ */

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

    /* -----------------------------------------------
       UNKNOWN ACTION
    ------------------------------------------------ */

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
        error?.message ||
        "Server error."
    });
  }
}