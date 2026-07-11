import EconomyAccount from "../models/EconomyAccount.js";
import { getGuildSettings, setGuildCurrencies as updateGuildCurrencies } from "./prefixManager.js";

export const CURRENCY_TYPES = {
  PRIMARY: "primary",
  SECONDARY: "secondary",
};

export const DAILY_REWARD = {
  primary: 250,
};

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
    },
    secondary: {
      name: settings.secondaryCurrency?.name ?? "FOLTs",
      symbol: settings.secondaryCurrency?.symbol ?? "folts ",
    },
  };
}

export function formatMoney(value) {
  return Number(value).toLocaleString();
}

export function formatCurrency(amount, currencyConfig) {
  return `${currencyConfig.symbol}${formatMoney(amount)}`;
}

export async function getEconomyAccount(guildId, userId) {
  return EconomyAccount.findOneAndUpdate(
    { guildId, userId },
    { $setOnInsert: { primary: 0, secondary: 0, lastDaily: null } },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
  );
}

export async function adjustBalance(guildId, userId, currency, amount) {
  if (!Object.values(CURRENCY_TYPES).includes(currency)) {
    throw new Error("Invalid economy currency type.");
  }

  return EconomyAccount.findOneAndUpdate(
    { guildId, userId },
    {
      $inc: { [currency]: amount },
      $setOnInsert: { lastDaily: null },
    },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
  );
}

export async function transferBalance(guildId, fromUserId, toUserId, amount, currency) {
  if (!Object.values(CURRENCY_TYPES).includes(currency)) {
    throw new Error("Invalid economy currency type.");
  }

  if (fromUserId === toUserId) {
    throw new Error("You cannot pay yourself.");
  }

  const [fromAccount, toAccount] = await Promise.all([
    getEconomyAccount(guildId, fromUserId),
    getEconomyAccount(guildId, toUserId),
  ]);

  if (amount <= 0) {
    throw new Error("Amount must be greater than zero.");
  }

  if (fromAccount[currency] < amount) {
    throw new Error("Insufficient funds.");
  }

  fromAccount[currency] -= amount;
  toAccount[currency] += amount;

  await Promise.all([fromAccount.save(), toAccount.save()]);
  return { fromAccount, toAccount };
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
  account.primary += DAILY_REWARD.primary;
  account.lastDaily = new Date();
  await account.save();
  return account;
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
  await account.save();

  return { account, converted, rate };
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
  await account.save();

  return { account, converted, rate };
}

export async function getLeaderboard(guildId, limit = 10) {
  return EconomyAccount.find({ guildId }).sort({ primary: -1 }).limit(limit).lean();
}

export async function getGlobalLeaderboard(limit = 10) {
  return EconomyAccount.aggregate([
    {
      $group: {
        _id: "$userId",
        totalPrimary: { $sum: "$primary" },
      },
    },
    { $sort: { totalPrimary: -1 } },
    { $limit: limit },
  ]);
}

export async function setGuildCurrencies(guildId, values) {
  return updateGuildCurrencies(guildId, values);
}
