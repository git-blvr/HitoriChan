import { SlashCommandBuilder } from "discord.js";
import { cv2 } from "../../helpers/cv2.js";
import { getEconomyAccount, getGuildEconomyConfig, formatCurrency, adjustBalance } from "../../utils/economyManager.js";
import { embErr } from "../../helpers/embeds.js";

export default {
  data: new SlashCommandBuilder()
    .setName("highlow")
    .setDescription("Guess if the hidden number is higher or lower than the shown number.")
    .addIntegerOption((o) => o.setName("amount").setDescription("Amount to bet").setMinValue(1).setRequired(true))
    .addStringOption((o) =>
      o.setName("guess")
        .setDescription("Higher or lower?")
        .setRequired(true)
        .addChoices({ name: "Higher", value: "high" }, { name: "Lower", value: "low" })
    ),
  prefixName: "highlow",
  aliases: ["hl"],
  syntax: "{prefix}highlow <amount> <high|low>",
  example: "{prefix}highlow 100 high",

  async execute(ctx) {
    const amount = Number(ctx.getOption("amount", 0));
    const guess = String(ctx.getOption("guess", 1) ?? "").toLowerCase();
    if (!Number.isFinite(amount) || amount <= 0) {
      return ctx.reply(embErr("Please enter a valid amount greater than 0."));
    }
    if (!["high", "low"].includes(guess)) {
      return ctx.reply(embErr("Guess `high` or `low`."));
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

    const shown = Math.floor(Math.random() * 100) + 1;
    const hidden = Math.floor(Math.random() * 100) + 1;
    const higher = hidden > shown;
    const won = (guess === "high" && higher) || (guess === "low" && !higher);
    const payout = Math.floor(amount * 1.8);

    await adjustBalance(ctx.guild.id, ctx.user.id, "primary", won ? payout - amount : -amount);
    const updated = await getEconomyAccount(ctx.guild.id, ctx.user.id);

    await ctx.reply(cv2({
      color: won ? 0x57f287 : 0xff3333,
      title: won ? "🎯 You Guessed Right!" : "🎯 You Guessed Wrong",
      description: `Shown: **${shown}** — Hidden: **${hidden}**. It was **${higher ? "higher" : "lower"}**!`,
      fields: [
        { name: won ? "Payout" : "You lost", value: formatCurrency(won ? payout : amount, config.primary), inline: true },
        { name: "New balance", value: formatCurrency(updated.primary, config.primary), inline: true },
      ],
    }));
  },
};
