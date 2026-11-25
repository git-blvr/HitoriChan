import { createHash, randomBytes } from "node:crypto";
import { db } from "../database/db.js";

const TOKEN_PREFIX = "hcs_";
const TOKEN_BYTES = 32;
const PRUNE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const insertStmt = db.prepare(
  `INSERT INTO dashboard_sessions (token_hash, username, is_admin, permissions, auth_type, discord_id, display_name, avatar, guilds, ip, user_agent, created_at, last_seen_at, expires_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
const getByHashStmt = db.prepare("SELECT * FROM dashboard_sessions WHERE token_hash = ?");
const touchStmt = db.prepare("UPDATE dashboard_sessions SET last_seen_at = ?, expires_at = ?, ip = ?, user_agent = ? WHERE id = ?");
const revokeStmt = db.prepare("UPDATE dashboard_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL");
const revokeForUserStmt = db.prepare("UPDATE dashboard_sessions SET revoked_at = ? WHERE username = ? AND revoked_at IS NULL AND id != ?");
const listAllStmt = db.prepare("SELECT * FROM dashboard_sessions WHERE revoked_at IS NULL AND expires_at > ? ORDER BY last_seen_at DESC");
const listForUserStmt = db.prepare("SELECT * FROM dashboard_sessions WHERE username = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY last_seen_at DESC");
const getByIdStmt = db.prepare("SELECT * FROM dashboard_sessions WHERE id = ?");
const pruneStmt = db.prepare("DELETE FROM dashboard_sessions WHERE expires_at < ? OR revoked_at < ?");

function hashToken(token) {
  return createHash("sha256").update(String(token)).digest("hex");
}

function fromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    isAdmin: Boolean(row.is_admin),
    permissions: JSON.parse(row.permissions || "[]"),
    ip: row.ip,
    userAgent: row.user_agent,
    authType: row.auth_type || "local",
    discordId: row.discord_id || null,
    displayName: row.display_name || null,
    avatar: row.avatar || null,
    // null guilds = unrestricted (local users & developers); array = ACL list
    guilds: row.guilds ? JSON.parse(row.guilds) : null,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
}

export function create({ username, isAdmin = false, permissions = [], authType = "local", discordId = null, displayName = null, avatar = null, guilds = null, ip = null, userAgent = null, ttlMs }) {
  const token = TOKEN_PREFIX + randomBytes(TOKEN_BYTES).toString("base64url");
  const now = Date.now();
  const expiresAt = now + ttlMs;
  const result = insertStmt.run(
    hashToken(token), username, isAdmin ? 1 : 0, JSON.stringify(permissions),
    authType, discordId, displayName, avatar,
    guilds == null ? null : JSON.stringify(guilds),
    ip, userAgent && String(userAgent).slice(0, 512), now, now, expiresAt
  );
  return { token, id: result.lastInsertRowid, expiresAt };
}

export function getByToken(token) {
  if (typeof token !== "string" || !token.startsWith(TOKEN_PREFIX)) return null;
  const row = getByHashStmt.get(hashToken(token));
  if (!row || row.revoked_at || row.expires_at <= Date.now()) return null;
  return { session: fromRow(row), tokenHash: hashToken(token) };
}

export function touch(id, { expiresAt, ip, userAgent }) {
  touchStmt.run(Date.now(), expiresAt, ip ?? null, userAgent && String(userAgent).slice(0, 512), id);
}

export function getById(id) {
  return fromRow(getByIdStmt.get(id));
}

export function revoke(id) {
  return revokeStmt.run(Date.now(), id).changes > 0;
}

export function revokeAllForUser(username, exceptSessionId = -1) {
  return revokeForUserStmt.run(Date.now(), username, exceptSessionId).changes;
}

export function listForUser(username) {
  return listForUserStmt.all(username, Date.now()).map(fromRow);
}

export function listAll() {
  return listAllStmt.all(Date.now()).map(fromRow);
}

export function prune() {
  const cutoff = Date.now() - PRUNE_AGE_MS;
  return pruneStmt.run(Date.now(), cutoff).changes;
}
