import { db } from "../database/db.js";

const getByIdStmt = db.prepare("SELECT * FROM shop_categories WHERE id = ?");
const getByGuildStmt = db.prepare("SELECT * FROM shop_categories WHERE guild_id = ? ORDER BY sort_order, id");
const insertStmt = db.prepare(`
  INSERT INTO shop_categories (guild_id, name, description, sort_order, created_at)
  VALUES (?, ?, ?, ?, ?)
`);
const updateStmt = db.prepare(`
  UPDATE shop_categories
  SET name = ?, description = ?, sort_order = ?, created_at = created_at
  WHERE id = ?
`);
const deleteStmt = db.prepare("DELETE FROM shop_categories WHERE id = ?");

function fromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    guildId: row.guild_id,
    name: row.name,
    description: row.description,
    sortOrder: row.sort_order,
    createdAt: new Date(row.created_at),
  };
}

export async function create({ guildId, name, description = "", sortOrder = 0 }) {
  const now = Date.now();
  const result = insertStmt.run(guildId, name, description, sortOrder, now);
  return fromRow(getByIdStmt.get(result.lastInsertRowid));
}

export async function getById(id) {
  return fromRow(getByIdStmt.get(id));
}

export async function getByGuild(guildId) {
  return getByGuildStmt.all(guildId).map(fromRow);
}

function pick(v, fallback) {
  return v !== undefined ? v : fallback;
}

export async function update(id, values) {
  const category = await getById(id);
  if (!category) throw new Error("Shop category not found.");
  updateStmt.run(
    pick(values.name, category.name),
    pick(values.description, category.description),
    pick(values.sortOrder, category.sortOrder),
    id
  );
  return getById(id);
}

export async function remove(id) {
  deleteStmt.run(id);
}

export default { create, getById, getByGuild, update, remove };
