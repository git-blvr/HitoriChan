import { cv2 } from "../helpers/cv2.js";
import * as Quest from "../models/Quest.js";
import * as QuestBoard from "../models/QuestBoard.js";
import { getGuildEconomyConfig, formatCurrency } from "./economyManager.js";

export function formatReward(quest, economyConfig) {
  if (!quest.rewardType) return "No direct reward";

  if (quest.rewardType === "currency") {
    const currency = quest.rewardValue === "secondary" ? economyConfig?.secondary : economyConfig?.primary;
    if (!currency) return `${quest.rewardAmount?.toLocaleString?.() || 0} ${quest.rewardValue}`;
    const emoji = currency.emoji ? `${currency.emoji} ` : "";
    const amount = Number(quest.rewardAmount) || 0;
    return `${emoji}${formatCurrency(amount, currency)} ${currency.name}`.trim();
  }

  if (quest.rewardType === "role") {
    return quest.rewardValue ? `<@&${quest.rewardValue}>` : "Role reward";
  }

  return `${quest.rewardType}: ${quest.rewardValue || "—"}`;
}

export function buildQuestBoardPayload(guild, quests, economyConfig) {
  const fields = quests.map((q) => ({
    name: q.name,
    value: `${q.description ? q.description + "\n" : ""}Prize: ${formatReward(q, economyConfig)}`,
    inline: false,
  }));

  if (!fields.length) {
    fields.push({ name: "No active quests", value: "Check back later for new quests!", inline: false });
  }

  return cv2({
    color: 0x8b5cf6,
    title: `${guild.name} Quests`,
    description: "Active quests and their rewards. Complete them to earn prizes!",
    fields,
    separators: true,
    thumbnail: guild.iconURL?.({ size: 128 }) ?? null,
  });
}

export async function updateQuestBoard(client, guildId) {
  const board = await QuestBoard.get(guildId);
  if (!board?.enabled || !board.channelId) return null;

  const guild = client?.guilds?.cache?.get(guildId);
  if (!guild) return null;

  const channel = guild.channels.cache.get(board.channelId);
  if (!channel?.isTextBased()) return null;

  const quests = await Quest.getEnabledForGuild(guildId);
  const economyConfig = await getGuildEconomyConfig(guildId);
  const payload = buildQuestBoardPayload(guild, quests, economyConfig);

  try {
    if (board.messageId) {
      try {
        const message = await channel.messages.fetch(board.messageId);
        if (message) {
          await message.edit(payload);
          return board.messageId;
        }
      } catch {
        // message was deleted or unavailable, fall through to resend
      }
    }

    const message = await channel.send(payload);
    if (message?.id) {
      await QuestBoard.save(guildId, { messageId: message.id });
      return message.id;
    }
  } catch (err) {
    console.error(`[questBoard] Failed to update quest board for ${guildId}:`, err.message);
  }

  return null;
}
