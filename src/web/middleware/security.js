export function securityHeaders(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=(), payment=(), usb=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Origin-Agent-Cluster", "?1");
  res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' https://cdn.jsdelivr.net",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "connect-src 'self'",
      "font-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      ...(req.secure ? ["upgrade-insecure-requests"] : []),
    ].join("; ")
  );
  if (req.secure) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
}

// Mutating requests must come from our own pages. Browsers always send
// Sec-Fetch-Site and/or Origin on cross-site fetches; non-browser clients
// (curl, scripts) send neither and cannot be CSRF vectors anyway.
export function sameSiteGuard(req, res, next) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();

  const fetchSite = req.headers["sec-fetch-site"];
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "same-site" && fetchSite !== "none") {
    return res.status(403).json({ error: "Cross-site request blocked" });
  }

  const origin = req.headers.origin;
  if (origin) {
    let originHost = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      return res.status(403).json({ error: "Invalid Origin header" });
    }
    const allowed = new Set([req.headers.host]);
    for (const extra of (process.env.DASHBOARD_ORIGINS || "").split(",")) {
      if (extra.trim()) allowed.add(extra.trim());
    }
    if (originHost !== req.headers.host && !allowed.has(origin) && !allowed.has(originHost)) {
      return res.status(403).json({ error: "Cross-site request blocked" });
    }
  }

  next();
}

// API responses contain per-guild state and must never be cached.
export function noStore(req, res, next) {
  res.setHeader("Cache-Control", "no-store");
  next();
}
