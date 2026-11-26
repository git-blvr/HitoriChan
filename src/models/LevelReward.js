import { db } from "../database/db.js";

const listStmt = db.prepare("SELECT * FROM level_rewards WHERE guild_id = ? ORDER BY level ASC, id ASC");
const getStmt = db.prepare("SELECT * FROM level_rewards WHERE id = ?");
const levelsStmt = db.prepare(`
  SELECT * FROM level_rewards
  WHERE guild_id = ? AND level > ? AND level <= ? AND enabled = 1
  ORDER BY level ASC
`);
const lowerRoleRewardsStmt = db.prepare(`
  SELECT * FROM level_rewards
  WHERE guild_id = ? AND reward_type = 'role' AND level < ? AND enabled = 1 AND role_id IS NOT NULL
`);
const insertStmt = db.prepare(`
  INSERT INTO level_rewards (guild_id, level, reward_type, role_id, currency, amount, enabled, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const updateStmt = db.prepare(`
  UPDATE level_rewards SET
    level = ?, reward_type = ?, role_id = ?, currency = ?, amount = ?, enabled = ?, updated_at = ?
  WHERE id = ?
`);
const deleteStmt = db.prepare("DELETE FROM level_rewards WHERE id = ?");

export const REWARD_TYPES = ["role", "currency"];
export const CURRENCIES = ["primary", "secondary"];

function fromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    guildId: row.guild_id,
    level: row.level,
    rewardType: row.reward_type,
    roleId: row.role_id ?? null,
    currency: row.currency ?? null,
    amount: row.amount ?? 0,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listForGuild(guildId) {
  return listStmt.all(guildId).map(fromRow);
}

// Rewards earned when moving from `oldLevel` (exclusive) to `newLevel` (inclusive).
export async function listForLevels(guildId, oldLevel, newLevel) {
  return levelsStmt.all(guildId, oldLevel, newLevel).map(fromRow);
}

// Role rewards configured below a level — used to strip superseded roles.
export async function listRoleRewardsBelow(guildId, level) {
  return lowerRoleRewardsStmt.all(guildId, level).map(fromRow);
}

export async function get(id) {
  return fromRow(getStmt.get(id));
}

export async function create(guildId, values) {
  const now = Date.now();
  const res = insertStmt.run(
    guildId,
    Math.max(1, Math.floor(Number(values.level) || 1)),
    values.rewardType,
    values.roleId || null,
    values.currency || null,
    Math.max(0, Math.floor(Number(values.amount) || 0)),
    values.enabled === undefined || values.enabled ? 1 : 0,
    now,
    now
  );
  return fromRow(getStmt.get(res.lastInsertRowid));
}

export async function update(id, values) {
  const current = getStmt.get(id);
  if (!current) return null;
  const cur = fromRow(current);
  updateStmt.run(
    values.level !== undefined ? Math.max(1, Math.floor(Number(values.level) || 1)) : cur.level,
    values.rewardType !== undefined ? values.rewardType : cur.rewardType,
    values.roleId !== undefined ? (values.roleId || null) : cur.roleId,
    values.currency !== undefined ? (values.currency || null) : cur.currency,
    values.amount !== undefined ? Math.max(0, Math.floor(Number(values.amount) || 0)) : cur.amount,
    values.enabled !== undefined ? (values.enabled ? 1 : 0) : (cur.enabled ? 1 : 0),
    Date.now(),
    id
  );
  return fromRow(getStmt.get(id));
}

export async function remove(id) {
  return deleteStmt.run(id);
}

export default { listForGuild, listForLevels, listRoleRewardsBelow, get, create, update, remove, REWARD_TYPES, CURRENCIES };
