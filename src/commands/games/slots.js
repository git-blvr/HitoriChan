import { SlashCommandBuilder } from "discord.js";
import { cv2 } from "../../helpers/cv2.js";
import { getEconomyAccount, getGuildEconomyConfig, formatCurrency, adjustBalance } from "../../utils/economyManager.js";
import { embErr } from "../../helpers/embeds.js";

const SYMBOLS = ["🍒", "🍋", "🍇", "7️⃣", "💎", "🔔"];
const PAYOUTS = {
  "7️⃣": 10,
  "💎": 5,
  "🔔": 3,
  "🍇": 2,
  "�": 2,
  "🍒": 2,
};

export default {
  data: new SlashCommandBuilder()
    .setName("slots")
    .setDescription("Spin the slot machine")
    .addIntegerOption((o) => o.setName("amount").setDescription("Amount to bet").setMinValue(1).setRequired(true)),
  prefixName: "slots",
  aliases: ["slot"],
  syntax: "{prefix}slots <amount>",
  example: "{prefix}slots 100",

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

    const roll = Array.from({ length: 3 }, () => SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]);
    const allSame = roll[0] === roll[1] && roll[1] === roll[2];
    const multiplier = allSame ? (PAYOUTS[roll[0]] || 1) : 0;
    const won = multiplier > 0;
    const payout = Math.floor(amount * multiplier);

    await adjustBalance(ctx.guild.id, ctx.user.id, "primary", won ? payout - amount : -amount);
    const updated = await getEconomyAccount(ctx.guild.id, ctx.user.id);

    const description = won
      ? `**${roll.join(" ")}** — you won **${multiplier}x**!`
      : `**${roll.join(" ")}** — better luck next time.`;

    await ctx.reply(cv2({
      color: won ? 0x57f287 : 0xff3333,
      title: won ? "🎰 Jackpot!" : "🎰 Slots",
      description,
      fields: [
        { name: won ? "Payout" : "You lost", value: formatCurrency(won ? payout : amount, config.primary), inline: true },
        { name: "New balance", value: formatCurrency(updated.primary, config.primary), inline: true },
      ],
    }));
  },
};
