const clients = new Map();

function getKey(req, suffix = "") {
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown";
  return `${ip}:${suffix}`;
}

export function rateLimit({ windowMs = 60_000, maxRequests = 30, suffix = "" } = {}) {
  return (req, res, next) => {
    const now = Date.now();
    const key = getKey(req, suffix);
    const record = clients.get(key) || { count: 0, resetAt: now + windowMs };

    if (now > record.resetAt) {
      record.count = 0;
      record.resetAt = now + windowMs;
    }

    record.count++;
    clients.set(key, record);

    res.setHeader("X-RateLimit-Limit", maxRequests);
    res.setHeader("X-RateLimit-Remaining", Math.max(0, maxRequests - record.count));
    res.setHeader("X-RateLimit-Reset", record.resetAt);

    if (record.count > maxRequests) {
      return res.status(429).json({ error: "Too many requests. Please slow down." });
    }

    next();
  };
}
