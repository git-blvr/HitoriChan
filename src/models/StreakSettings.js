import { db } from "../database/db.js";

const getStmt = db.prepare("SELECT * FROM streak_settings WHERE guild_id = ?");

const upsertStmt = db.prepare(`
  INSERT INTO streak_settings (guild_id, enabled, track_channel_id, notify_channel_id)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(guild_id) DO UPDATE SET
    enabled = excluded.enabled,
    track_channel_id = excluded.track_channel_id,
    notify_channel_id = excluded.notify_channel_id
`);

function fromRow(row) {
  if (!row) return null;
  return {
    guildId: row.guild_id,
    enabled: Boolean(row.enabled),
    trackChannelId: row.track_channel_id,
    notifyChannelId: row.notify_channel_id,
  };
}

export async function get(guildId) {
  return fromRow(getStmt.get(guildId));
}

export async function getOrCreate(guildId) {
  const existing = getStmt.get(guildId);
  if (existing) return fromRow(existing);

  upsertStmt.run(guildId, 0, null, null);
  return fromRow(getStmt.get(guildId));
}

export async function set(guildId, values) {
  const current = await getOrCreate(guildId);
  const enabled = values.enabled !== undefined ? (values.enabled ? 1 : 0) : (current.enabled ? 1 : 0);
  const trackChannelId = values.trackChannelId !== undefined ? values.trackChannelId : current.trackChannelId;
  const notifyChannelId = values.notifyChannelId !== undefined ? values.notifyChannelId : current.notifyChannelId;

  upsertStmt.run(guildId, enabled, trackChannelId, notifyChannelId);
  return fromRow(getStmt.get(guildId));
}

export async function toggle(guildId) {
  const current = await getOrCreate(guildId);
  return set(guildId, { enabled: !current.enabled });
}

export default { get, getOrCreate, set, toggle };
