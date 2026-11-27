import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { db } from "../database/db.js";

const listStmt = db.prepare("SELECT id, username, permissions, created_at FROM users ORDER BY username");
const getStmt = db.prepare("SELECT * FROM users WHERE id = ?");
const getByUsernameStmt = db.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE");
const insertStmt = db.prepare("INSERT INTO users (username, password_hash, permissions, created_at) VALUES (?, ?, ?, ?)");
const updateStmt = db.prepare("UPDATE users SET username = ?, password_hash = ?, permissions = ? WHERE id = ?");
const deleteStmt = db.prepare("DELETE FROM users WHERE id = ?");

const SCRYPT_KEYLEN = 64;

function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

function verifyPassword(password, stored) {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expectedHash = Buffer.from(hashHex, "hex");
  const actualHash = scryptSync(password, salt, SCRYPT_KEYLEN);
  if (actualHash.length !== expectedHash.length) return false;
  return timingSafeEqual(actualHash, expectedHash);
}

function parsePermissions(json) {
  try {
    return JSON.parse(json) || [];
  } catch {
    return [];
  }
}

function fromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    permissions: parsePermissions(row.permissions),
    createdAt: new Date(row.created_at),
  };
}

export function isValidPermission(permission) {
  return ALL_PERMISSIONS.includes(permission);
}

export const ALL_PERMISSIONS = [
  "overview",
  "economy",
  "ai",
  "streak",
  "moderation",
  "cases",
  "tickets",
  "shop",
  "boost",
  "triggers",
  "welcome",
  "logs",
  "quests",
  "leveling",
  "interactions",
  "gifmaker",
  "studio",
  "bot",
  "security",
  "users",
];

export const RESERVED_USERNAMES = ["admin"];
export const USERNAME_PATTERN = /^[A-Za-z0-9_.-]{3,32}$/;
export const PASSWORD_MIN_LENGTH = 8;

export function isReservedUsername(username) {
  return RESERVED_USERNAMES.includes(String(username ?? "").toLowerCase());
}

export function usernamePolicyError(username) {
  if (!USERNAME_PATTERN.test(String(username ?? ""))) {
    return "Username must be 3-32 characters of letters, numbers, dots, dashes or underscores";
  }
  return null;
}

export function passwordPolicyError(password) {
  if (typeof password !== "string" || password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  }
  if (password.length > 256) return "Password is too long";
  return null;
}

export function normalizePermissions(input) {
  const list = Array.isArray(input) ? input : (typeof input === "string" ? input.split(/[\n,]+/).map((s) => s.trim()) : []);
  return list.filter((p) => p && isValidPermission(p));
}

export async function getAll() {
  return listStmt.all().map(fromRow);
}

export async function get(id) {
  return fromRow(getStmt.get(id));
}

export async function getByUsername(username) {
  return fromRow(getByUsernameStmt.get(username));
}

export async function create(data) {
  const usernameError = usernamePolicyError(data.username);
  if (usernameError) throw new Error(usernameError);
  if (isReservedUsername(data.username)) throw new Error("That username is reserved");
  if (!data.passwordHash) {
    const passwordError = passwordPolicyError(data.password);
    if (passwordError) throw new Error(passwordError);
  }
  const passwordHash = data.passwordHash || hashPassword(data.password);
  const perms = JSON.stringify(normalizePermissions(data.permissions));
  const now = Date.now();
  const result = insertStmt.run(data.username, passwordHash, perms, now);
  return get(result.lastInsertRowid);
}

export async function update(id, data) {
  const user = await get(id);
  if (!user) return null;

  const username = data.username ?? user.username;
  const passwordHash = data.password ? hashPassword(data.password) : user.passwordHash;
  const perms = data.permissions !== undefined
    ? JSON.stringify(normalizePermissions(data.permissions))
    : JSON.stringify(user.permissions);

  updateStmt.run(username, passwordHash, perms, id);
  return get(id);
}

export async function remove(id) {
  return deleteStmt.run(id);
}

export async function verify(username, password) {
  const user = await getByUsername(username);
  if (!user) return null;
  if (!verifyPassword(password, user.passwordHash)) return null;
  return user;
}
