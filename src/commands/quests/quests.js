import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { cv2 } from "../../helpers/cv2.js";
import * as Quest from "../../models/Quest.js";
import * as QuestProgress from "../../models/QuestProgress.js";
import { getGuildEconomyConfig, formatCurrency } from "../../utils/economyManager.js";

function formatReward(quest, economyConfig) {
  if (!quest.rewardType) return "No reward";

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

export default {
  data: new SlashCommandBuilder()
    .setName("quests")
    .setDescription("View your completed quests and rewards."),
  prefixName: "quests",
  category: "quests",
  async execute(ctx) {
    await ctx.deferReply({ flags: MessageFlags.Ephemeral });

    const guildId = ctx.guild?.id;
    const userId = ctx.user.id;
    if (!guildId) {
      return ctx.editReply("This command only works in a server.");
    }

    const [quests, economyConfig] = await Promise.all([
      Quest.getAllForGuild(guildId),
      getGuildEconomyConfig(guildId),
    ]);

    const completed = [];
    for (const quest of quests) {
      const progress = await QuestProgress.get(quest.id, userId);
      if (progress?.status === "completed" || progress?.status === "claimed") {
        completed.push({ quest, progress });
      }
    }

    if (!completed.length) {
      return ctx.editReply("You haven't completed any quests yet. Use `/quests` (this command) to track your progress, or check the quest board for active quests.");
    }

    const fields = completed.map(({ quest, progress }) => ({
      name: quest.name,
      value: `${quest.description ? quest.description + "\n" : ""}Prize: ${formatReward(quest, economyConfig)}${progress.completedAt ? `\nCompleted <t:${Math.floor(progress.completedAt / 1000)}:R>` : ""}`,
      inline: false,
    }));

    const payload = cv2({
      color: 0x8b5cf6,
      title: `${ctx.user.username}'s Completed Quests`,
      description: `You have completed **${completed.length}** quest(s).`,
      fields,
      separators: true,
      thumbnail: ctx.user.displayAvatarURL?.({ size: 128 }) ?? null,
    });

    return ctx.editReply(payload);
  },
};
