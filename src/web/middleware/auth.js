import { verifySessionToken } from "../auth.js";

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
  next();
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
