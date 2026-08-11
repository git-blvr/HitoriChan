import { db } from "../database/db.js";

const getStmt = db.prepare("SELECT * FROM streak_profiles WHERE user_id = ? AND guild_id = ?");

const upsertStmt = db.prepare(`
  INSERT INTO streak_profiles (
    user_id, guild_id, current_streak, longest_streak, last_streak_date,
    total_days, daily_message_count, daily_message_date
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(user_id, guild_id) DO UPDATE SET
    current_streak = excluded.current_streak,
    longest_streak = excluded.longest_streak,
    last_streak_date = excluded.last_streak_date,
    total_days = excluded.total_days,
    daily_message_count = excluded.daily_message_count,
    daily_message_date = excluded.daily_message_date
`);

function fromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    guildId: row.guild_id,
    currentStreak: row.current_streak,
    longestStreak: row.longest_streak,
    lastStreakDate: row.last_streak_date ? new Date(row.last_streak_date) : null,
    totalDays: row.total_days,
    dailyMessageCount: row.daily_message_count,
    dailyMessageDate: row.daily_message_date,
  };
}

export async function get(userId, guildId) {
  return fromRow(getStmt.get(userId, guildId));
}

export async function getOrCreate(userId, guildId) {
  const existing = getStmt.get(userId, guildId);
  if (existing) return fromRow(existing);

  upsertStmt.run(userId, guildId, 0, 0, null, 0, 0, null);
  return fromRow(getStmt.get(userId, guildId));
}

export async function save(profile) {
  const lastStreakDate = profile.lastStreakDate instanceof Date ? profile.lastStreakDate.getTime() : profile.lastStreakDate;
  upsertStmt.run(
    profile.userId,
    profile.guildId,
    profile.currentStreak ?? 0,
    profile.longestStreak ?? 0,
    lastStreakDate || null,
    profile.totalDays ?? 0,
    profile.dailyMessageCount ?? 0,
    profile.dailyMessageDate || null
  );
  return fromRow(getStmt.get(profile.userId, profile.guildId));
}

export async function resetDailyMessageCount(userId, guildId, date) {
  const profile = await getOrCreate(userId, guildId);
  profile.dailyMessageCount = 0;
  profile.dailyMessageDate = date;
  return save(profile);
}

export async function incrementDailyMessageCount(userId, guildId) {
  const profile = await getOrCreate(userId, guildId);
  profile.dailyMessageCount += 1;
  return save(profile);
}

export default { get, getOrCreate, save, resetDailyMessageCount, incrementDailyMessageCount };
