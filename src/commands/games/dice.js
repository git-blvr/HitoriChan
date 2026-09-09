import { SlashCommandBuilder } from "discord.js";
import { cv2 } from "../../helpers/cv2.js";
import { getEconomyAccount, getGuildEconomyConfig, formatCurrency, adjustBalance } from "../../utils/economyManager.js";
import { embErr } from "../../helpers/embeds.js";

export default {
  data: new SlashCommandBuilder()
    .setName("dice")
    .setDescription("Roll two dice. 7 or higher wins 2x, doubles win 3x.")
    .addIntegerOption((o) => o.setName("amount").setDescription("Amount to bet").setMinValue(1).setRequired(true)),
  prefixName: "dice",
  aliases: ["rolldice", "2d6"],
  syntax: "{prefix}dice <amount>",
  example: "{prefix}dice 100",

  async execute(ctx) {
    const amount = Number(ctx.getOption("amount", 0));
    if (!Number.isFinite(amount) || amount <= 0) {
      return ctx.reply(embErr("Please enter a valid amount greater than 0."));
    }

    const [config, account] = await Promise.all([
      getGuildEconomyConfig(ctx.guild.id),
      getEconomyAccount(ctx.guild.id, ctx.user.id),
    ]);

    if (account.primary < amount) {
      return ctx.reply(
        embErr(`You don't have enough ${formatCurrency(amount, config.primary)}.\nBalance: ${formatCurrency(account.primary, config.primary)}`)
      );
    }

    const d1 = Math.floor(Math.random() * 6) + 1;
    const d2 = Math.floor(Math.random() * 6) + 1;
    const total = d1 + d2;
    const doubles = d1 === d2;
    const won = total >= 7 || doubles;
    const multiplier = doubles ? 3 : total >= 7 ? 2 : 0;
    const payout = Math.floor(amount * multiplier);

    await adjustBalance(ctx.guild.id, ctx.user.id, "primary", won ? payout - amount : -amount);
    const updated = await getEconomyAccount(ctx.guild.id, ctx.user.id);

    await ctx.reply(cv2({
      color: won ? 0x57f287 : 0xff3333,
      title: won ? "🎲 You Won!" : "🎲 You Lost",
      description: `You rolled **${d1}** and **${d2}** (total **${total}**).${doubles ? " Doubles!" : ""}`,
      fields: [
        { name: won ? "Payout" : "You lost", value: formatCurrency(won ? payout : amount, config.primary), inline: true },
        { name: "New balance", value: formatCurrency(updated.primary, config.primary), inline: true },
      ],
    }));
  },
};
