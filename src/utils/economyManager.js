import * as EconomyAccount from "../models/EconomyAccount.js";
import * as GameSettings from "../models/GameSettings.js";
import { getGuildSettings, setGuildCurrencies as updateGuildCurrencies } from "./prefixManager.js";

export const CURRENCY_TYPES = {
  PRIMARY: "primary",
  SECONDARY: "secondary",
};

export const DEFAULT_DAILY = { min: 100, max: 500 };
export const WEEKLY_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
export const BANK_INTEREST_PERIOD_MS = 24 * 60 * 60 * 1000;
export const MAX_SAFE_AMOUNT = Number.MAX_SAFE_INTEGER;

export const EXCHANGE_BASE_RATE = 10;
export const EXCHANGE_RATE_VARIANCE = 2;

export function getExchangeRate(guildId) {
  const seed = Number(String(guildId).replace(/\D/g, "").slice(-6)) || 0;
  const interval = 30 * 60 * 1000;
  const step = Math.floor(Date.now() / interval);
  const offset = ((seed + step) % ((EXCHANGE_RATE_VARIANCE * 2) + 1)) - EXCHANGE_RATE_VARIANCE;
  return EXCHANGE_BASE_RATE + offset;
}

export async function getGuildEconomyConfig(guildId) {
  const settings = await getGuildSettings(guildId);
  return {
    primary: {
      name: settings.primaryCurrency?.name ?? "Starry Coins",
      symbol: settings.primaryCurrency?.symbol ?? "coins ",
      emoji: settings.primaryCurrency?.emoji ?? null,
    },
    secondary: {
      name: settings.secondaryCurrency?.name ?? "FOLTs",
      symbol: settings.secondaryCurrency?.symbol ?? "folts ",
      emoji: settings.secondaryCurrency?.emoji ?? null,
    },
    dailyMin: settings.dailyMin ?? DEFAULT_DAILY.min,
    dailyMax: settings.dailyMax ?? DEFAULT_DAILY.max,
  };
}

export function formatMoney(value) {
  return Number(value).toLocaleString();
}

export function formatCurrency(amount, currencyConfig) {
  return `${currencyConfig.symbol}${formatMoney(amount)}`;
}

export async function getEconomyAccount(guildId, userId) {
  return EconomyAccount.getOrCreate(guildId, userId);
}

export async function adjustBalance(guildId, userId, currency, amount) {
  if (!Object.values(CURRENCY_TYPES).includes(currency)) {
    throw new Error("Invalid economy currency type.");
  }
  return EconomyAccount.adjust(guildId, userId, currency, amount);
}

export async function transferBalance(guildId, fromUserId, toUserId, amount, currency) {
  if (!Object.values(CURRENCY_TYPES).includes(currency)) {
    throw new Error("Invalid economy currency type.");
  }
  if (fromUserId === toUserId) {
    throw new Error("You cannot pay yourself.");
  }
  if (amount <= 0) {
    throw new Error("Amount must be greater than zero.");
  }
  return EconomyAccount.transfer(guildId, fromUserId, toUserId, amount, currency);
}

export function canClaimDaily(account) {
  if (!account?.lastDaily) return true;
  const now = Date.now();
  return now - account.lastDaily.getTime() >= 24 * 60 * 60 * 1000;
}

export function getDailyCooldown(account) {
  if (!account?.lastDaily) return 0;
  const elapsed = Date.now() - account.lastDaily.getTime();
  const remaining = 24 * 60 * 60 * 1000 - elapsed;
  return remaining > 0 ? remaining : 0;
}

export async function claimDaily(guildId, userId) {
  const claimed = await EconomyAccount.claimCooldown(guildId, userId, "last_daily", 24 * 60 * 60 * 1000);
  if (!claimed) return null;
  const [account, config] = await Promise.all([
    getEconomyAccount(guildId, userId),
    getGuildEconomyConfig(guildId),
  ]);
  const baseReward = Math.floor(Math.random() * (config.dailyMax - config.dailyMin + 1)) + config.dailyMin;
  const multiplier = account.earningsMultiplier || 1;
  const reward = Math.floor(baseReward * multiplier);
  const saved = await EconomyAccount.adjust(guildId, userId, "primary", reward);
  return { account: saved, reward, baseReward, multiplier };
}

