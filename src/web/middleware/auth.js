import { resolveSession, hasPermission, SESSION_COOKIE } from "../auth.js";
import * as User from "../../models/User.js";

const PATH_PERMISSIONS = [
  { pattern: /^\/auth/, permission: null },
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
  { pattern: /^\/welcome/, permission: "welcome" },
  { pattern: /^\/logs/, permission: "logs" },
  { pattern: /^\/quests/, permission: "quests" },
  { pattern: /^\/leveling/, permission: "leveling" },
  { pattern: /^\/marriage/, permission: "leveling" },
  { pattern: /^\/interactions/, permission: "interactions" },
  { pattern: /^\/security\/audit/, permission: "security" },
  { pattern: /^\/security\/sessions/, permission: "users" },
  { pattern: /^\/security/, permission: null },
  { pattern: /^\/emojis/, permission: "economy" },
  { pattern: /^\/(overview|stats)/, permission: "overview" },
  // Guild metadata (channels/roles/members) powers dropdowns in every
  // section — any authenticated user may read it.
  { pattern: /^\/guilds/, permission: null },
];

function requiredPermissionForPath(path) {
  for (const { pattern, permission } of PATH_PERMISSIONS) {
    if (pattern.test(path)) return permission;
  }
  return null;
}

function readToken(req) {
  return req.cookies?.[SESSION_COOKIE] ?? req.headers.authorization?.replace(/^Bearer /i, "");
}

export async function requireAuth(req, res, next) {
  try {
    const token = readToken(req);
    if (!token) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const session = resolveSession(token, { ip: req.ip, userAgent: req.headers["user-agent"] });
    if (!session) {
      res.clearCookie(SESSION_COOKIE);
      return res.status(401).json({ error: "Session expired or invalid" });
    }

    // For non-admin users, read live permissions so edits and deletions
    // take effect immediately instead of after session expiry.
    let permissions = session.permissions;
    if (!session.isAdmin) {
      const user = await User.getByUsername(session.username);
      if (!user) {
        res.clearCookie(SESSION_COOKIE);
        return res.status(401).json({ error: "Session expired or invalid" });
      }
      permissions = user.permissions;
    }

    req.user = {
      username: session.username,
      isAdmin: session.isAdmin,
      permissions,
      sessionId: session.id,
    };
    req.session = session;

    const required = requiredPermissionForPath(req.path);
    if (required && !hasPermission(req.user, required)) {
      return res.status(403).json({ error: `You do not have permission to access ${required}.` });
    }

    next();
  } catch (err) {
    next(err);
  }
}

export function requirePermission(...permissions) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    if (hasPermission(req.user, permissions)) return next();
    return res.status(403).json({ error: "You do not have permission to do this." });
  };
}

export function authPage(req, res, next) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) {
    return res.redirect("/");
  }
  const session = resolveSession(token, { ip: req.ip, userAgent: req.headers["user-agent"] });
  if (!session) {
    res.clearCookie(SESSION_COOKIE);
    return res.redirect("/?expired=1");
  }
  req.user = {
    username: session.username,
    isAdmin: session.isAdmin,
    permissions: session.permissions,
    sessionId: session.id,
  };
  req.session = session;
  next();
}
