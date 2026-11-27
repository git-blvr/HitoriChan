import { db } from "../database/db.js";

const insertPoll = db.prepare(`
  INSERT INTO polls (guild_id, channel_id, message_id, author_id, question, options, multi, ends_at, closed, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
`);

const getStmt = db.prepare("SELECT * FROM polls WHERE id = ?");
const getByMessageStmt = db.prepare("SELECT * FROM polls WHERE message_id = ?");
const setMessageStmt = db.prepare("UPDATE polls SET message_id = ? WHERE id = ?");
const closeStmt = db.prepare("UPDATE polls SET closed = 1 WHERE id = ?");
const dueStmt = db.prepare("SELECT * FROM polls WHERE closed = 0 AND ends_at IS NOT NULL AND ends_at <= ? ORDER BY ends_at ASC LIMIT 50");

const insertVote = db.prepare(`
  INSERT INTO poll_votes (poll_id, user_id, option_index, created_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(poll_id, user_id, option_index) DO NOTHING
`);

const deleteUserVotes = db.prepare("DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ?");
const deleteUserVote = db.prepare("DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ? AND option_index = ?");
const votesStmt = db.prepare("SELECT option_index, COUNT(*) AS count FROM poll_votes WHERE poll_id = ? GROUP BY option_index");
const userVotesStmt = db.prepare("SELECT option_index FROM poll_votes WHERE poll_id = ? AND user_id = ?");
const totalVotersStmt = db.prepare("SELECT COUNT(DISTINCT user_id) AS n FROM poll_votes WHERE poll_id = ?");
const topVotersStmt = db.prepare("SELECT user_id, COUNT(*) AS n FROM poll_votes WHERE poll_id = ? GROUP BY user_id LIMIT 500");

function parse(row) {
  if (!row) return null;
  let options = [];
  try {
    options = JSON.parse(row.options || "[]");
  } catch {
    options = [];
  }
  return {
    id: row.id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    messageId: row.message_id,
    authorId: row.author_id,
    question: row.question,
    options,
    multi: Boolean(row.multi),
    endsAt: row.ends_at,
    closed: Boolean(row.closed),
    createdAt: new Date(row.created_at),
  };
}

export function create({ guildId, channelId, authorId, question, options, multi = false, endsAt = null }) {
  const res = insertPoll.run(
    guildId,
    channelId,
    null,
    authorId,
    question,
    JSON.stringify(options),
    multi ? 1 : 0,
    endsAt,
    Date.now()
  );
  return get(res.lastInsertRowid);
}

export function get(id) {
  return parse(getStmt.get(id));
}

export function getByMessage(messageId) {
  return parse(getByMessageStmt.get(messageId));
}

export function setMessageId(id, messageId) {
  setMessageStmt.run(messageId, id);
}

export function close(id) {
  closeStmt.run(id);
}

export function getDue(now = Date.now()) {
  return dueStmt.all(now).map(parse);
}

export function vote(pollId, userId, optionIndex) {
  insertVote.run(pollId, userId, optionIndex, Date.now());
}

export function unvote(pollId, userId, optionIndex) {
  deleteUserVote.run(pollId, userId, optionIndex);
}

export function clearUserVotes(pollId, userId) {
  deleteUserVotes.run(pollId, userId);
}

export function getVotes(pollId) {
  const rows = votesStmt.all(pollId);
  const counts = {};
  for (const r of rows) counts[r.option_index] = r.count;
  return counts;
}

export function getUserVotes(pollId, userId) {
  return userVotesStmt.all(pollId, userId).map((r) => r.option_index);
}

export function getVoterCount(pollId) {
  return totalVotersStmt.get(pollId)?.n ?? 0;
}

export function getVoters(pollId) {
  return topVotersStmt.all(pollId).map((r) => r.user_id);
}

export default {
  create,
  get,
  getByMessage,
  setMessageId,
  close,
  getDue,
  vote,
  unvote,
  clearUserVotes,
  getVotes,
  getUserVotes,
  getVoterCount,
  getVoters,
};
