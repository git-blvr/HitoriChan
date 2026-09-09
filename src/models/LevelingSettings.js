import { db } from "../database/db.js";

const getStmt = db.prepare("SELECT * FROM leveling_settings WHERE guild_id = ?");
const upsertStmt = db.prepare(`
  INSERT INTO leveling_settings (
    guild_id, enabled, base_xp, multiplier, min_xp, max_xp, cooldown_seconds,
    channels, roles, notify_enabled, notify_channel_id, notify_message, created_at, updated_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(guild_id) DO UPDATE SET
    enabled = excluded.enabled,
    base_xp = excluded.base_xp,
    multiplier = excluded.multiplier,
    min_xp = excluded.min_xp,
    max_xp = excluded.max_xp,
    cooldown_seconds = excluded.cooldown_seconds,
    channels = excluded.channels,
    roles = excluded.roles,
    notify_enabled = excluded.notify_enabled,
    notify_channel_id = excluded.notify_channel_id,
    notify_message = excluded.notify_message,
    updated_at = excluded.updated_at
`);
const deleteStmt = db.prepare("DELETE FROM leveling_settings WHERE guild_id = ?");

function parseJson(json) {
  try {
    return JSON.parse(json) ?? [];
  } catch {
    return [];
  }
}

function fromRow(row) {
  if (!row) return null;
  return {
    guildId: row.guild_id,
    enabled: row.enabled === 1,
    baseXp: row.base_xp,
    multiplier: row.multiplier,
    minXp: row.min_xp,
    maxXp: row.max_xp,
    cooldownSeconds: row.cooldown_seconds,
    channels: parseJson(row.channels),
    roles: parseJson(row.roles),
    notifyEnabled: row.notify_enabled === 1,
    notifyChannelId: row.notify_channel_id ?? null,
    notifyMessage: row.notify_message,
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
  upsertStmt.run(
    guildId,
    0, 100, 1.5, 15, 25, 60,
    "[]", "[]", 1, null, "GG {user}, you leveled up to level {level}!",
    now, now
  );
  return fromRow(getStmt.get(guildId));
}

export async function save(guildId, values) {
  const current = await getOrCreate(guildId);
  const now = Date.now();

  const toBool = (v, d) => (v !== undefined ? (v ? 1 : 0) : (d ? 1 : 0));
  const toNum = (v, d) => (v !== undefined ? Number(v) ?? d : d);
  const toStrArr = (v, d) => JSON.stringify(v !== undefined ? (Array.isArray(v) ? v : d) : d);
  const toStr = (v, d) => v !== undefined ? (v || d) : d;

  upsertStmt.run(
    guildId,
    toBool(values.enabled, current.enabled),
    toNum(values.baseXp, current.baseXp),
    toNum(values.multiplier, current.multiplier),
    toNum(values.minXp, current.minXp),
    toNum(values.maxXp, current.maxXp),
    toNum(values.cooldownSeconds, current.cooldownSeconds),
    toStrArr(values.channels, current.channels),
    toStrArr(values.roles, current.roles),
    toBool(values.notifyEnabled, current.notifyEnabled),
    values.notifyChannelId !== undefined ? (values.notifyChannelId || null) : current.notifyChannelId,
    toStr(values.notifyMessage, current.notifyMessage),
    current.createdAt ?? now,
    now
  );

  return fromRow(getStmt.get(guildId));
}

export async function remove(guildId) {
  return deleteStmt.run(guildId);
}

export default { get, getOrCreate, save, remove };