export async function convertPrimaryToSecondary(guildId, userId, amount) {
  const rate = getExchangeRate(guildId);
  const account = await getEconomyAccount(guildId, userId);
  const converted = Math.floor(amount * rate);

  if (amount <= 0) {
    throw new Error("Amount must be greater than zero.");
  }

  if (account.primary < amount) {
    throw new Error("Insufficient Starry Coins.");
  }

  account.primary -= amount;
  account.secondary += converted;
  const saved = await EconomyAccount.save(account);

  return { account: saved, converted, rate };
}

export async function convertSecondaryToPrimary(guildId, userId, amount) {
  const rate = getExchangeRate(guildId);
  const account = await getEconomyAccount(guildId, userId);
  const converted = Math.floor(amount / rate);

  if (amount <= 0) {
    throw new Error("Amount must be greater than zero.");
  }

  if (account.secondary < amount) {
    throw new Error("Insufficient FOLTs.");
  }

  if (converted <= 0) {
    throw new Error("That amount is too low to convert into any Starry Coins at the current rate.");
  }

  account.secondary -= amount;
  account.primary += converted;
  const saved = await EconomyAccount.save(account);

  return { account: saved, converted, rate };
}

export function randomInRange(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ── Game settings ────────────────────────────────────────────────────────────

export async function getGameConfig(guildId) {
  return GameSettings.get(guildId);
}

export async function setGameConfig(guildId, values) {
  return GameSettings.save(guildId, values);
}

// Validates a wager against guild rules and the bettor's wallet.
// Returns { error } or { config, account }.
export async function validateBet(guildId, userId, amount, { currency = "primary" } = {}) {
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_SAFE_AMOUNT) {
    return { error: "Please enter a valid amount greater than 0." };
  }
  const games = await getGameConfig(guildId);
  if (!games.gamblingEnabled) {
    return { error: "Gambling is disabled on this server." };
  }
  if (games.gamblingMaxBet != null && amount > games.gamblingMaxBet) {
    return { error: `The maximum bet on this server is ${formatMoney(games.gamblingMaxBet)}.` };
  }
  const account = await getEconomyAccount(guildId, userId);
  if ((account[currency] ?? 0) < amount) {
    return { error: `You don't have enough funds.\nBalance: ${formatMoney(account[currency] ?? 0)}`, account };
  }
  return { account, games };
}

// ── Work / weekly rewards ────────────────────────────────────────────────────

export function getWorkCooldown(account, workCooldownSeconds) {
  if (!account?.lastWork) return 0;
  const remaining = workCooldownSeconds * 1000 - (Date.now() - account.lastWork.getTime());
  return remaining > 0 ? remaining : 0;
}

export async function claimWork(guildId, userId) {
  const games = await getGameConfig(guildId);
  // Atomic cooldown stamp first — if it fails, still cooling down.
  const claimed = await EconomyAccount.claimCooldown(guildId, userId, "last_work", games.workCooldownSeconds * 1000);
  if (!claimed) return null;
  const account = await getEconomyAccount(guildId, userId);
  const baseReward = randomInRange(games.workMin, games.workMax);
  const multiplier = account.earningsMultiplier || 1;
  const reward = Math.floor(baseReward * multiplier);
  const saved = await EconomyAccount.adjust(guildId, userId, "primary", reward);
  return { account: saved, reward, baseReward, multiplier };
}

export function getWeeklyCooldown(account) {
  if (!account?.lastWeekly) return 0;
  const remaining = WEEKLY_COOLDOWN_MS - (Date.now() - account.lastWeekly.getTime());
  return remaining > 0 ? remaining : 0;
}

