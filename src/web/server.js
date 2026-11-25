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
import {
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_TTL_MS,
  oauthEnabled,
  newState,
  stateMatches,
  buildAuthorizeUrl,
  completeOAuth,
  computeDiscordAccess,
} from "./oauth.js";
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

  // ------------------------------------------------------------------
  // Discord OAuth2 sign-in. Guild access is granted to servers the user
  // OWNS that also contain the bot; developer IDs get every guild.
  // ------------------------------------------------------------------
  app.get("/auth/config", (req, res) => {
    res.json({ oauth: oauthEnabled() });
  });

  app.get("/auth/discord", rateLimit({ windowMs: 60_000, maxRequests: 20, suffix: "oauth" }), (req, res) => {
    if (!oauthEnabled()) return res.redirect("/?error=oauth_disabled");
    const state = newState();
    res.cookie(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      maxAge: OAUTH_STATE_TTL_MS,
      sameSite: "lax", // must survive the cross-site return navigation from Discord
      secure: req.secure,
      path: "/",
    });
    res.redirect(buildAuthorizeUrl(req, state));
  });

  app.get("/auth/discord/callback", rateLimit({ windowMs: 60_000, maxRequests: 40, suffix: "oauthcb" }), async (req, res) => {
    res.clearCookie(OAUTH_STATE_COOKIE, { path: "/" });
    if (!oauthEnabled()) return res.redirect("/?error=oauth_disabled");

    const { state, code } = req.query;
    if (!stateMatches(state, req.cookies?.[OAUTH_STATE_COOKIE])) {
      return res.redirect("/?error=state");
    }
    if (typeof code !== "string" || !code) {
      return res.redirect("/?error=oauth");
    }

    try {
      const client = req.app.get("client");
      const { me, guilds: oauthGuilds } = await completeOAuth(req, code);
      const access = computeDiscordAccess(me, oauthGuilds, client);
      const actor = access.identity.username;

      if (!access.isDeveloper && access.guilds.length === 0) {
        Audit.add({ actor, action: "auth.login.discord.denied", detail: "no owned guilds with the bot", ip: req.ip });
        return res.redirect("/?error=no_guilds");
      }

      const { token } = createSession(
        {
          ...access.identity,
          isAdmin: false,
          permissions: access.permissions,
          guilds: access.guilds,
        },
        { ip: req.ip, userAgent: req.headers["user-agent"] }
      );
      Audit.add({
        actor,
        action: "auth.login.discord",
        detail: access.isDeveloper ? "developer" : `guilds=${access.guilds.length}`,
        ip: req.ip,
      });
      res.cookie(SESSION_COOKIE, token, {
        httpOnly: true,
        maxAge: SESSION_TTL_MS,
        // lax: the /dashboard navigation after the Discord redirect chain is
        // still cross-site-initiated, so strict cookies would be withheld and
        // the first landing would bounce back to the login page.
        sameSite: "lax",
        secure: req.secure,
        path: "/",
      });
      res.redirect("/dashboard");
    } catch (err) {
      console.error("[oauth] callback failed:", err.message);
      Audit.add({ actor: "discord", action: "auth.login.discord.fail", detail: String(err.message).slice(0, 200), ip: req.ip });
      res.redirect("/?error=oauth");
    }
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
