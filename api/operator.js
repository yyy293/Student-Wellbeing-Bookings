function send(res, status, data) {
  res.status(status).json(data);
}

function getConfig() {
  const url = process.env.SUPABASE_URL;

  const secret =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  const publishable =
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!url) {
    throw new Error("SUPABASE_URL is missing.");
  }

  if (!secret) {
    throw new Error("Supabase server key is missing.");
  }

  if (!publishable) {
    throw new Error("Supabase publishable key is missing.");
  }

  return {
    url: url.replace(/\/$/, ""),
    secret,
    publishable
  };
}

async function getUser(config, token) {
  const response = await fetch(
    config.url + "/auth/v1/user",
    {
      method: "GET",
      headers: {
        apikey: config.publishable,
        Authorization: "Bearer " + token
      }
    }
  );

  const text = await response.text();

  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(
      "Supabase authentication returned invalid JSON."
    );
  }

  if (!response.ok) {
    const reason =
      data?.message ||
      data?.msg ||
      data?.error_description ||
      data?.error;

    throw new Error(
      "Supabase rejected the login session" +
      (reason ? ": " + reason : ".")
    );
  }

  if (!data || !data.id) {
    throw new Error(
      "Supabase returned no authenticated user."
    );
  }

  return data;
}

async function checkOperator(config, req) {
  const authorization =
    req.headers.authorization || "";

  if (!authorization.startsWith("Bearer ")) {
    return {
      error:
        "No operator access token was received. Please sign in again."
    };
  }

  const token =
    authorization.substring(7).trim();

  if (!token) {
    return {
      error:
        "The operator access token is empty. Please sign in again."
    };
  }

  const user = await getUser(config, token);

  const response = await fetch(
    config.url +
      "/rest/v1/operator_users?select=user_id&user_id=eq." +
      encodeURIComponent(user.id) +
      "&is_active=eq.true&limit=1",
    {
      method: "GET",
      headers: {
        apikey: config.secret,
        Authorization: "Bearer " + config.secret
      }
    }
  );

  const text = await response.text();

  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(
      "Supabase returned invalid JSON while checking the operator account."
    );
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
      data?.details ||
      data?.hint ||
      data?.error ||
      "Could not check operator account."
    );
  }

  if (!Array.isArray(data) || data.length === 0) {
    return {
      error:
        "This account is not an authorised operator."
    };
  }

  return {
    user
  };
}

async function getBookings(config) {
  const response = await fetch(
    config.url +
      "/rest/v1/bookings?select=*&order=booking_date.asc,booking_time.asc,created_at.asc",
    {
      method: "GET",
      headers: {
        apikey: config.secret,
        Authorization: "Bearer " + config.secret
      }
    }
  );

  const text = await response.text();

  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(
      "Supabase returned invalid JSON."
    );
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
      data?.details ||
      data?.hint ||
      data?.error ||
      "Could not load bookings."
    );
  }

  return Array.isArray(data) ? data : [];
}

async function updateBooking(config, id, status) {
  const response = await fetch(
    config.url +
      "/rest/v1/bookings?id=eq." +
      encodeURIComponent(id),
    {
      method: "PATCH",
      headers: {
        apikey: config.secret,
        Authorization: "Bearer " + config.secret,
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify({
        status
      })
    }
  );

  const text = await response.text();

  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(
      "Supabase returned invalid JSON."
    );
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
      data?.details ||
      data?.hint ||
      data?.error ||
      "Could not update booking."
    );
  }

  return Array.isArray(data) ? data[0] : data;
}

async function getAvailability(config) {
  const response = await fetch(
    config.url +
      "/rest/v1/availability?select=*&order=day_number.asc",
    {
      method: "GET",
      headers: {
        apikey: config.secret,
        Authorization: "Bearer " + config.secret
      }
    }
  );

  const text = await response.text();

  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(
      "Supabase returned invalid JSON."
    );
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
      data?.details ||
      data?.hint ||
      data?.error ||
      "Could not load availability."
    );
  }

  return Array.isArray(data) ? data : [];
}

async function updateAvailability(
  config,
  dayNumber,
  isClosed
) {
  const response = await fetch(
    config.url +
      "/rest/v1/availability?day_number=eq." +
      encodeURIComponent(dayNumber),
    {
      method: "PATCH",
      headers: {
        apikey: config.secret,
        Authorization: "Bearer " + config.secret,
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify({
        is_closed: isClosed
      })
    }
  );

  const text = await response.text();

  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(
      "Supabase returned invalid JSON."
    );
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
      data?.details ||
      data?.hint ||
      data?.error ||
      "Could not update availability."
    );
  }

  return Array.isArray(data) ? data[0] : data;
}

module.exports = async function handler(req, res) {
  try {
    const config = getConfig();

    const action = req.query.action || "";

    if (
      req.method === "GET" &&
      action === "availability"
    ) {
      const availability =
        await getAvailability(config);

      return send(res, 200, availability);
    }

    if (
      req.method === "GET" &&
      action === "check"
    ) {
      const auth =
        await checkOperator(config, req);

      if (auth.error) {
        return send(res, 401, {
          authorized: false,
          error: auth.error
        });
      }

      return send(res, 200, {
        authorized: true,
        user: {
          id: auth.user.id,
          email: auth.user.email
        }
      });
    }

    if (
      req.method === "GET" &&
      action === "bookings"
    ) {
      const auth =
        await checkOperator(config, req);

      if (auth.error) {
        return send(res, 401, {
          authorized: false,
          error: auth.error
        });
      }

      const bookings =
        await getBookings(config);

      return send(res, 200, {
        authorized: true,
        bookings
      });
    }

    if (
      req.method === "PUT" &&
      action === "booking"
    ) {
      const auth =
        await checkOperator(config, req);

      if (auth.error) {
        return send(res, 401, {
          authorized: false,
          error: auth.error
        });
      }

      const { id, status } =
        req.body || {};

      if (!id) {
        return send(res, 400, {
          error: "Booking ID is required."
        });
      }

      if (
        ![
          "Pending",
          "Approved",
          "Cancelled"
        ].includes(status)
      ) {
        return send(res, 400, {
          error: "Invalid booking status."
        });
      }

      const booking =
        await updateBooking(
          config,
          id,
          status
        );

      return send(res, 200, {
        success: true,
        booking
      });
    }

    if (
      req.method === "PUT" &&
      action === "availability"
    ) {
      const auth =
        await checkOperator(config, req);

      if (auth.error) {
        return send(res, 401, {
          authorized: false,
          error: auth.error
        });
      }

      const {
        day_number,
        is_closed
      } = req.body || {};

      if (
        typeof day_number !== "number" ||
        day_number < 0 ||
        day_number > 6
      ) {
        return send(res, 400, {
          error: "Invalid day number."
        });
      }

      if (typeof is_closed !== "boolean") {
        return send(res, 400, {
          error: "Invalid availability value."
        });
      }

      const availability =
        await updateAvailability(
          config,
          day_number,
          is_closed
        );

      return send(res, 200, {
        success: true,
        availability
      });
    }

    return send(res, 400, {
      error: "Invalid operator action."
    });
  } catch (error) {
    return send(res, 500, {
      error:
        error.message ||
        "Server error."
    });
  }
};