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

function buildFilteredQuery({ user, command, success }) {
  const clauses = ["guild_id = ?"];
  const params = [];
  if (user) {
    clauses.push("(user_name LIKE ? OR user_id LIKE ?)");
    params.push(`%${user}%`, `%${user}%`);
  }
  if (command) {
    clauses.push("command_name LIKE ?");
    params.push(`%${command}%`);
  }
  if (success === true) clauses.push("success = 1");
  if (success === false) clauses.push("success = 0");
  const where = clauses.join(" AND ");
  return { sql: `SELECT * FROM command_logs WHERE ${where} ORDER BY created_at DESC LIMIT ?`, params };
}

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

export function getForGuild(guildId, options = 100) {
  if (typeof options === "number") options = { limit: options };
  const { limit = 100, user, command, success } = options;
  let successVal;
  if (success === "yes" || success === true || success === 1) successVal = true;
  else if (success === "no" || success === false || success === 0) successVal = false;
  else successVal = undefined;

  if (!user && !command && successVal === undefined) {
    const rows = listForGuild.all(guildId, limit);
    return rows.map(parse);
  }

  const { sql, params } = buildFilteredQuery({ user, command, success: successVal });
  const stmt = db.prepare(sql);
  const rows = stmt.all(guildId, ...params, limit);
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
