import { db } from "../database/db.js";

const listStmt = db.prepare("SELECT * FROM quests WHERE guild_id = ? ORDER BY name");
const getStmt = db.prepare("SELECT * FROM quests WHERE id = ?");
const getByGuildStmt = db.prepare("SELECT * FROM quests WHERE guild_id = ? AND enabled = 1");
const insertStmt = db.prepare(`
  INSERT INTO quests (guild_id, name, description, schedule, dsl, condition, variables, tasks, reward_type, reward_value, reward_amount, enabled, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const updateStmt = db.prepare(`
  UPDATE quests SET
    name = ?, description = ?, schedule = ?, dsl = ?, condition = ?, variables = ?, tasks = ?,
    reward_type = ?, reward_value = ?, reward_amount = ?, enabled = ?, updated_at = ?
  WHERE id = ?
`);
const deleteStmt = db.prepare("DELETE FROM quests WHERE id = ?");

function parseJson(json, fallback) {
  try {
    return JSON.parse(json) ?? fallback;
  } catch {
    return fallback;
  }
}

function fromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    guildId: row.guild_id,
    name: row.name,
    description: row.description,
    schedule: row.schedule,
    dsl: row.dsl,
    condition: parseJson(row.condition, []),
    variables: parseJson(row.variables, {}),
    tasks: parseJson(row.tasks, []),
    rewardType: row.reward_type,
    rewardValue: row.reward_value,
    rewardAmount: row.reward_amount,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getAllForGuild(guildId) {
  return listStmt.all(guildId).map(fromRow);
}

export async function getEnabledForGuild(guildId) {
  return getByGuildStmt.all(guildId).map(fromRow);
}

export async function get(id) {
  return fromRow(getStmt.get(id));
}

export async function create(data) {
  const now = Date.now();
  const result = insertStmt.run(
    data.guildId,
    data.name,
    data.description ?? null,
    data.schedule ?? "once",
    data.dsl ?? "",
    JSON.stringify(data.condition ?? []),
    JSON.stringify(data.variables ?? {}),
    JSON.stringify(data.tasks ?? []),
    data.rewardType ?? null,
    data.rewardValue ?? null,
    data.rewardAmount ?? null,
    data.enabled !== false ? 1 : 0,
    now,
    now
  );
  return get(result.lastInsertRowid);
}

export async function update(id, data) {
  const quest = await get(id);
  if (!quest) return null;
  const now = Date.now();
  updateStmt.run(
    data.name ?? quest.name,
    data.description ?? quest.description,
    data.schedule ?? quest.schedule,
    data.dsl ?? quest.dsl,
    JSON.stringify(data.condition ?? quest.condition ?? []),
    JSON.stringify(data.variables ?? quest.variables),
    JSON.stringify(data.tasks ?? quest.tasks),
    data.rewardType ?? quest.rewardType,
    data.rewardValue ?? quest.rewardValue,
    data.rewardAmount ?? quest.rewardAmount,
    data.enabled !== undefined ? (data.enabled ? 1 : 0) : (quest.enabled ? 1 : 0),
    now,
    id
  );
  return get(id);
}

export async function remove(id) {
  return deleteStmt.run(id);
}
