import { db } from "../database/db.js";

const getByIdStmt = db.prepare("SELECT * FROM shop_purchases WHERE id = ?");
const getByUserStmt = db.prepare("SELECT * FROM shop_purchases WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC");
const countByUserItemStmt = db.prepare("SELECT COUNT(*) AS count FROM shop_purchases WHERE guild_id = ? AND user_id = ? AND item_id = ?");
const countByItemStmt = db.prepare("SELECT COUNT(*) AS count FROM shop_purchases WHERE guild_id = ? AND item_id = ?");
const insertStmt = db.prepare(`
  INSERT INTO shop_purchases (guild_id, user_id, item_id, quantity, expires_at, created_at)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const deleteByIdStmt = db.prepare("DELETE FROM shop_purchases WHERE id = ?");
const deleteByUserItemStmt = db.prepare("DELETE FROM shop_purchases WHERE guild_id = ? AND user_id = ? AND item_id = ?");

function fromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    guildId: row.guild_id,
    userId: row.user_id,
    itemId: row.item_id,
    quantity: row.quantity,
    expiresAt: row.expires_at,
    createdAt: new Date(row.created_at),
  };
}

export async function create({ guildId, userId, itemId, quantity = 1, expiresAt = null }) {
  const now = Date.now();
  const result = insertStmt.run(guildId, userId, itemId, quantity, expiresAt ?? null, now);
  return fromRow(getByIdStmt.get(result.lastInsertRowid));
}

export async function getByUser(guildId, userId) {
  return getByUserStmt.all(guildId, userId).map(fromRow);
}

export function isExpired(purchase) {
  return purchase?.expiresAt != null && purchase.expiresAt <= Date.now();
}

export async function getActiveByUser(guildId, userId) {
  return (await getByUser(guildId, userId)).filter((p) => !isExpired(p));
}

export async function getUserItemCount(guildId, userId, itemId) {
  return countByUserItemStmt.get(guildId, userId, itemId)?.count ?? 0;
}

export async function getItemTotalCount(guildId, itemId) {
  return countByItemStmt.get(guildId, itemId)?.count ?? 0;
}

export async function remove(purchaseId) {
  deleteByIdStmt.run(purchaseId);
}

export async function removeAllByItem(guildId, userId, itemId) {
  deleteByUserItemStmt.run(guildId, userId, itemId);
}

export default { create, getByUser, getActiveByUser, isExpired, getUserItemCount, getItemTotalCount, remove, removeAllByItem };
