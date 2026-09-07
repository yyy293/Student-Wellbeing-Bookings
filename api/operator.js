function send(res, status, data) {
    res.status(status).json(data);
  }
  
  function getConfig() {
    const url = process.env.SUPABASE_URL;
    const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const publishable = process.env.SUPABASE_ANON_KEY;
  
    if (!url) {
      throw new Error("SUPABASE_URL is missing.");
    }
  
    if (!secret) {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing.");
    }
  
    if (!publishable) {
      throw new Error("SUPABASE_ANON_KEY is missing.");
    }
  
    return {
      url: url.replace(/\/$/, ""),
      secret,
      publishable
    };
  }
  
  async function supabaseRequest(url, options = {}) {
    const response = await fetch(url, {
      method: options.method || "GET",
      headers: {
        apikey: options.apikey,
        Authorization: "Bearer " + options.apikey,
        "Content-Type": "application/json",
        Prefer: options.prefer || "return=representation"
      },
      body: options.body
    });
  
    const text = await response.text();
  
    let data = null;
  
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      throw new Error("Supabase returned invalid JSON.");
    }
  
    if (!response.ok) {
      throw new Error(
        data?.message ||
        data?.error_description ||
        data?.hint ||
        data?.details ||
        data?.error ||
        "Supabase request failed."
      );
    }
  
    return data;
  }
  
  async function getAuthenticatedUser(config, token) {
    if (!token) {
      return null;
    }
  
    const response = await fetch(
      config.url + "/auth/v1/user",
      {
        method: "GET",
        headers: {
          apikey: config.publishable,
          Authorization: "Bearer " + token,
          "Content-Type": "application/json"
        }
      }
    );
  
    const text = await response.text();
  
    let data = null;
  
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  
    if (!response.ok || !data || !data.id) {
      return null;
    }
  
    return data;
  }
  
  async function requireOperator(config, req) {
    const authorization = req.headers.authorization || "";
  
    if (!authorization.startsWith("Bearer ")) {
      return {
        error: "Invalid operator login session. Please sign in again."
      };
    }
  
    const token = authorization.slice(7).trim();
  
    if (!token) {
      return {
        error: "Invalid operator login session. Please sign in again."
      };
    }
  
    const user = await getAuthenticatedUser(config, token);
  
    if (!user) {
      return {
        error: "Invalid operator login session. Please sign in again."
      };
    }
  
    const operators = await supabaseRequest(
      config.url +
        "/rest/v1/operator_users?select=user_id&user_id=eq." +
        encodeURIComponent(user.id) +
        "&is_active=eq.true&limit=1",
      {
        apikey: config.secret
      }
    );
  
    if (!Array.isArray(operators) || operators.length === 0) {
      return {
        error: "This account is not an authorised operator."
      };
    }
  
    return {
      user
    };
  }
  
  module.exports = async function handler(req, res) {
    try {
      const config = getConfig();
  
      if (req.method === "GET") {
        const action = req.query.action || "";
  
        if (action === "check") {
          const auth = await requireOperator(config, req);
  
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
  
        if (action === "bookings") {
          const auth = await requireOperator(config, req);
  
          if (auth.error) {
            return send(res, 401, {
              authorized: false,
              error: auth.error
            });
          }
  
          const bookings = await supabaseRequest(
            config.url +
              "/rest/v1/bookings?select=*&order=booking_date.asc,booking_time.asc,created_at.asc",
            {
              apikey: config.secret
            }
          );
  
          return send(res, 200, {
            authorized: true,
            bookings: Array.isArray(bookings) ? bookings : []
          });
        }
  
        if (action === "availability") {
          const availability = await supabaseRequest(
            config.url +
              "/rest/v1/availability?select=*&order=day_number.asc",
            {
              apikey: config.secret
            }
          );
  
          return send(res, 200, {
            availability: Array.isArray(availability)
              ? availability
              : []
          });
        }
  
        return send(res, 400, {
          error: "Invalid operator action."
        });
      }
  
      if (req.method === "PUT") {
        const auth = await requireOperator(config, req);
  
        if (auth.error) {
          return send(res, 401, {
            authorized: false,
            error: auth.error
          });
        }
  
        const action = req.query.action || "";
  
        if (action === "booking") {
          const {
            id,
            status
          } = req.body || {};
  
          if (!id) {
            return send(res, 400, {
              error: "Booking ID is required."
            });
          }
  
          if (!["Pending", "Approved", "Cancelled"].includes(status)) {
            return send(res, 400, {
              error: "Invalid booking status."
            });
          }
  
          const result = await supabaseRequest(
            config.url +
              "/rest/v1/bookings?id=eq." +
              encodeURIComponent(id),
            {
              method: "PATCH",
              apikey: config.secret,
              body: JSON.stringify({
                status
              })
            }
          );
  
          return send(res, 200, {
            success: true,
            booking: Array.isArray(result) ? result[0] : result
          });
        }
  
        if (action === "availability") {
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
  
          const result = await supabaseRequest(
            config.url +
              "/rest/v1/availability?day_number=eq." +
              encodeURIComponent(day_number),
            {
              method: "PATCH",
              apikey: config.secret,
              body: JSON.stringify({
                is_closed
              })
            }
          );
  
          return send(res, 200, {
            success: true,
            availability: Array.isArray(result)
              ? result[0]
              : result
          });
        }
  
        return send(res, 400, {
          error: "Invalid operator action."
        });
      }
  
      return send(res, 405, {
        error: "Method not allowed."
      });
    } catch (error) {
      return send(res, 500, {
        error: error.message || "Server error."
      });
    }
  };