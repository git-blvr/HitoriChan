import { db } from "../database/db.js";

const insert = db.prepare(`
  INSERT INTO triggers (guild_id, keyword, command_name, created_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(guild_id, keyword) DO UPDATE SET
    command_name = excluded.command_name,
    created_at = excluded.created_at
`);

const remove = db.prepare(`
  DELETE FROM triggers WHERE guild_id = ? AND keyword = ?
`);

const listStmt = db.prepare(`
  SELECT * FROM triggers WHERE guild_id = ? ORDER BY keyword ASC
`);

const findMatch = db.prepare(`
  SELECT * FROM triggers WHERE guild_id = ?
`);

export function create(guildId, keyword, commandName) {
  return insert.run(guildId, keyword.toLowerCase(), commandName, Date.now());
}

export function removeByKeyword(guildId, keyword) {
  return remove.run(guildId, keyword.toLowerCase());
}

export function getForGuild(guildId) {
  const rows = listStmt.all(guildId);
  return rows.map(parse);
}

export function findForMessage(guildId, messageContent) {
  const rows = findMatch.all(guildId);
  const text = messageContent.trim().toLowerCase();
  for (const row of rows) {
    const keyword = row.keyword.toLowerCase();
    if (text.startsWith(keyword)) {
      const nextChar = text[keyword.length];
      if (!nextChar || /\s/.test(nextChar)) {
        return parse(row);
      }
    }
  }
  return null;
}

function parse(row) {
  return {
    id: row.id,
    guildId: row.guild_id,
    keyword: row.keyword,
    commandName: row.command_name,
    createdAt: new Date(row.created_at),
  };
}
