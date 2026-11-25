import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import * as User from "../models/User.js";
import * as Session from "../models/DashboardSession.js";

const DEFAULT_USER = "Admin";
const PASSWORD_LENGTH = 10;
const PASSWORD_CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*";
const SCRYPT_KEYLEN = 64;

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;

export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const SESSION_TOUCH_MS = 5 * 60 * 1000;
export const SESSION_COOKIE = "hc_session";

let adminPasswordHash = null;
const ipAttempts = new Map();
const userAttempts = new Map();

// A fixed scrypt hash used to burn equivalent CPU time when a username does
// not exist, so login timing does not reveal valid usernames.
const DUMMY_HASH = (() => {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${scryptSync("dummy-password", salt, SCRYPT_KEYLEN).toString("hex")}`;
})();

function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

function verifyPasswordHash(password, stored) {
  const [saltHex, hashHex] = String(stored || "").split(":");
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, salt, SCRYPT_KEYLEN);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function generatePassword(length = PASSWORD_LENGTH) {
  const bytes = randomBytes(length);
  let password = "";
  for (let i = 0; i < length; i++) {
    password += PASSWORD_CHARSET[bytes[i] % PASSWORD_CHARSET.length];
  }
  return password;
}

export function generateInitialPassword() {
  if (adminPasswordHash) return;
  const configured = process.env.DASHBOARD_PASSWORD;
  const password = configured || generatePassword();
  adminPasswordHash = hashPassword(password);
  if (configured) {
    console.log(`\n🔐 Dashboard login\n   User: ${DEFAULT_USER}\n   Password: (from DASHBOARD_PASSWORD env)\n`);
  } else {
    console.log(`\n🔐 Dashboard login\n   User: ${DEFAULT_USER}\n   Password: ${password}\n`);
  }
}

function verifyAdminCredentials(username, password) {
  const isAdmin = username === DEFAULT_USER;
  // Always run the scrypt comparison so timing stays uniform.
  const passwordOk = verifyPasswordHash(password, adminPasswordHash ?? DUMMY_HASH);
  return isAdmin && passwordOk;
}

export async function verifyCredentials(username, password) {
  if (typeof username !== "string" || typeof password !== "string" || !username || !password) {
    return null;
  }
  if (verifyAdminCredentials(username, password)) {
    return { username: DEFAULT_USER, isAdmin: true, permissions: User.ALL_PERMISSIONS };
  }
  const user = await User.getByUsername(username);
  if (!user) {
    verifyPasswordHash(password, DUMMY_HASH);
    return null;
  }
  if (!verifyPasswordHash(password, user.passwordHash)) return null;
  return { username: user.username, isAdmin: false, permissions: user.permissions, id: user.id };
}

function sweepAttempts(map) {
  const cutoff = Date.now() - ATTEMPT_WINDOW_MS;
  for (const [key, record] of map) {
    const stale = !record.lockedUntil && record.lastAt < cutoff;
    const lockExpired = record.lockedUntil && record.lockedUntil <= Date.now();
    if (stale || lockExpired) map.delete(key);
  }
}

setInterval(() => {
  sweepAttempts(ipAttempts);
  sweepAttempts(userAttempts);
}, 60_000).unref();

function readLockout(map, key) {
  const record = map.get(key);
  if (!record?.lockedUntil) return null;
  if (record.lockedUntil <= Date.now()) {
    map.delete(key);
    return null;
  }
  const remaining = Math.ceil((record.lockedUntil - Date.now()) / 1000);
  return { remaining, message: `Too many failed attempts. Try again in ${remaining} seconds.` };
}

function recordFailure(map, key) {
  const now = Date.now();
  const record = map.get(key) || { count: 0, lastAt: 0 };
  if (record.lastAt < now - ATTEMPT_WINDOW_MS) record.count = 0;
  record.count += 1;
  record.lastAt = now;
  if (record.count >= MAX_ATTEMPTS) {
    record.lockedUntil = now + LOCKOUT_MS;
    record.count = 0;
  }
  map.set(key, record);
  return readLockout(map, key);
}

export function getLoginLockout(ip, username) {
  return readLockout(ipAttempts, ip) || (username ? readLockout(userAttempts, String(username).toLowerCase()) : null);
}

export function recordFailedLogin(ip, username) {
  const ipLock = recordFailure(ipAttempts, ip);
  const userLock = username ? recordFailure(userAttempts, String(username).toLowerCase()) : null;
  return ipLock || userLock || null;
}

export function resetLoginAttempts(ip, username) {
  ipAttempts.delete(ip);
  if (username) userAttempts.delete(String(username).toLowerCase());
}

export function createSession(user, { ip = null, userAgent = null } = {}) {
  return Session.create({
    username: user.username,
    isAdmin: user.isAdmin,
    permissions: user.permissions || [],
    authType: user.authType || "local",
    discordId: user.discordId ?? null,
    displayName: user.displayName ?? null,
    avatar: user.avatar ?? null,
    guilds: user.guilds ?? null,
    ip,
    userAgent,
    ttlMs: SESSION_TTL_MS,
  });
}

export function resolveSession(token, { ip = null, userAgent = null } = {}) {
  const found = Session.getByToken(token);
  if (!found) return null;
  const { session } = found;
  if (Date.now() - session.lastSeenAt > SESSION_TOUCH_MS) {
    session.lastSeenAt = Date.now();
    session.expiresAt = Date.now() + SESSION_TTL_MS;
    Session.touch(session.id, { expiresAt: session.expiresAt, ip, userAgent });
  }
  return session;
}

export function revokeSession(id) {
  return Session.revoke(id);
}

export function revokeAllSessionsForUser(username, exceptSessionId) {
  return Session.revokeAllForUser(username, exceptSessionId);
}

export function hasPermission(user, permission) {
  if (!user) return false;
  if (user.isAdmin) return true;
  if (permission === "users" && user.permissions?.includes("users")) return true;
  if (Array.isArray(permission)) return permission.some((p) => hasPermission(user, p));
  return user.permissions?.includes(permission);
}
