import { db } from "../database/db.js";

const upsertStmt = db.prepare(`
  INSERT INTO afk_statuses (user_id, guild_id, message, since)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(user_id, guild_id) DO UPDATE SET
    message = excluded.message,
    since = excluded.since
`);

const getStmt = db.prepare("SELECT * FROM afk_statuses WHERE user_id = ? AND guild_id = ?");
const deleteStmt = db.prepare("DELETE FROM afk_statuses WHERE user_id = ? AND guild_id = ?");
const getManyStmt = db.prepare(`
  SELECT * FROM afk_statuses WHERE guild_id = ? AND user_id IN (SELECT value FROM json_each(?))
`);

function parse(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    guildId: row.guild_id,
    message: row.message,
    since: row.since,
  };
}

export function set(userId, guildId, message) {
  upsertStmt.run(userId, guildId, message ?? null, Date.now());
  return get(userId, guildId);
}

export function get(userId, guildId) {
  return parse(getStmt.get(userId, guildId));
}

export function clear(userId, guildId) {
  return deleteStmt.run(userId, guildId).changes > 0;
}

export function getForUsers(guildId, userIds) {
  if (!userIds?.length) return new Map();
  const rows = getManyStmt.all(guildId, JSON.stringify(userIds));
  return new Map(rows.map((r) => [r.user_id, parse(r)]));
}

export default { set, get, clear, getForUsers };
