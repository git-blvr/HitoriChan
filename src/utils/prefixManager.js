import GuildSettings from "../models/GuildSettings.js";

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

  const settings = await GuildSettings.findOneAndUpdate(
    { guildId },
    {},
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
  );

  cache.set(guildId, settings);
  return settings;
}

export async function getPrefix(guildId) {
  const settings = await getGuildSettings(guildId);
  return settings.prefix ?? DEFAULT_PREFIX;
}

export async function setPrefix(guildId, prefix) {
  const settings = await GuildSettings.findOneAndUpdate(
    { guildId },
    { prefix },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
  );

  cache.set(guildId, settings);
}

export async function setGuildCurrencies(guildId, values) {
  const update = {};
  if (values.primaryName !== undefined) update["primaryCurrency.name"] = values.primaryName;
  if (values.primarySymbol !== undefined) update["primaryCurrency.symbol"] = values.primarySymbol;
  if (values.secondaryName !== undefined) update["secondaryCurrency.name"] = values.secondaryName;
  if (values.secondarySymbol !== undefined) update["secondaryCurrency.symbol"] = values.secondarySymbol;

  const settings = await GuildSettings.findOneAndUpdate(
    { guildId },
    update,
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
  );

  cache.set(guildId, settings);
  return settings;
}
