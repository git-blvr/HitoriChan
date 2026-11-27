import { db } from "../database/db.js";

const insertStmt = db.prepare(`
  INSERT INTO reminders (guild_id, channel_id, user_id, message, remind_at, delivered, created_at)
  VALUES (?, ?, ?, ?, ?, 0, ?)
`);

const getStmt = db.prepare("SELECT * FROM reminders WHERE id = ?");
const dueStmt = db.prepare("SELECT * FROM reminders WHERE delivered = 0 AND remind_at <= ? ORDER BY remind_at ASC LIMIT 100");
const pendingStmt = db.prepare("SELECT * FROM reminders WHERE delivered = 0 ORDER BY remind_at ASC");
const forUserStmt = db.prepare("SELECT * FROM reminders WHERE user_id = ? AND delivered = 0 ORDER BY remind_at ASC LIMIT 25");
const markDeliveredStmt = db.prepare("UPDATE reminders SET delivered = 1 WHERE id = ?");
const deleteStmt = db.prepare("DELETE FROM reminders WHERE id = ? AND user_id = ?");

function parse(row) {
  if (!row) return null;
  return {
    id: row.id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    userId: row.user_id,
    message: row.message,
    remindAt: row.remind_at,
    delivered: Boolean(row.delivered),
    createdAt: new Date(row.created_at),
  };
}

export function create({ guildId, channelId, userId, message, remindAt }) {
  const res = insertStmt.run(guildId, channelId, userId, message, remindAt, Date.now());
  return get(res.lastInsertRowid);
}

export function get(id) {
  return parse(getStmt.get(id));
}

export function getDue(now = Date.now()) {
  return dueStmt.all(now).map(parse);
}

export function getPending() {
  return pendingStmt.all().map(parse);
}

export function getForUser(userId) {
  return forUserStmt.all(userId).map(parse);
}

export function markDelivered(id) {
  markDeliveredStmt.run(id);
}

export function cancel(id, userId) {
  return deleteStmt.run(id, userId).changes > 0;
}

export default { create, get, getDue, getPending, getForUser, markDelivered, cancel };
