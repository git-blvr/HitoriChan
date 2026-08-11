import { db } from "../database/db.js";

const DEFAULTS = {
  guildId: null,
  enabled: false,
  mode: "everywhere",
  channelId: null,
  customPrompt: null,
};

const getStmt = db.prepare("SELECT * FROM ai_settings WHERE guild_id = ?");

const upsertStmt = db.prepare(`
  INSERT INTO ai_settings (guild_id, enabled, mode, channel_id, custom_prompt)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(guild_id) DO UPDATE SET
    enabled = excluded.enabled,
    mode = excluded.mode,
    channel_id = excluded.channel_id,
    custom_prompt = excluded.custom_prompt
`);

function fromRow(row) {
  if (!row) return null;
  return {
    guildId: row.guild_id,
    enabled: Boolean(row.enabled),
    mode: row.mode,
    channelId: row.channel_id,
    customPrompt: row.custom_prompt,
  };
}

export async function get(guildId) {
  return fromRow(getStmt.get(guildId));
}

export async function getOrCreate(guildId) {
  const existing = getStmt.get(guildId);
  if (existing) return fromRow(existing);

  upsertStmt.run(guildId, DEFAULTS.enabled ? 1 : 0, DEFAULTS.mode, DEFAULTS.channelId, DEFAULTS.customPrompt);
  return fromRow(getStmt.get(guildId));
}

export async function set(guildId, values) {
  const current = await getOrCreate(guildId);
  const enabled = values.enabled !== undefined ? (values.enabled ? 1 : 0) : (current.enabled ? 1 : 0);
  const mode = values.mode ?? current.mode;
  const channelId = values.channelId !== undefined ? values.channelId : current.channelId;
  const customPrompt = values.customPrompt !== undefined ? values.customPrompt : current.customPrompt;

  upsertStmt.run(guildId, enabled, mode, channelId, customPrompt);
  return fromRow(getStmt.get(guildId));
}

export async function toggle(guildId) {
  const current = await getOrCreate(guildId);
  return set(guildId, { enabled: !current.enabled });
}

export async function setMode(guildId, mode) {
  return set(guildId, { mode });
}

export async function setChannel(guildId, channelId) {
  return set(guildId, { channelId, mode: "channel" });
}

export async function setCustomPrompt(guildId, prompt) {
  return set(guildId, { customPrompt: prompt });
}

export default { get, getOrCreate, set, toggle, setMode, setChannel, setCustomPrompt };
