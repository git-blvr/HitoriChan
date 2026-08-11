import { db } from "../database/db.js";

const MAX_HISTORY = 25;

const getStmt = db.prepare("SELECT * FROM message_history WHERE user_id = ? AND guild_id = ? AND channel_id = ?");

const upsertStmt = db.prepare(`
  INSERT INTO message_history (user_id, guild_id, channel_id, messages, updated_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(user_id, guild_id, channel_id) DO UPDATE SET
    messages = excluded.messages,
    updated_at = excluded.updated_at
`);

function fromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    messages: JSON.parse(row.messages || "[]"),
    updatedAt: new Date(row.updated_at),
  };
}

export async function get(guildId, userId, channelId) {
  return fromRow(getStmt.get(userId, guildId, channelId));
}

export async function getOrCreate(guildId, userId, channelId) {
  const existing = getStmt.get(userId, guildId, channelId);
  if (existing) return fromRow(existing);

  const now = Date.now();
  const messages = JSON.stringify([]);
  upsertStmt.run(userId, guildId, channelId, messages, now);
  return fromRow(getStmt.get(userId, guildId, channelId));
}

export async function save(history) {
  const now = Date.now();
  const messages = JSON.stringify(history.messages ?? []);
  upsertStmt.run(history.userId, history.guildId, history.channelId, messages, now);
  return fromRow(getStmt.get(history.userId, history.guildId, history.channelId));
}

export async function push(guildId, userId, channelId, message) {
  const history = await getOrCreate(guildId, userId, channelId);
  history.messages.push(message);
  if (history.messages.length > MAX_HISTORY) {
    history.messages = history.messages.slice(-MAX_HISTORY);
  }
  return save(history);
}

export async function trim(guildId, userId, channelId, max = MAX_HISTORY) {
  const history = await getOrCreate(guildId, userId, channelId);
  if (history.messages.length > max) {
    history.messages = history.messages.slice(-max);
    await save(history);
  }
  return history;
}

export default { get, getOrCreate, save, push, trim, MAX_HISTORY };
