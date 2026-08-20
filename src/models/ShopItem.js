import { db } from "../database/db.js";

const getByIdStmt = db.prepare("SELECT * FROM shop_items WHERE id = ?");
const getByGuildStmt = db.prepare("SELECT * FROM shop_items WHERE guild_id = ? ORDER BY sort_order, id");
const getByCategoryStmt = db.prepare("SELECT * FROM shop_items WHERE guild_id = ? AND category_id = ? ORDER BY sort_order, id");
const insertStmt = db.prepare(`
  INSERT INTO shop_items (
    guild_id, category_id, name, description, price, price_secondary, role_id,
    multiplier_type, multiplier_value, special_commands, stock, max_purchases,
    requires_role_id, sort_order, created_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const updateStmt = db.prepare(`
  UPDATE shop_items
  SET name = ?, description = ?, price = ?, price_secondary = ?, role_id = ?,
      multiplier_type = ?, multiplier_value = ?, special_commands = ?,
      stock = ?, max_purchases = ?, requires_role_id = ?, sort_order = ?
  WHERE id = ?
`);
const deleteStmt = db.prepare("DELETE FROM shop_items WHERE id = ?");

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
    id: row.id,
    guildId: row.guild_id,
    categoryId: row.category_id,
    name: row.name,
    description: row.description,
    price: row.price,
    priceSecondary: row.price_secondary,
    roleId: row.role_id,
    multiplierType: row.multiplier_type,
    multiplierValue: row.multiplier_value,
    specialCommands: parseJson(row.special_commands),
    stock: row.stock,
    maxPurchases: row.max_purchases,
    requiresRoleId: row.requires_role_id,
    sortOrder: row.sort_order,
    createdAt: new Date(row.created_at),
  };
}

export async function create({ guildId, categoryId, name, description = "", price = 0, priceSecondary = null, roleId = null, multiplierType = null, multiplierValue = null, specialCommands = [], stock = null, maxPurchases = null, requiresRoleId = null, sortOrder = 0 }) {
  const now = Date.now();
  const result = insertStmt.run(
    guildId, categoryId, name, description, price, priceSecondary, roleId,
    multiplierType, multiplierValue, JSON.stringify(specialCommands), stock,
    maxPurchases, requiresRoleId, sortOrder, now
  );
  return fromRow(getByIdStmt.get(result.lastInsertRowid));
}

export async function getById(id) {
  return fromRow(getByIdStmt.get(id));
}

export async function getByGuild(guildId) {
  return getByGuildStmt.all(guildId).map(fromRow);
}

export async function getByCategory(guildId, categoryId) {
  return getByCategoryStmt.all(guildId, categoryId).map(fromRow);
}

function pick(v, fallback) {
  return v !== undefined ? v : fallback;
}

export async function update(id, values) {
  const item = await getById(id);
  if (!item) throw new Error("Shop item not found.");
  updateStmt.run(
    pick(values.name, item.name),
    pick(values.description, item.description),
    pick(values.price, item.price),
    pick(values.priceSecondary, item.priceSecondary),
    pick(values.roleId, item.roleId),
    pick(values.multiplierType, item.multiplierType),
    pick(values.multiplierValue, item.multiplierValue),
    JSON.stringify(pick(values.specialCommands, item.specialCommands)),
    pick(values.stock, item.stock),
    pick(values.maxPurchases, item.maxPurchases),
    pick(values.requiresRoleId, item.requiresRoleId),
    pick(values.sortOrder, item.sortOrder),
    id
  );
  return getById(id);
}

export async function remove(id) {
  deleteStmt.run(id);
}

export default { create, getById, getByGuild, getByCategory, update, remove };
