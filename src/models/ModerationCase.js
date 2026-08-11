import { randomBytes } from "crypto";
import { db } from "../database/db.js";

const getByCaseIdStmt = db.prepare("SELECT * FROM moderation_cases WHERE guild_id = ? AND case_id = ?");
const getForUserStmt = db.prepare("SELECT * FROM moderation_cases WHERE guild_id = ? AND target_id = ? AND active = 1 ORDER BY created_at DESC");
const insertStmt = db.prepare(`
  INSERT INTO moderation_cases (
    case_id, guild_id, action, moderator_id, target_id, reason, attachment, duration, active, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const deactivateStmt = db.prepare("UPDATE moderation_cases SET active = 0 WHERE guild_id = ? AND case_id = ?");

function fromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    caseId: row.case_id,
    guildId: row.guild_id,
    action: row.action,
    moderatorId: row.moderator_id,
    targetId: row.target_id,
    reason: row.reason,
    attachment: row.attachment,
    duration: row.duration,
    active: Boolean(row.active),
    createdAt: new Date(row.created_at),
  };
}

function generateCaseId() {
  return randomBytes(3).toString("hex").toUpperCase();
}

export async function getByCaseId(guildId, caseId) {
  return fromRow(getByCaseIdStmt.get(guildId, caseId));
}

export async function getForUser(guildId, targetId, { active = true } = {}) {
  if (active) {
    return getForUserStmt.all(guildId, targetId).map(fromRow);
  }
  const stmt = db.prepare("SELECT * FROM moderation_cases WHERE guild_id = ? AND target_id = ? ORDER BY created_at DESC");
  return stmt.all(guildId, targetId).map(fromRow);
}

export async function create(data) {
  const caseId = generateCaseId();
  const now = Date.now();
  insertStmt.run(
    caseId,
    data.guildId,
    data.action,
    data.moderatorId,
    data.targetId,
    data.reason || "No reason provided",
    data.attachment || null,
    data.duration || null,
    1,
    now
  );
  return getByCaseId(data.guildId, caseId);
}

export async function deactivate(guildId, caseId) {
  deactivateStmt.run(guildId, caseId);
  return getByCaseId(guildId, caseId);
}

export default { getByCaseId, getForUser, create, deactivate };
