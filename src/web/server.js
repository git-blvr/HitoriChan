import express from "express";
import cookieParser from "cookie-parser";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync, existsSync } from "fs";
import http from "node:http";
import https from "node:https";
import {
  verifyCredentials,
  createSession,
  revokeSession,
  generateInitialPassword,
  getLoginLockout,
  recordFailedLogin,
  resetLoginAttempts,
  SESSION_COOKIE,
  SESSION_TTL_MS,
} from "./auth.js";
import { authPage } from "./middleware/auth.js";
import { securityHeaders, noStore, sameSiteGuard } from "./middleware/security.js";
import { rateLimit } from "./middleware/rateLimit.js";
import * as Audit from "../models/AuditLog.js";
import * as Session from "../models/DashboardSession.js";
import api from "./routes/api.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "public");
const PAGES_DIR = join(__dirname, "pages");

const HTML_FILES = new Set([".html", ".htm"]);

function auditMutations(req, res, next) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  res.on("finish", () => {
    Audit.add({
      actor: req.user?.username ?? "anonymous",
      action: `${req.method} ${req.baseUrl || ""}${req.path}`,
      detail: `status=${res.statusCode}`,
      ip: req.ip,
    });
  });
  next();
}

export function startWebServer(client, port = process.env.WEB_PORT || process.env.PORT || 3000) {
  generateInitialPassword();
  Session.prune();
  Audit.prune();
  setInterval(() => {
    Session.prune();
    Audit.prune();
  }, 60 * 60 * 1000).unref();

  const app = express();
  app.set("client", client);
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  app.use(securityHeaders);
  app.use(express.json({ limit: "256kb" }));
  app.use(cookieParser());

  app.use(
    express.static(PUBLIC_DIR, {
      index: "index.html",
      setHeaders(res, filePath) {
        const ext = filePath.slice(filePath.lastIndexOf("."));
        res.setHeader("Cache-Control", HTML_FILES.has(ext) ? "no-cache" : "public, max-age=3600");
      },
    })
  );

  app.use("/api", sameSiteGuard, noStore);

  app.post("/api/login", rateLimit({ windowMs: 15 * 60_000, maxRequests: 20, suffix: "login" }), async (req, res) => {
    const { username, password } = req.body || {};
    const ip = req.ip || "unknown";

    const lockout = getLoginLockout(ip, username);
    if (lockout) {
      return res.status(429).json({ error: lockout.message });
    }

    const user = await verifyCredentials(username, password);
    if (!user) {
      const newLockout = recordFailedLogin(ip, username);
      Audit.add({ actor: username || "unknown", action: "auth.login.fail", ip });
      if (newLockout) {
        return res.status(429).json({ error: newLockout.message });
      }
      return res.status(401).json({ error: "Invalid username or password" });
    }

    resetLoginAttempts(ip, username);
    const { token } = createSession(user, { ip, userAgent: req.headers["user-agent"] });
    Audit.add({ actor: user.username, action: "auth.login", ip });
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      maxAge: SESSION_TTL_MS,
      sameSite: "strict",
      secure: req.secure,
      path: "/",
    });
    res.json({ ok: true, user: { username: user.username, isAdmin: user.isAdmin, permissions: user.permissions } });
  });

  app.post("/api/logout", (req, res) => {
    const token = req.cookies?.[SESSION_COOKIE];
    const found = token ? Session.getByToken(token) : null;
    if (found) {
      revokeSession(found.session.id);
      Audit.add({ actor: found.session.username, action: "auth.logout", ip: req.ip });
    }
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.json({ ok: true });
  });

  app.use("/api", rateLimit({ windowMs: 60_000, maxRequests: 240, suffix: "api" }), auditMutations, api);

  app.get("/dashboard", authPage, (req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(join(PAGES_DIR, "dashboard.html"));
  });

  app.get(["/docs", "/doc"], (req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(join(PUBLIC_DIR, "docs.html"));
  });

  app.use("/api", (req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  app.use((req, res) => {
    res.status(404).sendFile(join(PUBLIC_DIR, "404.html"), (err) => {
      if (err) res.status(404).type("text").send("Not found");
    });
  });

  app.use((err, req, res, next) => {
    console.error("[dashboard] Express error:", err);
    if (res.headersSent) return next(err);
    const status = Number(err.status) || (err.type === "entity.too.large" ? 413 : 500);
    res.status(status).json({ error: status === 500 ? "Internal server error" : err.message });
  });

  const host = process.env.WEB_HOST || "0.0.0.0";
  const publicUrls = [
    ...(process.env.PUBLIC_URL ? [process.env.PUBLIC_URL] : []),
    ...(process.env.PUBLIC_URLS ? process.env.PUBLIC_URLS.split(",").map((u) => u.trim()).filter(Boolean) : []),
  ];

  const tlsKey = process.env.TLS_KEY_PATH;
  const tlsCert = process.env.TLS_CERT_PATH;
  const useTls = tlsKey && tlsCert && existsSync(tlsKey) && existsSync(tlsCert);
  const scheme = useTls ? "https" : "http";

  return new Promise((resolve, reject) => {
    const server = useTls
      ? https.createServer({ key: readFileSync(tlsKey), cert: readFileSync(tlsCert) }, app)
      : http.createServer(app);

    server.on("error", reject);
    server.listen(port, host, () => {
      console.log(`🌐 Dashboard is ready (${scheme}):`);
      for (const url of publicUrls) {
        console.log(`   - ${url}`);
      }
      console.log(`   - ${scheme}://${host}:${port}`);
      resolve(server);
    });
  });
}
