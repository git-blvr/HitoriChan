import express from "express";
import cookieParser from "cookie-parser";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { verifyCredentials, createSessionToken, generateInitialPassword, getLoginLockout, recordFailedLogin, resetLoginAttempts } from "./auth.js";
import { requireAuth, authPage } from "./middleware/auth.js";
import { securityHeaders } from "./middleware/security.js";
import { rateLimit } from "./middleware/rateLimit.js";
import api from "./routes/api.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "public");

export function startWebServer(client, port = process.env.WEB_PORT || process.env.PORT || 3000) {
  generateInitialPassword();

  const app = express();
  app.set("client", client);
  app.set("trust proxy", 1);

  app.use(securityHeaders);
  app.use(express.json());
  app.use(cookieParser());
  app.use(express.static(PUBLIC_DIR));

  app.post("/api/login", rateLimit({ windowMs: 15 * 60_000, maxRequests: 10, suffix: "login" }), async (req, res) => {
    const { username, password } = req.body || {};
    const ip = req.ip || req.socket?.remoteAddress || "unknown";

    const lockout = getLoginLockout(ip);
    if (lockout) {
      return res.status(429).json({ error: lockout.message });
    }

    const user = await verifyCredentials(username, password);
    if (!user) {
      const newLockout = recordFailedLogin(ip);
      if (newLockout) {
        return res.status(429).json({ error: newLockout.message });
      }
      return res.status(401).json({ error: "Invalid username or password" });
    }

    resetLoginAttempts(ip);
    const token = createSessionToken(user);
    res.cookie("token", token, { httpOnly: true, maxAge: 24 * 60 * 60 * 1000, sameSite: "strict", secure: req.secure });
    res.json({ ok: true, user: { username: user.username, isAdmin: user.isAdmin, permissions: user.permissions } });
  });

  app.post("/api/logout", (req, res) => {
    res.clearCookie("token");
    res.json({ ok: true });
  });

  app.use("/api", rateLimit({ windowMs: 60_000, maxRequests: 120, suffix: "api" }));
  app.use("/api", api);

  app.get("/dashboard", authPage, (req, res) => {
    res.sendFile(join(PUBLIC_DIR, "dashboard.html"));
  });

  app.get("/docs", (req, res) => {
    res.sendFile(join(PUBLIC_DIR, "docs.html"));
  });

  app.get("/doc", (req, res) => {
    res.sendFile(join(PUBLIC_DIR, "docs.html"));
  });

  app.get("/", (req, res) => {
    res.sendFile(join(PUBLIC_DIR, "index.html"));
  });

  app.use((err, req, res, next) => {
    console.error("[dashboard] Express error:", err);
    if (res.headersSent) return next(err);
    res.status(err.status || 500).json({ error: err.message || "Internal server error" });
  });

  const host = "0.0.0.0";
  const publicUrls = [
    ...(process.env.PUBLIC_URL ? [process.env.PUBLIC_URL] : []),
    ...(process.env.PUBLIC_URLS ? process.env.PUBLIC_URLS.split(",").map((u) => u.trim()).filter(Boolean) : []),
  ];

  return new Promise((resolve) => {
    const server = app.listen(port, host, () => {
      console.log("🌐 Dashboard is ready:");
      for (const url of publicUrls) {
        console.log(`   - ${url}`);
      }
      console.log(`   - http://${host}:${port}`);
      resolve(server);
    });
  });
}
