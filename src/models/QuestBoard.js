import { db } from "../database/db.js";

const getStmt = db.prepare("SELECT * FROM quest_boards WHERE guild_id = ?");
const upsertStmt = db.prepare(`
  INSERT INTO quest_boards (guild_id, channel_id, message_id, enabled, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(guild_id) DO UPDATE SET
    channel_id = excluded.channel_id,
    message_id = excluded.message_id,
    enabled = excluded.enabled,
    updated_at = excluded.updated_at
`);
const deleteStmt = db.prepare("DELETE FROM quest_boards WHERE guild_id = ?");

function fromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    guildId: row.guild_id,
    channelId: row.channel_id ?? null,
    messageId: row.message_id ?? null,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function get(guildId) {
  return fromRow(getStmt.get(guildId));
}

export async function getOrCreate(guildId) {
  const existing = getStmt.get(guildId);
  if (existing) return fromRow(existing);

  const now = Date.now();
  upsertStmt.run(guildId, null, null, 1, now, now);
  return fromRow(getStmt.get(guildId));
}

export async function save(guildId, values) {
  const current = await getOrCreate(guildId);
  const now = Date.now();
  upsertStmt.run(
    guildId,
    values.channelId !== undefined ? (values.channelId || null) : current.channelId,
    values.messageId !== undefined ? (values.messageId || null) : current.messageId,
    values.enabled !== undefined ? (values.enabled ? 1 : 0) : (current.enabled ? 1 : 0),
    current.createdAt ?? now,
    now
  );
  return fromRow(getStmt.get(guildId));
}

export async function remove(guildId) {
  return deleteStmt.run(guildId);
}
