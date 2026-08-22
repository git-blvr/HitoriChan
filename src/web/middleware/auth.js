import { verifySessionToken, hasPermission } from "../auth.js";

const PATH_PERMISSIONS = [
  { pattern: /^\/users\/permissions$/, permission: null },
  { pattern: /^\/users/, permission: "users" },
  { pattern: /^\/economy/, permission: "economy" },
  { pattern: /^\/shop/, permission: "shop" },
  { pattern: /^\/tickets/, permission: "tickets" },
  { pattern: /^\/triggers/, permission: "triggers" },
  { pattern: /^\/commands/, permission: "triggers" },
  { pattern: /^\/boost/, permission: "boost" },
  { pattern: /^\/moderation\/cases/, permission: "cases" },
  { pattern: /^\/moderation/, permission: "moderation" },
  { pattern: /^\/prefix/, permission: "moderation" },
  { pattern: /^\/ai/, permission: "ai" },
  { pattern: /^\/streak/, permission: "streak" },
  { pattern: /^\/logs/, permission: "logs" },
  { pattern: /^\/quests/, permission: "quests" },
  { pattern: /^\/emojis/, permission: "economy" },
  { pattern: /^\/(overview|stats|guilds)/, permission: "overview" },
];

function requiredPermissionForPath(path) {
  for (const { pattern, permission } of PATH_PERMISSIONS) {
    if (pattern.test(path)) return permission;
  }
  return null;
}

export function requireAuth(req, res, next) {
  const token = req.cookies?.token ?? req.headers.authorization?.replace("Bearer ", "");
  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const payload = verifySessionToken(token);
  if (!payload) {
    res.clearCookie("token");
    return res.status(401).json({ error: "Session expired or invalid" });
  }
  req.user = payload;

  const required = requiredPermissionForPath(req.path);
  if (required && !hasPermission(req.user, required)) {
    return res.status(403).json({ error: `You do not have permission to access ${required}.` });
  }

  next();
}

export function requirePermission(...permissions) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    if (hasPermission(req.user, permissions)) return next();
    return res.status(403).json({ error: "You do not have permission to do this." });
  };
}

export function authPage(req, res, next) {
  const token = req.cookies?.token;
  if (!token) {
    return res.redirect("/");
  }
  const payload = verifySessionToken(token);
  if (!payload) {
    res.clearCookie("token");
    return res.redirect("/");
  }
  req.user = payload;
  next();
}
