import { db } from "../database/db.js";

const getStmt = db.prepare("SELECT * FROM interaction_settings WHERE guild_id = ?");
const upsertStmt = db.prepare(`
  INSERT INTO interaction_settings (guild_id, interactions, created_at, updated_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(guild_id) DO UPDATE SET
    interactions = excluded.interactions,
    updated_at = excluded.updated_at
`);
const deleteStmt = db.prepare("DELETE FROM interaction_settings WHERE guild_id = ?");

function fromRow(row) {
  if (!row) return null;
  let interactions = {};
  try {
    interactions = JSON.parse(row.interactions || "{}");
  } catch {
    interactions = {};
  }
  return {
    guildId: row.guild_id,
    interactions,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function get(guildId) {
  return fromRow(getStmt.get(guildId));
}

export async function getOrCreate(guildId) {
  const existing = getStmt.get(guildId);
  if (existing) return fromRow(existing);
  const now = Date.now();
  upsertStmt.run(guildId, "{}", now, now);
  return fromRow(getStmt.get(guildId));
}

export async function save(guildId, interactions) {
  const existing = await getOrCreate(guildId);
  const merged = { ...existing.interactions, ...interactions };
  const now = Date.now();
  upsertStmt.run(guildId, JSON.stringify(merged), existing.createdAt ?? now, now);
  return fromRow(getStmt.get(guildId));
}

export async function remove(guildId) {
  return deleteStmt.run(guildId);
}

export default { get, getOrCreate, save, remove };
