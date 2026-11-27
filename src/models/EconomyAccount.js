import { db } from "../database/db.js";

const CURRENCY_COLUMNS = {
  primary: "primary_balance",
  secondary: "secondary_balance",
};

const getStmt = db.prepare("SELECT * FROM economy_accounts WHERE guild_id = ? AND user_id = ?");

const upsertStmt = db.prepare(`
  INSERT INTO economy_accounts (
    guild_id, user_id, primary_balance, secondary_balance, last_daily,
    earnings_multiplier, level, xp, total_xp, shop_item_ids, unlocked_commands,
    bank_balance, last_work, last_weekly, bank_interest_at,
    games_played, games_won, total_wagered, total_won, created_at, updated_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(guild_id, user_id) DO UPDATE SET
    primary_balance = excluded.primary_balance,
    secondary_balance = excluded.secondary_balance,
    last_daily = excluded.last_daily,
    earnings_multiplier = excluded.earnings_multiplier,
    level = excluded.level,
    xp = excluded.xp,
    total_xp = excluded.total_xp,
    shop_item_ids = excluded.shop_item_ids,
    unlocked_commands = excluded.unlocked_commands,
    bank_balance = excluded.bank_balance,
    last_work = excluded.last_work,
    last_weekly = excluded.last_weekly,
    bank_interest_at = excluded.bank_interest_at,
    games_played = excluded.games_played,
    games_won = excluded.games_won,
    total_wagered = excluded.total_wagered,
    total_won = excluded.total_won,
    updated_at = excluded.updated_at
`);

const leaderboardStmt = db.prepare(`
  SELECT guild_id, user_id, primary_balance, secondary_balance, level, xp, total_xp,
         bank_balance, games_played, games_won
  FROM economy_accounts
  WHERE guild_id = ?
  ORDER BY primary_balance DESC
  LIMIT ?
`);

const levelLeaderboardStmt = db.prepare(`
  SELECT guild_id, user_id, primary_balance, secondary_balance, level, xp, total_xp
  FROM economy_accounts
  WHERE guild_id = ?
  ORDER BY total_xp DESC
  LIMIT ?
`);

const globalLeaderboardStmt = db.prepare(`
  SELECT user_id, SUM(primary_balance) AS total_primary
  FROM economy_accounts
  GROUP BY user_id
  ORDER BY total_primary DESC
  LIMIT ?
`);

function parseJson(json) {
  if (!json) return [];
  try {
    return JSON.parse(json);
  } catch {
    return [];
  }
}

function fromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    guildId: row.guild_id,
    userId: row.user_id,
    primary: row.primary_balance,
    secondary: row.secondary_balance,
    lastDaily: row.last_daily ? new Date(row.last_daily) : null,
    earningsMultiplier: row.earnings_multiplier ?? 1.0,
    level: row.level ?? 1,
    xp: row.xp ?? 0,
    totalXp: row.total_xp ?? 0,
    shopItemIds: parseJson(row.shop_item_ids),
    unlockedCommands: parseJson(row.unlocked_commands),
    bank: row.bank_balance ?? 0,
    lastWork: row.last_work ? new Date(row.last_work) : null,
    lastWeekly: row.last_weekly ? new Date(row.last_weekly) : null,
    bankInterestAt: row.bank_interest_at ? new Date(row.bank_interest_at) : null,
    gamesPlayed: row.games_played ?? 0,
    gamesWon: row.games_won ?? 0,
    totalWagered: row.total_wagered ?? 0,
    totalWon: row.total_won ?? 0,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export async function get(guildId, userId) {
  return fromRow(getStmt.get(guildId, userId));
}

export async function getOrCreate(guildId, userId) {
  const existing = getStmt.get(guildId, userId);
  if (existing) return fromRow(existing);

  const now = Date.now();
  upsertStmt.run(guildId, userId, 0, 0, null, 1.0, 1, 0, 0, "[]", "[]", 0, null, null, null, 0, 0, 0, 0, now, now);
  return fromRow(getStmt.get(guildId, userId));
}

