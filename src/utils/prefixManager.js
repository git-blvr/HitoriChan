import * as GuildSettings from "../models/GuildSettings.js";

export const DEFAULT_PREFIX = "_";
const cache = new Map();

export async function getGuildSettings(guildId) {
  if (!guildId) {
    return {
      prefix: DEFAULT_PREFIX,
      primaryCurrency: { name: "Starry Coins", symbol: "coins " },
      secondaryCurrency: { name: "FOLTs", symbol: "folts " },
    };
  }

  if (cache.has(guildId)) return cache.get(guildId);

  const settings = await GuildSettings.getOrCreate(guildId);
  cache.set(guildId, settings);
  return settings;
}

export async function getPrefix(guildId) {
  const settings = await getGuildSettings(guildId);
  return settings.prefix ?? DEFAULT_PREFIX;
}

export async function setPrefix(guildId, prefix) {
  const settings = await GuildSettings.setPrefix(guildId, prefix);
  cache.set(guildId, settings);
  return settings;
}

export async function setGuildCurrencies(guildId, values) {
  const settings = await GuildSettings.setCurrencies(guildId, values);
  cache.set(guildId, settings);
  return settings;
}
