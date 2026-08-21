import * as BoostSettings from "../models/BoostSettings.js";
import * as EconomyAccount from "../models/EconomyAccount.js";
import { getGuildEconomyConfig } from "./economyManager.js";
import { cv2 } from "../helpers/cv2.js";

function parseJson(json) {
  if (!json) return [];
  try {
    return JSON.parse(json);
  } catch {
    return [];
  }
}

export async function getSettings(guildId) {
  return BoostSettings.getOrCreate(guildId);
}

export async function setSettings(guildId, values) {
  return BoostSettings.save(guildId, values);
}

export async function hasUnlockedCommand(guildId, userId, commandName) {
  const account = await EconomyAccount.getOrCreate(guildId, userId);
  if (!account?.unlockedCommands?.length) return false;
  return account.unlockedCommands.some((c) => c.toLowerCase() === commandName.toLowerCase());
}

export async function applyBoostPerks(guildId, userId, member, client) {
  const settings = await BoostSettings.getOrCreate(guildId);
  if (!settings.enabled) return null;

  const account = await EconomyAccount.getOrCreate(guildId, userId);

  if (settings.rewardPrimary) account.primary += settings.rewardPrimary;
  if (settings.rewardSecondary) account.secondary += settings.rewardSecondary;

  if (settings.earningsMultiplier) {
    account.earningsMultiplier = (account.earningsMultiplier || 1) + settings.earningsMultiplier;
  }

  if (settings.level) {
    account.level = (account.level || 1) + settings.level;
  }

  if (settings.roleId && member) {
    await member.roles.add(settings.roleId).catch(() => {
      console.warn(`Could not assign boost role ${settings.roleId} to ${userId}`);
    });
  }

  const accountUnlocked = account.unlockedCommands || [];
  if (settings.specialCommands?.length) {
    for (const cmd of settings.specialCommands) {
      if (!accountUnlocked.includes(cmd)) accountUnlocked.push(cmd);
    }
  }
  account.unlockedCommands = accountUnlocked;

  await EconomyAccount.save(account);

  if (settings.messageChannelId && client) {
    const channel = client.channels.cache.get(settings.messageChannelId);
    if (channel?.isTextBased()) {
      const message = settings.thankMessage?.replace(/\{user\}/g, `<@${userId}>`) || `Thanks <@${userId}> for boosting the server!`;
      const currency = await getGuildEconomyConfig(guildId);
      const perks = [];
      if (settings.rewardPrimary) perks.push(`${settings.rewardPrimary.toLocaleString()} ${currency.primary.name}`);
      if (settings.rewardSecondary) perks.push(`${settings.rewardSecondary.toLocaleString()} ${currency.secondary.name}`);
      if (settings.roleId) perks.push(`<@&${settings.roleId}>`);
      if (settings.earningsMultiplier) perks.push(`+${settings.earningsMultiplier} earnings`);
      if (settings.level) perks.push(`+${settings.level} level`);
      if (settings.specialCommands?.length) perks.push(`unlocks ${settings.specialCommands.join(", ")}`);

      const payload = cv2({
        color: 0xff61a5,
        title: "New Server Boost!",
        description: message,
        fields: perks.length ? [{ name: "Perks received", value: perks.join("\n"), inline: true }] : [],
      });

      await channel.send(payload).catch(() => {});
    }
  }

  return account;
}
