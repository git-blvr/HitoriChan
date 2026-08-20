import { db } from "../database/db.js";

const CURRENCY_COLUMNS = {
  primary: "primary_balance",
  secondary: "secondary_balance",
};

const getStmt = db.prepare("SELECT * FROM economy_accounts WHERE guild_id = ? AND user_id = ?");

const upsertStmt = db.prepare(`
  INSERT INTO economy_accounts (
    guild_id, user_id, primary_balance, secondary_balance, last_daily,
    earnings_multiplier, level, shop_item_ids, created_at, updated_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(guild_id, user_id) DO UPDATE SET
    primary_balance = excluded.primary_balance,
    secondary_balance = excluded.secondary_balance,
    last_daily = excluded.last_daily,
    earnings_multiplier = excluded.earnings_multiplier,
    level = excluded.level,
    shop_item_ids = excluded.shop_item_ids,
    updated_at = excluded.updated_at
`);

const leaderboardStmt = db.prepare(`
  SELECT guild_id, user_id, primary_balance, secondary_balance
  FROM economy_accounts
  WHERE guild_id = ?
  ORDER BY primary_balance DESC
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
    shopItemIds: parseJson(row.shop_item_ids),
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
  upsertStmt.run(guildId, userId, 0, 0, null, 1.0, 1, "[]", now, now);
  return fromRow(getStmt.get(guildId, userId));
}

export async function save(account) {
  const now = Date.now();
  const lastDaily = account.lastDaily instanceof Date ? account.lastDaily.getTime() : account.lastDaily;
  upsertStmt.run(
    account.guildId,
    account.userId,
    account.primary ?? 0,
    account.secondary ?? 0,
    lastDaily || null,
    account.earningsMultiplier ?? 1.0,
    account.level ?? 1,
    JSON.stringify(account.shopItemIds ?? []),
    account.createdAt?.getTime?.() ?? now,
    now
  );
  return fromRow(getStmt.get(account.guildId, account.userId));
}

export async function adjust(guildId, userId, currency, amount) {
  if (!CURRENCY_COLUMNS[currency]) {
    throw new Error("Invalid economy currency type.");
  }
  const account = await getOrCreate(guildId, userId);
  account[currency] += amount;
  return save(account);
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
  if (amount <= 0) throw new Error("Amount must be greater than zero.");
  if (!Object.values(CURRENCY_COLUMNS).includes(currency)) throw new Error("Invalid economy currency type.");

  const fromAccount = await getOrCreate(guildId, fromUserId);
  const toAccount = await getOrCreate(guildId, toUserId);

  if (fromAccount[currency] < amount) throw new Error("Insufficient funds.");

  fromAccount[currency] -= amount;
  toAccount[currency] += amount;

  await save(fromAccount);
  await save(toAccount);

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

export default {
  get,
  getOrCreate,
  save,
  adjust,
  adjustMulti,
  setLastDaily,
  transfer,
  getLeaderboard,
  getGlobalLeaderboard,
};