export async function save(account) {
  const now = Date.now();
  const toMs = (v) => (v instanceof Date ? v.getTime() : v) || null;
  upsertStmt.run(
    account.guildId,
    account.userId,
    account.primary ?? 0,
    account.secondary ?? 0,
    toMs(account.lastDaily),
    account.earningsMultiplier ?? 1.0,
    account.level ?? 1,
    account.xp ?? 0,
    account.totalXp ?? 0,
    JSON.stringify(account.shopItemIds ?? []),
    JSON.stringify(account.unlockedCommands ?? []),
    account.bank ?? 0,
    toMs(account.lastWork),
    toMs(account.lastWeekly),
    toMs(account.bankInterestAt),
    account.gamesPlayed ?? 0,
    account.gamesWon ?? 0,
    account.totalWagered ?? 0,
    account.totalWon ?? 0,
    account.createdAt?.getTime?.() ?? now,
    now
  );
  return fromRow(getStmt.get(account.guildId, account.userId));
}

const ensureStmt = db.prepare(`
  INSERT OR IGNORE INTO economy_accounts (
    guild_id, user_id, primary_balance, secondary_balance, last_daily,
    earnings_multiplier, level, xp, total_xp, shop_item_ids, unlocked_commands,
    bank_balance, last_work, last_weekly, bank_interest_at,
    games_played, games_won, total_wagered, total_won, created_at, updated_at
  ) VALUES (?, ?, 0, 0, NULL, 1.0, 1, 0, 0, '[]', '[]', 0, NULL, NULL, NULL, 0, 0, 0, 0, ?, ?)
`);

const bankCol = "bank_balance";

export async function adjust(guildId, userId, currency, amount) {
  const col = CURRENCY_COLUMNS[currency];
  if (!col) {
    throw new Error("Invalid economy currency type.");
  }
  if (!Number.isFinite(amount)) {
    throw new Error("Amount must be finite.");
  }
  const now = Date.now();
  ensureStmt.run(guildId, userId, now, now);
  // Atomic increment — no read-modify-write window for concurrent calls.
  db.prepare(`UPDATE economy_accounts SET ${col} = ${col} + ?, updated_at = ? WHERE guild_id = ? AND user_id = ?`)
    .run(Math.trunc(amount), now, guildId, userId);
  return fromRow(getStmt.get(guildId, userId));
}

// Atomic debit guarded by the current balance — returns null when the user
// can't cover it (no lost-update window, no half-spent state).
export async function spend(guildId, userId, currency, amount) {
  const col = CURRENCY_COLUMNS[currency];
  if (!col) throw new Error("Invalid economy currency type.");
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Amount must be greater than zero.");
  const now = Date.now();
  ensureStmt.run(guildId, userId, now, now);
  const res = db
    .prepare(`UPDATE economy_accounts SET ${col} = ${col} - ?, updated_at = ? WHERE guild_id = ? AND user_id = ? AND ${col} >= ?`)
    .run(Math.trunc(amount), now, guildId, userId, Math.trunc(amount));
  if (res.changes === 0) return null;
  return fromRow(getStmt.get(guildId, userId));
}

export async function adjustBank(guildId, userId, amount) {
  const now = Date.now();
  ensureStmt.run(guildId, userId, now, now);
  db.prepare(`UPDATE economy_accounts SET ${bankCol} = ${bankCol} + ?, updated_at = ? WHERE guild_id = ? AND user_id = ?`)
    .run(Math.trunc(amount), now, guildId, userId);
  return fromRow(getStmt.get(guildId, userId));
}

// Atomic debit on the bank column — null when funds don't cover it.
export async function spendBank(guildId, userId, amount) {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Amount must be greater than zero.");
  const now = Date.now();
  ensureStmt.run(guildId, userId, now, now);
  const res = db
    .prepare(`UPDATE economy_accounts SET ${bankCol} = ${bankCol} - ?, updated_at = ? WHERE guild_id = ? AND user_id = ? AND ${bankCol} >= ?`)
    .run(Math.trunc(amount), now, guildId, userId, Math.trunc(amount));
  if (res.changes === 0) return null;
  return fromRow(getStmt.get(guildId, userId));
}

