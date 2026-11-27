import { db } from "../database/db.js";

const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_DETAIL = 500;

const insertStmt = db.prepare("INSERT INTO audit_logs (actor, action, detail, ip, created_at) VALUES (?, ?, ?, ?, ?)");
const pruneStmt = db.prepare("DELETE FROM audit_logs WHERE created_at < ?");

export function add({ actor, action, detail = null, ip = null }) {
  try {
    insertStmt.run(
      String(actor ?? "system").slice(0, 100),
      String(action ?? "unknown").slice(0, 200),
      detail == null ? null : String(detail).slice(0, MAX_DETAIL),
      ip ? String(ip).slice(0, 64) : null,
      Date.now()
    );
  } catch (err) {
    console.error("[audit] Failed to write audit log:", err.message);
  }
}

export function list({ limit = 200, action, actor } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 200, 1), 1000);
  const clauses = [];
  const params = [];
  if (action) {
    clauses.push("LOWER(action) LIKE ?");
    params.push(`%${String(action).toLowerCase()}%`);
  }
  if (actor) {
    clauses.push("LOWER(actor) LIKE ?");
    params.push(`%${String(actor).toLowerCase()}%`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db
    .prepare(`SELECT * FROM audit_logs ${where} ORDER BY created_at DESC, id DESC LIMIT ?`)
    .all(...params, lim);
  return rows.map((r) => ({
    id: r.id,
    actor: r.actor,
    action: r.action,
    detail: r.detail,
    ip: r.ip,
    createdAt: r.created_at,
  }));
}

export function prune(olderThanMs = RETENTION_MS) {
  return pruneStmt.run(Date.now() - olderThanMs).changes;
}
