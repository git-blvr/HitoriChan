import { db } from "../database/db.js";

export const DEFAULTS = {
  gamblingEnabled: true,
  gamblingMaxBet: null,
  robEnabled: true,
  workMin: 40,
  workMax: 120,
  workCooldownSeconds: 3600,
  weeklyMin: 1000,
  weeklyMax: 2500,
  bankInterestRate: 1.0, // percent per day, applied lazily
};

const getStmt = db.prepare("SELECT * FROM game_settings WHERE guild_id = ?");
const upsertStmt = db.prepare(`
  INSERT INTO game_settings (
    guild_id, gambling_enabled, gambling_max_bet, rob_enabled,
    work_min, work_max, work_cooldown_seconds, weekly_min, weekly_max,
    bank_interest_rate, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(guild_id) DO UPDATE SET
    gambling_enabled = excluded.gambling_enabled,
    gambling_max_bet = excluded.gambling_max_bet,
    rob_enabled = excluded.rob_enabled,
    work_min = excluded.work_min,
    work_max = excluded.work_max,
    work_cooldown_seconds = excluded.work_cooldown_seconds,
    weekly_min = excluded.weekly_min,
    weekly_max = excluded.weekly_max,
    bank_interest_rate = excluded.bank_interest_rate,
    updated_at = excluded.updated_at
`);

function fromRow(row) {
  if (!row) return null;
  return {
    guildId: row.guild_id,
    gamblingEnabled: row.gambling_enabled === undefined ? DEFAULTS.gamblingEnabled : Boolean(row.gambling_enabled),
    gamblingMaxBet: row.gambling_max_bet ?? DEFAULTS.gamblingMaxBet,
    robEnabled: row.rob_enabled === undefined ? DEFAULTS.robEnabled : Boolean(row.rob_enabled),
    workMin: row.work_min ?? DEFAULTS.workMin,
    workMax: row.work_max ?? DEFAULTS.workMax,
    workCooldownSeconds: row.work_cooldown_seconds ?? DEFAULTS.workCooldownSeconds,
    weeklyMin: row.weekly_min ?? DEFAULTS.weeklyMin,
    weeklyMax: row.weekly_max ?? DEFAULTS.weeklyMax,
    bankInterestRate: row.bank_interest_rate ?? DEFAULTS.bankInterestRate,
    updatedAt: row.updated_at ? new Date(row.updated_at) : null,
  };
}

// Small cache — one row per guild.
const cache = new Map();
const CACHE_MAX = 500;

export async function get(guildId) {
  if (!guildId) return { ...DEFAULTS };
  if (cache.has(guildId)) return cache.get(guildId);
  const settings = fromRow(getStmt.get(guildId)) ?? { guildId, ...DEFAULTS };
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(guildId, settings);
  return settings;
}

export async function save(guildId, values) {
  const current = await get(guildId);
  const next = {
    gamblingEnabled: values.gamblingEnabled !== undefined ? Boolean(values.gamblingEnabled) : current.gamblingEnabled,
    gamblingMaxBet: values.gamblingMaxBet !== undefined ? (values.gamblingMaxBet == null ? null : Math.max(1, Math.floor(Number(values.gamblingMaxBet)) || 1)) : current.gamblingMaxBet,
    robEnabled: values.robEnabled !== undefined ? Boolean(values.robEnabled) : current.robEnabled,
    workMin: values.workMin !== undefined ? Math.max(0, Math.floor(Number(values.workMin)) || 0) : current.workMin,
    workMax: values.workMax !== undefined ? Math.max(0, Math.floor(Number(values.workMax)) || 0) : current.workMax,
    workCooldownSeconds: values.workCooldownSeconds !== undefined ? Math.max(60, Math.floor(Number(values.workCooldownSeconds)) || DEFAULTS.workCooldownSeconds) : current.workCooldownSeconds,
    weeklyMin: values.weeklyMin !== undefined ? Math.max(0, Math.floor(Number(values.weeklyMin)) || 0) : current.weeklyMin,
    weeklyMax: values.weeklyMax !== undefined ? Math.max(0, Math.floor(Number(values.weeklyMax)) || 0) : current.weeklyMax,
    bankInterestRate: values.bankInterestRate !== undefined ? Math.min(10, Math.max(0, Number(values.bankInterestRate) || 0)) : current.bankInterestRate,
  };
  if (next.workMax < next.workMin) next.workMax = next.workMin;
  if (next.weeklyMax < next.weeklyMin) next.weeklyMax = next.weeklyMin;
  upsertStmt.run(
    guildId,
    next.gamblingEnabled ? 1 : 0,
    next.gamblingMaxBet,
    next.robEnabled ? 1 : 0,
    next.workMin,
    next.workMax,
    next.workCooldownSeconds,
    next.weeklyMin,
    next.weeklyMax,
    next.bankInterestRate,
    Date.now()
  );
  const saved = await get(guildId);
  Object.assign(saved, next);
  return saved;
}

export function invalidate(guildId) {
  cache.delete(guildId);
}

export default { get, save, invalidate, DEFAULTS };
