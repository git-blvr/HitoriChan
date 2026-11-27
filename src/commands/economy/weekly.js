import { SlashCommandBuilder } from "discord.js";
import { cv2 } from "../../helpers/cv2.js";
import {
  getEconomyAccount, claimWeekly, getWeeklyCooldown, getGuildEconomyConfig,
} from "../../utils/economyManager.js";
import { embErr, embWrn } from "../../helpers/embeds.js";

function fmtRemaining(ms) {
  const totalSec = Math.ceil(ms / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

export default {
  data: new SlashCommandBuilder()
    .setName("weekly")
    .setDescription("Claim your weekly economy reward — a bigger payout than daily"),
  prefixName: "weekly",
  syntax: "{prefix}weekly",
  example: "{prefix}weekly",

  async execute(ctx) {
    if (!ctx.guild) return ctx.reply(embErr("This command only works in a server."));

    const account = await getEconomyAccount(ctx.guild.id, ctx.user.id);
    const remaining = getWeeklyCooldown(account);
    if (remaining > 0) {
      return ctx.reply(embWrn(`**Weekly reward already claimed**\n\nCome back in ${fmtRemaining(remaining)} to claim again.`));
    }

    const [claimed, config] = await Promise.all([
      claimWeekly(ctx.guild.id, ctx.user.id),
      getGuildEconomyConfig(ctx.guild.id),
    ]);
    if (!claimed) {
      return ctx.reply(embWrn("**Weekly reward already claimed**\n\nCome back in 7 days to claim again."));
    }
    const { account: updated, reward } = claimed;
    const emoji = config.primary.emoji ? `${config.primary.emoji} ` : "";

    await ctx.reply(cv2({
      color: 0xff61a5,
      title: "Weekly Reward Claimed!",
      description: `You received ${emoji}${config.primary.symbol}${reward.toLocaleString()} ${config.primary.name}.`,
      fields: [
        { name: `New ${config.primary.name} Balance`, value: `${emoji}${updated.primary.toLocaleString()}`, inline: true },
        { name: "Next weekly", value: "in 7 days", inline: true },
      ],
    }));
  },
};
