import { db } from "../database/db.js";

const getStmt = db.prepare("SELECT * FROM tickets WHERE id = ?");
const getByChannelStmt = db.prepare("SELECT * FROM tickets WHERE channel_id = ?");
const listForGuildStmt = db.prepare("SELECT * FROM tickets WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?");
const listForUserStmt = db.prepare("SELECT * FROM tickets WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC");
const insertStmt = db.prepare(`
  INSERT INTO tickets (guild_id, panel_id, channel_id, user_id, status, created_at)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const closeStmt = db.prepare("UPDATE tickets SET status = 'closed', closed_at = ? WHERE id = ?");
const archiveStmt = db.prepare("UPDATE tickets SET status = 'archived', archived_at = ? WHERE id = ?");
const claimStmt = db.prepare("UPDATE tickets SET claimer_id = ? WHERE id = ?");
const unclaimStmt = db.prepare("UPDATE tickets SET claimer_id = NULL WHERE id = ?");
const deleteStmt = db.prepare("DELETE FROM tickets WHERE id = ?");

function fromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    guildId: row.guild_id,
    panelId: row.panel_id,
    channelId: row.channel_id,
    userId: row.user_id,
    status: row.status,
    claimerId: row.claimer_id,
    createdAt: new Date(row.created_at),
    closedAt: row.closed_at ? new Date(row.closed_at) : null,
    archivedAt: row.archived_at ? new Date(row.archived_at) : null,
  };
}

export async function get(id) {
  return fromRow(getStmt.get(id));
}

export async function getByChannel(channelId) {
  return fromRow(getByChannelStmt.get(channelId));
}

export async function getForGuild(guildId, limit = 100) {
  return listForGuildStmt.all(guildId, limit).map(fromRow);
}

export async function getForUser(guildId, userId) {
  return listForUserStmt.all(guildId, userId).map(fromRow);
}

export async function create(data) {
  const now = Date.now();
  insertStmt.run(data.guildId, data.panelId, data.channelId, data.userId, data.status ?? "open", now);
  const row = db.prepare("SELECT * FROM tickets WHERE rowid = last_insert_rowid()").get();
  return fromRow(row);
}

export async function close(id) {
  closeStmt.run(Date.now(), id);
  return get(id);
}

export async function archive(id) {
  archiveStmt.run(Date.now(), id);
  return get(id);
}

export async function claim(id, claimerId) {
  claimStmt.run(claimerId, id);
  return get(id);
}

export async function unclaim(id) {
  unclaimStmt.run(id);
  return get(id);
}

export async function remove(id) {
  return deleteStmt.run(id);
}

export default { get, getByChannel, getForGuild, getForUser, create, close, archive, claim, unclaim, remove };
