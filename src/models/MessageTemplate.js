import { db } from "../database/db.js";

const insertStmt = db.prepare(`
  INSERT INTO message_templates (guild_id, name, payload, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?)
`);

const updateStmt = db.prepare(`
  UPDATE message_templates SET name = ?, payload = ?, updated_at = ? WHERE id = ? AND guild_id = ?
`);

const getStmt = db.prepare("SELECT * FROM message_templates WHERE id = ? AND guild_id = ?");
const listStmt = db.prepare("SELECT * FROM message_templates WHERE guild_id = ? ORDER BY name ASC");
const deleteStmt = db.prepare("DELETE FROM message_templates WHERE id = ? AND guild_id = ?");
const nameStmt = db.prepare("SELECT * FROM message_templates WHERE guild_id = ? AND name = ?");

function parse(row) {
  if (!row) return null;
  let payload = {};
  try {
    payload = JSON.parse(row.payload || "{}");
  } catch {
    payload = {};
  }
  return {
    id: row.id,
    guildId: row.guild_id,
    name: row.name,
    payload,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export function create(guildId, name, payload) {
  const now = Date.now();
  const res = insertStmt.run(guildId, name, JSON.stringify(payload ?? {}), now, now);
  return get(guildId, res.lastInsertRowid);
}

export function update(guildId, id, { name, payload }) {
  const existing = get(guildId, id);
  if (!existing) return null;
  updateStmt.run(
    name ?? existing.name,
    JSON.stringify(payload !== undefined ? payload : existing.payload),
    Date.now(),
    id,
    guildId
  );
  return get(guildId, id);
}

export function get(guildId, id) {
  return parse(getStmt.get(id, guildId));
}

export function getByName(guildId, name) {
  return parse(nameStmt.get(guildId, name));
}

export function list(guildId) {
  return listStmt.all(guildId).map(parse);
}

export function remove(guildId, id) {
  return deleteStmt.run(id, guildId).changes > 0;
}

export default { create, update, get, getByName, list, remove };
