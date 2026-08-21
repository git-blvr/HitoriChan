import { db } from "../database/db.js";

const DEFAULTS = {
  enabled: false,
  rewardPrimary: 0,
  rewardSecondary: 0,
  roleId: null,
  earningsMultiplier: 0,
  level: 0,
  specialCommands: [],
  messageChannelId: null,
  thankMessage: "Thank you for boosting the server, {user}!",
};

const getStmt = db.prepare("SELECT * FROM boost_settings WHERE guild_id = ?");

const upsertStmt = db.prepare(`
  INSERT INTO boost_settings (
    guild_id, enabled, reward_primary, reward_secondary, role_id,
    earnings_multiplier, level, special_commands, message_channel_id, thank_message, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(guild_id) DO UPDATE SET
    enabled = excluded.enabled,
    reward_primary = excluded.reward_primary,
    reward_secondary = excluded.reward_secondary,
    role_id = excluded.role_id,
    earnings_multiplier = excluded.earnings_multiplier,
    level = excluded.level,
    special_commands = excluded.special_commands,
    message_channel_id = excluded.message_channel_id,
    thank_message = excluded.thank_message,
    updated_at = excluded.updated_at
`);

function parseJson(json) {
  if (!json) return [];
  try {
    return JSON.parse(json);
  } catch {
    return [];
  }
}

function fromRow(row) {
  if (!row) return null;
  return {
    guildId: row.guild_id,
    enabled: Boolean(row.enabled),
    rewardPrimary: row.reward_primary ?? DEFAULTS.rewardPrimary,
    rewardSecondary: row.reward_secondary ?? DEFAULTS.rewardSecondary,
    roleId: row.role_id ?? DEFAULTS.roleId,
    earningsMultiplier: row.earnings_multiplier ?? DEFAULTS.earningsMultiplier,
    level: row.level ?? DEFAULTS.level,
    specialCommands: parseJson(row.special_commands),
    messageChannelId: row.message_channel_id ?? DEFAULTS.messageChannelId,
    thankMessage: row.thank_message ?? DEFAULTS.thankMessage,
    updatedAt: new Date(row.updated_at),
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
    DEFAULTS.enabled ? 1 : 0,
    DEFAULTS.rewardPrimary,
    DEFAULTS.rewardSecondary,
    DEFAULTS.roleId,
    DEFAULTS.earningsMultiplier,
    DEFAULTS.level,
    JSON.stringify(DEFAULTS.specialCommands),
    DEFAULTS.messageChannelId,
    DEFAULTS.thankMessage,
    now
  );
  return fromRow(getStmt.get(guildId));
}

export async function save(guildId, values) {
  const current = await getOrCreate(guildId);
  const now = Date.now();
  upsertStmt.run(
    guildId,
    values.enabled !== undefined ? (values.enabled ? 1 : 0) : (current.enabled ? 1 : 0),
    values.rewardPrimary !== undefined ? values.rewardPrimary : current.rewardPrimary,
    values.rewardSecondary !== undefined ? values.rewardSecondary : current.rewardSecondary,
    values.roleId !== undefined ? values.roleId : current.roleId,
    values.earningsMultiplier !== undefined ? values.earningsMultiplier : current.earningsMultiplier,
    values.level !== undefined ? values.level : current.level,
    JSON.stringify(values.specialCommands !== undefined ? values.specialCommands : current.specialCommands),
    values.messageChannelId !== undefined ? values.messageChannelId : current.messageChannelId,
    values.thankMessage !== undefined ? values.thankMessage : current.thankMessage,
    now
  );
  return fromRow(getStmt.get(guildId));
}

export default { get, getOrCreate, save };
