// Smoke test for the dashboard web server.
// Boots the real Express app with a stub Discord client and an isolated
// temporary database, then exercises the auth/session/security surface.
// Run: npm run smoke

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = mkdtempSync(join(tmpdir(), "hitori-smoke-"));
process.env.DB_PATH = join(tmp, "test.db");
process.env.DASHBOARD_PASSWORD = "smoke-admin-pw";
process.env.WEB_PORT = "3199";

const { startWebServer } = await import("../web/server.js");
const { closeDatabase } = await import("../database/db.js");

const stubClient = {
  guilds: { cache: new Map() },
  users: { cache: new Map() },
  channels: { cache: new Map() },
  commands: new Map(),
  user: { tag: "HitoriChan#0001", status: "online" },
  ws: { ping: 21 },
};

const BASE = "http://127.0.0.1:3199";
let server;
let passed = 0;
let failed = 0;

function check(name, cond, extra = "") {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name} ${extra}`);
  }
}

function cookieOf(res) {
  const raw = res.headers.get("set-cookie") || "";
  return raw.split(";")[0];
}

async function req(path, { method = "GET", body, cookie, headers = {} } = {}) {
  return fetch(`${BASE}${path}`, {
    method,
    redirect: "manual",
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

try {
  server = await startWebServer(stubClient, 3199);

  // --- Static & page routes ---
  let res = await req("/");
  check("GET / serves login page", res.status === 200 && (await res.text()).includes("login-form"));

  res = await req("/dashboard");
  check("GET /dashboard unauthenticated redirects", res.status === 302 && res.headers.get("location") === "/");

  res = await req("/dashboard.html");
  check("GET /dashboard.html is not publicly served", res.status === 404);

  res = await req("/does-not-exist");
  check("Unknown page returns 404", res.status === 404);

  // --- Security headers ---
  res = await req("/");
  const csp = res.headers.get("content-security-policy") || "";
  const scriptSrc = csp.match(/script-src[^;]*/)?.[0] || "";
  check("CSP present and bans inline scripts", scriptSrc.includes("'self'") && !scriptSrc.includes("unsafe-inline"));
  check("nosniff header", res.headers.get("x-content-type-options") === "nosniff");
  check("frame denied", res.headers.get("x-frame-options") === "DENY");
  check("x-powered-by hidden", res.headers.get("x-powered-by") === null);
  check("API no-store", (await req("/api/auth/me")).headers.get("cache-control") === "no-store");

  // --- Auth flow ---
  res = await req("/api/login", { method: "POST", body: { username: "Admin", password: "wrong" } });
  check("Bad login rejected", res.status === 401);

  res = await req("/api/login", { method: "POST", body: { username: "Admin", password: "smoke-admin-pw" } });
  check("Good login accepted", res.status === 200);
  const adminCookie = cookieOf(res);
  check("Session cookie set", adminCookie.startsWith("hc_session=hcs_"));

  res = await req("/api/auth/me", { cookie: adminCookie });
  const me = await res.json();
  check("auth/me returns admin", res.status === 200 && me.user.isAdmin === true);

  res = await req("/dashboard", { cookie: adminCookie });
  check("GET /dashboard authenticated returns 200", res.status === 200);

  // --- CSRF guard ---
  res = await req("/api/auth/me", {
    method: "GET",
    cookie: adminCookie,
    headers: { "sec-fetch-site": "same-origin" },
  });
  check("Same-site fetch allowed", res.status === 200);

  res = await req("/api/users", {
    method: "POST",
    cookie: adminCookie,
    headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
    body: { username: "attacker1", password: "password123", permissions: [] },
  });
  check("Cross-site POST blocked", res.status === 403);

  // --- User management ---
  res = await req("/api/users", {
    method: "POST",
    cookie: adminCookie,
    body: { username: "mod.user", password: "modpassword1", permissions: ["moderation"] },
  });
  check("Create dashboard user", res.status === 200);

  res = await req("/api/users", {
    method: "POST",
    cookie: adminCookie,
    body: { username: "weak", password: "short", permissions: [] },
  });
  check("Weak password rejected", res.status === 400);

  res = await req("/api/users", {
    method: "POST",
    cookie: adminCookie,
    body: { username: "Admin", password: "password123", permissions: [] },
  });
  check("Reserved username rejected", res.status === 400);

  // --- Login as the new user, check permissions ---
  res = await req("/api/login", { method: "POST", body: { username: "mod.user", password: "modpassword1" } });
  check("User login works", res.status === 200);
  const userCookie = cookieOf(res);

  res = await req("/api/users", { cookie: userCookie });
  check("User without 'users' perm gets 403", res.status === 403);

  res = await req("/api/moderation/12345", { cookie: userCookie });
  check("User with 'moderation' perm allowed", res.status === 200);

  res = await req("/api/security/audit", { cookie: userCookie });
  check("Audit log requires 'security' perm", res.status === 403);

  // --- Session revocation (the big one: logout actually kills the session) ---
  res = await req("/api/auth/sessions", { cookie: userCookie });
  const sessions = await res.json();
  check("User sees own session", res.status === 200 && sessions.length === 1 && sessions[0].current === true);

  await req("/api/logout", { method: "POST", cookie: userCookie });
  res = await req("/api/auth/me", { cookie: userCookie });
  check("Revoked session is rejected after logout", res.status === 401);

  // --- Audit + admin session views ---
  res = await req("/api/security/sessions", { cookie: adminCookie });
  const allSessions = await res.json();
  check("Admin lists all sessions", res.status === 200 && allSessions.length >= 1);

  res = await req("/api/security/audit", { cookie: adminCookie });
  const audit = await res.json();
  check("Audit log records events", res.status === 200 && audit.some((a) => a.action === "auth.login"));

  // --- Login lockout ---
  for (let i = 0; i < 6; i++) {
    res = await req("/api/login", {
      method: "POST",
      body: { username: "nobody", password: "nope" },
      headers: { "x-forwarded-for": "203.0.113.99" },
    });
  }
  check("Lockout after repeated failures", res.status === 429);
} catch (err) {
  failed++;
  console.error("  FAIL  unexpected error:", err);
} finally {
  server?.close();
  try {
    closeDatabase();
    rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // temp dir cleanup is best-effort on Windows (file locks)
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
