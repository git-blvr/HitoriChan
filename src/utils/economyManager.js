import * as EconomyAccount from "../models/EconomyAccount.js";
import { getGuildSettings, setGuildCurrencies as updateGuildCurrencies } from "./prefixManager.js";

export const CURRENCY_TYPES = {
  PRIMARY: "primary",
  SECONDARY: "secondary",
};

export const DEFAULT_DAILY = { min: 100, max: 500 };

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
  const account = await getEconomyAccount(guildId, userId);
  const config = await getGuildEconomyConfig(guildId);
  const reward = Math.floor(Math.random() * (config.dailyMax - config.dailyMin + 1)) + config.dailyMin;
  account.primary += reward;
  account.lastDaily = new Date();
  const saved = await EconomyAccount.save(account);
  return { account: saved, reward };
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

export async function getLeaderboard(guildId, limit = 10) {
  return EconomyAccount.getLeaderboard(guildId, limit);
}

export async function getGlobalLeaderboard(limit = 10) {
  return EconomyAccount.getGlobalLeaderboard(limit);
}

export async function setGuildCurrencies(guildId, values) {
  return updateGuildCurrencies(guildId, values);
}
