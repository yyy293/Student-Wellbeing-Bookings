const https = require("https");

function getConfig() {
  const url = process.env.SUPABASE_URL;
  const secret =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY;

  if (!url) {
    throw new Error("Missing SUPABASE_URL");
  }

  if (!secret) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  }

  return {
    url: url.replace(/\/$/, ""),
    secret
  };
}

function supabaseRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const requestUrl = new URL(url);

    const request = https.request(
      {
        hostname: requestUrl.hostname,
        port: 443,
        path: requestUrl.pathname + requestUrl.search,
        method: options.method || "GET",
        headers: {
          apikey: options.apikey,
          Authorization:
            options.authorization ||
            "Bearer " + options.apikey,
          "Content-Type": "application/json",
          Prefer: options.prefer || "return=representation"
        }
      },
      response => {
        let body = "";

        response.on("data", chunk => {
          body += chunk;
        });

        response.on("end", () => {
          let data = null;

          try {
            data = body ? JSON.parse(body) : null;
          } catch {
            data = body;
          }

          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(
              new Error(
                typeof data === "string"
                  ? data
                  : data?.message ||
                    data?.error_description ||
                    data?.error ||
                    "Supabase request failed"
              )
            );
            return;
          }

          resolve(data);
        });
      }
    );

    request.on("error", reject);

    if (options.body) {
      request.write(JSON.stringify(options.body));
    }

    request.end();
  });
}

async function verifySession(config, req) {
  const authorization = req.headers.authorization || "";

  if (!authorization.startsWith("Bearer ")) {
    throw new Error("Invalid operator login session. Please sign in again.");
  }

  const token = authorization.substring(7).trim();

  if (!token) {
    throw new Error("Invalid operator login session. Please sign in again.");
  }

  const user = await supabaseRequest(
    config.url + "/auth/v1/user",
    {
      method: "GET",
      apikey: config.secret,
      authorization: "Bearer " + token
    }
  );

  if (!user || !user.id) {
    throw new Error("Invalid operator login session. Please sign in again.");
  }

  return user;
}

async function getBookings(config) {
  return await supabaseRequest(
    config.url +
      "/rest/v1/bookings?select=*&order=booking_date.asc,booking_time.asc",
    {
      method: "GET",
      apikey: config.secret
    }
  );
}

async function updateBooking(config, body) {
  if (!body.id) {
    throw new Error("Booking ID is required");
  }

  const allowedStatuses = [
    "Pending",
    "Approved",
    "Cancelled"
  ];

  if (
    body.status !== undefined &&
    !allowedStatuses.includes(body.status)
  ) {
    throw new Error("Invalid booking status");
  }

  const update = {};

  if (body.status !== undefined) {
    update.status = body.status;
  }

  if (body.operator_note !== undefined) {
    update.operator_note = body.operator_note;
  }

  if (Object.keys(update).length === 0) {
    throw new Error("Nothing to update");
  }

  return await supabaseRequest(
    config.url +
      "/rest/v1/bookings?id=eq." +
      encodeURIComponent(body.id),
    {
      method: "PATCH",
      apikey: config.secret,
      body: update
    }
  );
}

async function getAvailability(config) {
  return await supabaseRequest(
    config.url +
      "/rest/v1/availability?select=*&order=day_number.asc",
    {
      method: "GET",
      apikey: config.secret
    }
  );
}

async function updateAvailability(config, body) {
  if (body.day_number === undefined) {
    throw new Error("Day number is required");
  }

  const update = {};

  if (body.is_closed !== undefined) {
    update.is_closed = Boolean(body.is_closed);
  }

  if (Object.keys(update).length === 0) {
    throw new Error("Nothing to update");
  }

  return await supabaseRequest(
    config.url +
      "/rest/v1/availability?day_number=eq." +
      encodeURIComponent(body.day_number),
    {
      method: "PATCH",
      apikey: config.secret,
      body: update
    }
  );
}

module.exports = async function handler(req, res) {
  try {
    const config = getConfig();
    const action = req.query.action || "";

    if (req.method === "GET" && action === "availability") {
      const availability = await getAvailability(config);
      return res.status(200).json(availability);
    }

    if (req.method === "GET" && action === "check") {
      const user = await verifySession(config, req);

      return res.status(200).json({
        authorized: true,
        user: {
          id: user.id,
          email: user.email
        }
      });
    }

    if (req.method === "GET" && action === "bookings") {
      await verifySession(config, req);

      const bookings = await getBookings(config);

      return res.status(200).json(bookings);
    }

    if (req.method === "PUT" && action === "booking") {
      await verifySession(config, req);

      const result = await updateBooking(
        config,
        req.body || {}
      );

      return res.status(200).json(result);
    }

    if (req.method === "PUT" && action === "availability") {
      await verifySession(config, req);

      const result = await updateAvailability(
        config,
        req.body || {}
      );

      return res.status(200).json(result);
    }

    return res.status(404).json({
      error: "Operator API route not found"
    });
  } catch (error) {
    console.error("Operator API error:", error);

    return res.status(
      error.message?.includes("Invalid operator login session")
        ? 401
        : 500
    ).json({
      error: error.message || "Server error"
    });
  }
};