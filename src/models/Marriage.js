import { db } from "../database/db.js";

const getStmt = db.prepare("SELECT * FROM marriages WHERE id = ?");
const getByUserStmt = db.prepare("SELECT * FROM marriages WHERE guild_id = ? AND (user_id_1 = ? OR user_id_2 = ?)");
const getByCoupleStmt = db.prepare("SELECT * FROM marriages WHERE guild_id = ? AND ((user_id_1 = ? AND user_id_2 = ?) OR (user_id_1 = ? AND user_id_2 = ?))");
const insertStmt = db.prepare("INSERT INTO marriages (guild_id, user_id_1, user_id_2, created_at) VALUES (?, ?, ?, ?)");
const deleteStmt = db.prepare("DELETE FROM marriages WHERE id = ?");

function fromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    guildId: row.guild_id,
    userId1: row.user_id_1,
    userId2: row.user_id_2,
    createdAt: new Date(row.created_at),
  };
}

export async function create(guildId, userId1, userId2) {
  const now = Date.now();
  const result = insertStmt.run(guildId, userId1, userId2, now);
  return fromRow(getStmt.get(result.lastInsertRowid));
}

export async function getByUser(guildId, userId) {
  return getByUserStmt.all(guildId, userId, userId).map(fromRow);
}

export async function getByCouple(guildId, userId1, userId2) {
  return fromRow(getByCoupleStmt.get(guildId, userId1, userId2, userId2, userId1));
}

export async function exists(guildId, userId1, userId2) {
  return !!await getByCouple(guildId, userId1, userId2);
}

export async function isMarried(guildId, userId) {
  const rows = getByUserStmt.all(guildId, userId, userId);
  return rows.length > 0;
}

export async function getPartner(guildId, userId) {
  const rows = getByUserStmt.all(guildId, userId, userId);
  if (!rows.length) return null;
  const row = rows[0];
  return row.user_id_1 === userId ? row.user_id_2 : row.user_id_1;
}

export async function removeMarriage(id) {
  return deleteStmt.run(id);
}

export async function removeByUser(guildId, userId) {
  const marriage = (await getByUser(guildId, userId))[0];
  if (marriage) return removeMarriage(marriage.id);
  return null;
}

export default { create, getByUser, getByCouple, exists, isMarried, getPartner, removeMarriage, removeByUser };