const claimCooldownStmts = new Map();

// Atomically stamps a cooldown column if the previous timestamp is older than
// `cooldownMs`. Returns the account on success, null while still cooling down.
export async function claimCooldown(guildId, userId, column, cooldownMs) {
  const allowed = new Set(["last_work", "last_weekly", "last_daily"]);
  if (!allowed.has(column)) throw new Error("Invalid cooldown column.");
  let stmt = claimCooldownStmts.get(column);
  if (!stmt) {
    stmt = db.prepare(`UPDATE economy_accounts SET ${column} = ?, updated_at = ? WHERE guild_id = ? AND user_id = ? AND (${column} IS NULL OR ${column} <= ?)`);
    claimCooldownStmts.set(column, stmt);
  }
  const now = Date.now();
  ensureStmt.run(guildId, userId, now, now);
  const res = stmt.run(now, now, guildId, userId, now - cooldownMs);
  if (res.changes === 0) return null;
  return fromRow(getStmt.get(guildId, userId));
}

export async function adjustMulti(guildId, userId, changes) {
  const account = await getOrCreate(guildId, userId);
  for (const [currency, amount] of Object.entries(changes)) {
    if (!CURRENCY_COLUMNS[currency]) continue;
    account[currency] += amount;
  }
  return save(account);
}

export async function setLastDaily(guildId, userId, date = new Date()) {
  const account = await getOrCreate(guildId, userId);
  account.lastDaily = date;
  return save(account);
}

export async function transfer(guildId, fromUserId, toUserId, amount, currency) {
  if (fromUserId === toUserId) throw new Error("You cannot pay yourself.");
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Amount must be greater than zero.");
  const col = CURRENCY_COLUMNS[currency];
  if (!col) throw new Error("Invalid economy currency type.");

  const now = Date.now();
  ensureStmt.run(guildId, fromUserId, now, now);
  ensureStmt.run(guildId, toUserId, now, now);

  // Atomic both-sides transfer — a crash mid-way can't mint or burn money.
  db.exec("BEGIN IMMEDIATE");
  try {
    const debit = db
      .prepare(`UPDATE economy_accounts SET ${col} = ${col} - ?, updated_at = ? WHERE guild_id = ? AND user_id = ? AND ${col} >= ?`)
      .run(Math.trunc(amount), now, guildId, fromUserId, Math.trunc(amount));
    if (debit.changes === 0) {
      throw new Error("Insufficient funds.");
    }
    db.prepare(`UPDATE economy_accounts SET ${col} = ${col} + ?, updated_at = ? WHERE guild_id = ? AND user_id = ?`)
      .run(Math.trunc(amount), now, guildId, toUserId);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  const fromAccount = fromRow(getStmt.get(guildId, fromUserId));
  const toAccount = fromRow(getStmt.get(guildId, toUserId));
  return { fromAccount, toAccount };
}

export async function getLeaderboard(guildId, limit = 10) {
  return leaderboardStmt.all(guildId, limit).map(fromRow);
}

export async function getGlobalLeaderboard(limit = 10) {
  return globalLeaderboardStmt.all(limit).map((row) => ({
    _id: row.user_id,
    totalPrimary: row.total_primary,
  }));
}

export async function getLevelLeaderboard(guildId, limit = 10) {
  return levelLeaderboardStmt.all(guildId, limit).map(fromRow);
}

export async function addXp(guildId, userId, xp) {
  const account = await getOrCreate(guildId, userId);
  account.xp = (account.xp || 0) + xp;
  account.totalXp = (account.totalXp || 0) + xp;
  return save(account);
}

export default {
  get,
  getOrCreate,
  save,
  adjust,
  adjustMulti,
  adjustBank,
  spend,
  spendBank,
  claimCooldown,
  setLastDaily,
  transfer,
  getLeaderboard,
  getGlobalLeaderboard,
  getLevelLeaderboard,
  addXp,
};
