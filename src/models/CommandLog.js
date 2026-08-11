import { db } from "../database/db.js";

const insert = db.prepare(`
  INSERT INTO command_logs (guild_id, channel_id, user_id, user_name, command_name, source, input, success, error_message, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const listForGuild = db.prepare(`
  SELECT * FROM command_logs WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?
`);

const listRecent = db.prepare(`
  SELECT * FROM command_logs ORDER BY created_at DESC LIMIT ?
`);

export function create(data) {
  const now = Date.now();
  return insert.run(
    data.guildId ?? null,
    data.channelId ?? null,
    data.userId,
    data.userName ?? null,
    data.commandName,
    data.source ?? "prefix",
    data.input ?? null,
    data.success ? 1 : 0,
    data.errorMessage ?? null,
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

function parse(row) {
  return {
    id: row.id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    userId: row.user_id,
    userName: row.user_name,
    commandName: row.command_name,
    source: row.source,
    input: row.input,
    success: row.success === 1,
    errorMessage: row.error_message,
    createdAt: new Date(row.created_at),
  };
}
