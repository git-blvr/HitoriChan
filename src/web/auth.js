import jwt from "jsonwebtoken";
import { randomBytes } from "crypto";
import * as User from "../models/User.js";

const DEFAULT_USER = "Admin";
const PASSWORD_LENGTH = 10;
const PASSWORD_CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*";
const MAX_ATTEMPTS = 3;
const LOCKOUT_MS = 15 * 60 * 1000;

let adminPassword = null;
const attempts = new Map();

export function generatePassword(length = PASSWORD_LENGTH) {
  const bytes = randomBytes(length);
  let password = "";
  for (let i = 0; i < length; i++) {
    password += PASSWORD_CHARSET[bytes[i] % PASSWORD_CHARSET.length];
  }
  return password;
}

export function generateInitialPassword() {
  if (!adminPassword) {
    adminPassword = generatePassword();
    console.log(`\n🔐 Dashboard login\n   User: ${DEFAULT_USER}\n   Password: ${adminPassword}\n`);
  }
  return adminPassword;
}

export function getPassword() {
  return adminPassword ?? generateInitialPassword();
}

export function verifyAdminCredentials(username, password) {
  return username === DEFAULT_USER && password === getPassword();
}

export async function verifyCredentials(username, password) {
  if (verifyAdminCredentials(username, password)) {
    return { username: DEFAULT_USER, isAdmin: true, permissions: User.ALL_PERMISSIONS };
  }
  const user = await User.verify(username, password);
  if (!user) return null;
  return { username: user.username, isAdmin: false, permissions: user.permissions, id: user.id };
}

function now() {
  return Date.now();
}

export function getLoginLockout(ip) {
  const record = attempts.get(ip);
  if (!record) return null;

  if (record.lockedUntil && record.lockedUntil > now()) {
    const remaining = Math.ceil((record.lockedUntil - now()) / 1000);
    return { remaining, message: `Too many failed attempts. Try again in ${remaining} seconds.` };
  }

  if (record.lockedUntil && record.lockedUntil <= now()) {
    attempts.delete(ip);
    return null;
  }

  return null;
}

export function recordFailedLogin(ip) {
  const record = attempts.get(ip) || { count: 0 };
  record.count += 1;

  if (record.count >= MAX_ATTEMPTS) {
    record.lockedUntil = now() + LOCKOUT_MS;
  }

  attempts.set(ip, record);
  return getLoginLockout(ip);
}

export function resetLoginAttempts(ip) {
  attempts.delete(ip);
}

export function createSessionToken(user) {
  const secret = process.env.JWT_SECRET ?? "hitorichan-default-secret";
  const payload = {
    username: user.username,
    isAdmin: user.isAdmin,
    permissions: user.permissions || [],
    id: user.id ?? null,
  };
  return jwt.sign(payload, secret, { expiresIn: "24h" });
}

export function verifySessionToken(token) {
  const secret = process.env.JWT_SECRET ?? "hitorichan-default-secret";
  try {
    return jwt.verify(token, secret);
  } catch {
    return null;
  }
}

export function hasPermission(user, permission) {
  if (!user) return false;
  if (user.isAdmin) return true;
  if (permission === "users" && user.permissions?.includes("users")) return true;
  if (Array.isArray(permission)) return permission.some((p) => hasPermission(user, p));
  return user.permissions?.includes(permission);
}