export async function claimWeekly(guildId, userId) {
  const games = await getGameConfig(guildId);
  const claimed = await EconomyAccount.claimCooldown(guildId, userId, "last_weekly", WEEKLY_COOLDOWN_MS);
  if (!claimed) return null;
  const account = await getEconomyAccount(guildId, userId);
  const baseReward = randomInRange(games.weeklyMin, games.weeklyMax);
  const multiplier = account.earningsMultiplier || 1;
  const reward = Math.floor(baseReward * multiplier);
  const saved = await EconomyAccount.adjust(guildId, userId, "primary", reward);
  return { account: saved, reward, baseReward, multiplier };
}

// ── Bank ─────────────────────────────────────────────────────────────────────

// Interest accrues lazily: full day-steps since bank_interest_at, capped so
// balances can't snowball past ~7 missed days between check-ins.
const BANK_MAX_ACCRUAL_DAYS = 7;

function applyBankInterest(account, ratePercent) {
  const rate = Number(ratePercent) / 100;
  if (!(rate > 0) || !(account.bank > 0)) return 0;
  const now = Date.now();
  const last = account.bankInterestAt?.getTime?.() ?? now;
  let days = Math.floor((now - last) / BANK_INTEREST_PERIOD_MS);
  if (days <= 0) return 0;
  if (days > BANK_MAX_ACCRUAL_DAYS) days = BANK_MAX_ACCRUAL_DAYS;
  const interest = Math.floor(account.bank * rate * days);
  if (interest > 0) account.bank += interest;
  account.bankInterestAt = new Date(last + days * BANK_INTEREST_PERIOD_MS);
  return interest;
}

export async function getBankAccount(guildId, userId) {
  const account = await getEconomyAccount(guildId, userId);
  const games = await getGameConfig(guildId);
  const interest = applyBankInterest(account, games.bankInterestRate);
  if (interest > 0 || !account.bankInterestAt) {
    if (!account.bankInterestAt) account.bankInterestAt = new Date();
    await EconomyAccount.save(account);
  }
  return { account, games, interest };
}

export async function bankDeposit(guildId, userId, amount) {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Amount must be greater than zero.");
  await getBankAccount(guildId, userId); // settle interest + stamp accrual first
  const debited = await EconomyAccount.spend(guildId, userId, "primary", amount);
  if (!debited) throw new Error("Insufficient wallet funds.");
  const updated = await EconomyAccount.adjustBank(guildId, userId, amount);
  if (!updated.bankInterestAt) {
    updated.bankInterestAt = new Date();
    await EconomyAccount.save(updated);
  }
  return updated;
}

export async function bankWithdraw(guildId, userId, amount) {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Amount must be greater than zero.");
  await getBankAccount(guildId, userId); // settle interest first
  const debited = await EconomyAccount.spendBank(guildId, userId, amount);
  if (!debited) throw new Error("Insufficient bank funds.");
  return EconomyAccount.adjust(guildId, userId, "primary", amount);
}

// ── Game stats ───────────────────────────────────────────────────────────────

export async function recordGameResult(guildId, results) {
  for (const r of results) {
    try {
      const account = await getEconomyAccount(guildId, r.userId);
      account.gamesPlayed = (account.gamesPlayed || 0) + 1;
      if (r.won) account.gamesWon = (account.gamesWon || 0) + 1;
      account.totalWagered = (account.totalWagered || 0) + (r.wagered || 0);
      account.totalWon = (account.totalWon || 0) + (r.wonAmount || 0);
      await EconomyAccount.save(account);
    } catch (err) {
      console.error("[economy] recordGameResult failed:", err.message);
    }
  }
}

export async function getLeaderboard(guildId, limit = 10) {
  return EconomyAccount.getLeaderboard(guildId, limit);
}

export async function getGlobalLeaderboard(limit = 10) {
  return EconomyAccount.getGlobalLeaderboard(limit);
}

export async function setGuildCurrencies(guildId, values) {
  return updateGuildCurrencies(guildId, values);
}
