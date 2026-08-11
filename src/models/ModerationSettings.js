import { db } from "../database/db.js";

const getStmt = db.prepare("SELECT * FROM moderation_settings WHERE guild_id = ?");

const upsertStmt = db.prepare(`
  INSERT INTO moderation_settings (guild_id, log_channel_id, mod_role_id)
  VALUES (?, ?, ?)
  ON CONFLICT(guild_id) DO UPDATE SET
    log_channel_id = excluded.log_channel_id,
    mod_role_id = excluded.mod_role_id
`);

function fromRow(row) {
  if (!row) return null;
  return {
    guildId: row.guild_id,
    logChannelId: row.log_channel_id,
    modRoleId: row.mod_role_id,
  };
}

export async function get(guildId) {
  return fromRow(getStmt.get(guildId));
}

export async function getOrCreate(guildId) {
  const existing = getStmt.get(guildId);
  if (existing) return fromRow(existing);

  upsertStmt.run(guildId, null, null);
  return fromRow(getStmt.get(guildId));
}

export async function set(guildId, values) {
  const current = await getOrCreate(guildId);
  const logChannelId = values.logChannelId !== undefined ? values.logChannelId : current.logChannelId;
  const modRoleId = values.modRoleId !== undefined ? values.modRoleId : current.modRoleId;

  upsertStmt.run(guildId, logChannelId, modRoleId);
  return fromRow(getStmt.get(guildId));
}

export default { get, getOrCreate, set };
