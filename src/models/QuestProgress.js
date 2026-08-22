import { db } from "../database/db.js";

const getStmt = db.prepare("SELECT * FROM quest_progress WHERE quest_id = ? AND user_id = ?");
const upsertStmt = db.prepare(`
  INSERT INTO quest_progress (quest_id, user_id, counters, status, completed_at, claimed_at, last_reset_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(quest_id, user_id) DO UPDATE SET
    counters = excluded.counters,
    status = excluded.status,
    completed_at = excluded.completed_at,
    claimed_at = excluded.claimed_at,
    last_reset_at = excluded.last_reset_at,
    updated_at = excluded.updated_at
`);
const listForQuestStmt = db.prepare("SELECT * FROM quest_progress WHERE quest_id = ?");
const listForUserStmt = db.prepare("SELECT * FROM quest_progress WHERE user_id = ?");
const deleteForQuestStmt = db.prepare("DELETE FROM quest_progress WHERE quest_id = ?");

function parseJson(json, fallback) {
  try {
    return JSON.parse(json) ?? fallback;
  } catch {
    return fallback;
  }
}

function fromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    questId: row.quest_id,
    userId: row.user_id,
    counters: parseJson(row.counters, {}),
    status: row.status,
    completedAt: row.completed_at,
    claimedAt: row.claimed_at,
    lastResetAt: row.last_reset_at,
    updatedAt: row.updated_at,
  };
}

export async function get(questId, userId) {
  return fromRow(getStmt.get(questId, userId));
}

export async function getOrCreate(questId, userId) {
  const row = getStmt.get(questId, userId);
  if (row) return fromRow(row);
  const now = Date.now();
  upsertStmt.run(questId, userId, "{}", "in_progress", null, null, now, now);
  return fromRow(getStmt.get(questId, userId));
}

export async function save(progress) {
  upsertStmt.run(
    progress.questId,
    progress.userId,
    JSON.stringify(progress.counters || {}),
    progress.status,
    progress.completedAt ?? null,
    progress.claimedAt ?? null,
    progress.lastResetAt ?? Date.now(),
    Date.now()
  );
}

export async function getAllForQuest(questId) {
  return listForQuestStmt.all(questId).map(fromRow);
}

export async function getAllForUser(userId) {
  return listForUserStmt.all(userId).map(fromRow);
}

export async function deleteForQuest(questId) {
  return deleteForQuestStmt.run(questId);
}
