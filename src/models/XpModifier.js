import { db } from "../database/db.js";

const listStmt = db.prepare("SELECT * FROM xp_modifiers WHERE guild_id = ? ORDER BY id ASC");
const getStmt = db.prepare("SELECT * FROM xp_modifiers WHERE id = ?");
const insertStmt = db.prepare(`
  INSERT INTO xp_modifiers (guild_id, target_type, target_id, multiplier, applies_to, enabled, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const updateStmt = db.prepare(`
  UPDATE xp_modifiers SET
    target_type = ?, target_id = ?, multiplier = ?, applies_to = ?, enabled = ?, updated_at = ?
  WHERE id = ?
`);
const deleteStmt = db.prepare("DELETE FROM xp_modifiers WHERE id = ?");

export const TARGET_TYPES = ["channel", "role", "user"];
export const APPLIES_TO = ["all", "text", "voice"];

function fromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    guildId: row.guild_id,
    targetType: row.target_type,
    targetId: row.target_id,
    multiplier: row.multiplier ?? 1,
    appliesTo: row.applies_to ?? "all",
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listForGuild(guildId) {
  return listStmt.all(guildId).map(fromRow);
}

export async function get(id) {
  return fromRow(getStmt.get(id));
}

export async function create(guildId, values) {
  const now = Date.now();
  const res = insertStmt.run(
    guildId,
    values.targetType,
    String(values.targetId),
    Number(values.multiplier),
    values.appliesTo || "all",
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
    values.targetType !== undefined ? values.targetType : cur.targetType,
    values.targetId !== undefined ? String(values.targetId) : cur.targetId,
    values.multiplier !== undefined ? Number(values.multiplier) : cur.multiplier,
    values.appliesTo !== undefined ? (values.appliesTo || "all") : cur.appliesTo,
    values.enabled !== undefined ? (values.enabled ? 1 : 0) : (cur.enabled ? 1 : 0),
    Date.now(),
    id
  );
  return fromRow(getStmt.get(id));
}

export async function remove(id) {
  return deleteStmt.run(id);
}

export default { listForGuild, get, create, update, remove, TARGET_TYPES, APPLIES_TO };
