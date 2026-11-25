import { db } from "../database/db.js";

const getStmt = db.prepare("SELECT * FROM lastfm_users WHERE user_id = ?");
const listStmt = db.prepare("SELECT * FROM lastfm_users ORDER BY username");
const upsertStmt = db.prepare(`
  INSERT INTO lastfm_users (user_id, username, updated_at) VALUES (?, ?, ?)
  ON CONFLICT(user_id) DO UPDATE SET username = excluded.username, updated_at = excluded.updated_at
`);
const deleteStmt = db.prepare("DELETE FROM lastfm_users WHERE user_id = ?");

function fromRow(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    username: row.username,
    updatedAt: new Date(row.updated_at),
  };
}

export async function get(userId) {
  return fromRow(getStmt.get(String(userId)));
}

export async function set(userId, username) {
  upsertStmt.run(String(userId), String(username), Date.now());
  return get(userId);
}

export async function remove(userId) {
  return deleteStmt.run(String(userId));
}

export async function getAll() {
  return listStmt.all().map(fromRow);
}

export default { get, set, remove, getAll };
