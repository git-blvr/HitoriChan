import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { cv2 } from "../../helpers/cv2.js";
import * as EconomyAccount from "../../models/EconomyAccount.js";
import { xpToNextLevel, progressToNextLevel, renderProgressBar } from "../../utils/leveling.js";
import * as LevelingSettings from "../../models/LevelingSettings.js";

export default {
  data: new SlashCommandBuilder()
    .setName("rank")
    .setDescription("Show your level and XP progress.")
    .addUserOption((option) =>
      option.setName("user").setDescription("The user to check (defaults to you).").setRequired(false)
    ),
  prefixName: "rank",
  category: "leveling",
  async execute(ctx) {
    await ctx.deferReply({ flags: MessageFlags.Ephemeral });

    const guildId = ctx.guild?.id;
    if (!guildId) {
      return ctx.editReply("This command only works in a server.");
    }

    const settings = await LevelingSettings.getOrCreate(guildId);
    const target = ctx.getOption("user", 0) ? await ctx.client.users.fetch(ctx.getOption("user", 0)) : ctx.user;
    if (!target) return ctx.editReply("Could not find that user.");

    const account = await EconomyAccount.getOrCreate(guildId, target.id);
    if (!account.totalXp && !settings.enabled) {
      return ctx.editReply("Leveling is not enabled on this server.");
    }

    const progress = progressToNextLevel(account.xp, account.level, settings.baseXp, settings.multiplier);
    const nextXp = xpToNextLevel(account.level, settings.baseXp, settings.multiplier);
    const bar = renderProgressBar(progress.percent);

    const description = `**Level ${account.level}**\n` +
      `${bar} **${progress.percent}%**\n` +
      `XP: **${account.xp.toLocaleString()} / ${nextXp.toLocaleString()}**\n` +
      `Total XP: **${account.totalXp.toLocaleString()}**`;

    const payload = cv2({
      color: 0x10b981,
      title: `${target.username}'s Rank`,
      description,
      thumbnail: target.displayAvatarURL?.({ size: 128 }) ?? null,
    });

    return ctx.editReply(payload);
  },
};
