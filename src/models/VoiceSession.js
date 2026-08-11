import { db } from "../database/db.js";

const startStmt = db.prepare(`
  INSERT INTO voice_sessions (guild_id, user_id, channel_id, joined_at)
  VALUES (?, ?, ?, ?)
`);

const endStmt = db.prepare(`
  UPDATE voice_sessions
  SET left_at = ?, duration_seconds = ?
  WHERE guild_id = ? AND user_id = ? AND left_at IS NULL
`);

const activeStmt = db.prepare(`
  SELECT * FROM voice_sessions
  WHERE guild_id = ? AND user_id = ? AND left_at IS NULL
  ORDER BY joined_at DESC
  LIMIT 1
`);

const statsStmt = db.prepare(`
  SELECT
    guild_id,
    COUNT(DISTINCT user_id) AS collaborators,
    SUM(duration_seconds) AS total_seconds,
    COUNT(*) AS sessions
  FROM voice_sessions
  WHERE left_at IS NOT NULL
    AND ((? IS NULL) OR (guild_id = ?))
    AND joined_at >= ?
`);

export function start(guildId, userId, channelId, joinedAt = Date.now()) {
  return startStmt.run(guildId, userId, channelId, joinedAt);
}

export function end(guildId, userId, leftAt = Date.now()) {
  const row = activeStmt.get(guildId, userId);
  if (!row) return null;
  const duration = Math.max(0, Math.floor((leftAt - row.joined_at) / 1000));
  return endStmt.run(leftAt, duration, guildId, userId);
}

export function getActive(guildId, userId) {
  return activeStmt.get(guildId, userId);
}

export function getVoiceStats(guildId, since = 0) {
  const row = statsStmt.get(guildId ?? null, guildId ?? null, since);
  if (!row) return { hours: 0, collaborators: 0, sessions: 0 };
  return {
    hours: Math.round((row.total_seconds || 0) / 36) / 100,
    collaborators: row.collaborators || 0,
    sessions: row.sessions || 0,
  };
}
