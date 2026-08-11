import { db } from "../database/db.js";

const insert = db.prepare(`
  INSERT INTO message_logs (guild_id, channel_id, message_id, user_id, user_name, content, attachments, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const listForGuild = db.prepare(`
  SELECT * FROM message_logs WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?
`);

const listRecent = db.prepare(`
  SELECT * FROM message_logs ORDER BY created_at DESC LIMIT ?
`);

const deleteOld = db.prepare(`
  DELETE FROM message_logs WHERE id NOT IN (
    SELECT id FROM message_logs ORDER BY created_at DESC LIMIT ?
  )
`);

export function create(data) {
  const now = Date.now();
  return insert.run(
    data.guildId,
    data.channelId,
    data.messageId,
    data.userId,
    data.userName ?? null,
    data.content ?? "",
    JSON.stringify(data.attachments ?? []),
    now
  );
}

export function getForGuild(guildId, limit = 100) {
  const rows = listForGuild.all(guildId, limit);
  return rows.map(parse);
}

export function getRecent(limit = 100) {
  const rows = listRecent.all(limit);
  return rows.map(parse);
}

export function prune(maxTotal = 5000) {
  return deleteOld.run(maxTotal);
}

function parse(row) {
  return {
    id: row.id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    messageId: row.message_id,
    userId: row.user_id,
    userName: row.user_name,
    content: row.content,
    attachments: JSON.parse(row.attachments ?? "[]"),
    createdAt: new Date(row.created_at),
  };
}
