import GuildSettings from "../models/GuildSettings.js";

export const DEFAULT_PREFIX = "_";
const cache = new Map();

export async function getPrefix(guildId) {
  if (!guildId) return DEFAULT_PREFIX;
  if (cache.has(guildId)) return cache.get(guildId);

  const settings = await GuildSettings.findOne({ guildId });
  const prefix = settings?.prefix ?? DEFAULT_PREFIX;
  cache.set(guildId, prefix);
  return prefix;
}

export async function setPrefix(guildId, prefix) {
  await GuildSettings.findOneAndUpdate({ guildId }, { prefix }, { upsert: true });
  cache.set(guildId, prefix);
}