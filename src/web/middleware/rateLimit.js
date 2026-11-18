const clients = new Map();
const SWEEP_INTERVAL_MS = 60_000;

setInterval(() => {
  const now = Date.now();
  for (const [key, record] of clients) {
    if (now > record.resetAt) clients.delete(key);
  }
}, SWEEP_INTERVAL_MS).unref();

function getKey(req, suffix = "") {
  return `${req.ip || req.socket?.remoteAddress || "unknown"}:${suffix}`;
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
    res.setHeader("X-RateLimit-Reset", Math.ceil(record.resetAt / 1000));

    if (record.count > maxRequests) {
      res.setHeader("Retry-After", Math.ceil((record.resetAt - now) / 1000));
      return res.status(429).json({ error: "Too many requests. Please slow down." });
    }

    next();
  };
}
