import { db } from "../database/db.js";

const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_DETAIL = 500;

const insertStmt = db.prepare("INSERT INTO audit_logs (actor, action, detail, ip, created_at) VALUES (?, ?, ?, ?, ?)");
const listStmt = db.prepare("SELECT * FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT ?");
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
  let rows = listStmt.all(lim);
  if (action) {
    const q = String(action).toLowerCase();
    rows = rows.filter((r) => r.action.toLowerCase().includes(q));
  }
  if (actor) {
    const q = String(actor).toLowerCase();
    rows = rows.filter((r) => r.actor.toLowerCase().includes(q));
  }
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
