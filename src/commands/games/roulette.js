import { SlashCommandBuilder } from "discord.js";
import { cv2 } from "../../helpers/cv2.js";
import { embErr } from "../../helpers/embeds.js";
import {
  formatCurrency, getGuildEconomyConfig, getEconomyAccount, adjustBalance, validateBet,
} from "../../utils/economyManager.js";
import { recordGameResult } from "../../utils/economyManager.js";
import { ROULETTE_BETS, spinRoulette, rouletteResult, RED_NUMBERS } from "../../utils/gameLogic.js";

const BET_CHOICES = Object.entries(ROULETTE_BETS).map(([value, d]) => ({ name: d.label, value }));

function parseBet(raw, numberRaw) {
  const s = String(raw ?? "").toLowerCase();
  if (s === "number" || /^\d+$/.test(s)) {
    const n = s === "number" ? Number(numberRaw) : Number(s);
    if (!Number.isInteger(n) || n < 0 || n > 36) return { error: "Straight bets need a number between 0 and 36." };
    return { bet: { type: "number", number: n }, label: `#${n}` };
  }
  if (!ROULETTE_BETS[s]) {
    return { error: `Unknown bet. Choose ${Object.keys(ROULETTE_BETS).join(", ")}, or a number 0–36.` };
  }
  return { bet: { type: s }, label: ROULETTE_BETS[s].label };
}

function colorOf(n) {
  if (n === 0) return "🟢";
  return RED_NUMBERS.has(n) ? "🔴" : "⚫";
}

export default {
  data: new SlashCommandBuilder()
    .setName("roulette")
    .setDescription("Spin the roulette wheel — straight numbers pay 36x")
    .addIntegerOption((o) => o.setName("amount").setDescription("Amount to bet").setMinValue(1).setRequired(true))
    .addStringOption((o) =>
      o.setName("bet").setDescription("What to bet on").setRequired(true)
        .addChoices(...BET_CHOICES, { name: "Straight number (0–36)", value: "number" })
    )
    .addIntegerOption((o) => o.setName("number").setDescription("For straight bets: 0–36").setMinValue(0).setMaxValue(36)),
  prefixName: "roulette",
  aliases: ["roul", "wheel"],
  syntax: "{prefix}roulette <amount> <red|black|odd|even|high|low|0-36>",
  example: "{prefix}roulette 100 red",

  async execute(ctx) {
    if (!ctx.guild) return ctx.reply(embErr("This command only works in a server."));
    const amount = Math.floor(Number(ctx.getOption("amount", 0)) || 0);
    const betRaw = ctx.getOption("bet", 1);
    const numberRaw = ctx.getOption("number", 2);

    const parsed = parseBet(betRaw, numberRaw);
    if (parsed.error) return ctx.reply(embErr(parsed.error));

    const check = await validateBet(ctx.guild.id, ctx.user.id, amount);
    if (check.error) return ctx.reply(embErr(check.error));

    const landed = spinRoulette();
    const { won, payout } = rouletteResult(parsed.bet, landed);
    const winnings = won ? amount * payout : 0;

    await adjustBalance(ctx.guild.id, ctx.user.id, "primary", won ? winnings - amount : -amount);
    await recordGameResult(ctx.guild.id, [{ userId: ctx.user.id, won, wagered: amount, wonAmount: winnings }]);

    const [config, updated] = await Promise.all([
      getGuildEconomyConfig(ctx.guild.id),
      getEconomyAccount(ctx.guild.id, ctx.user.id),
    ]);

    await ctx.reply(cv2({
      color: won ? 0x57f287 : 0xff3333,
      title: won ? "🎡 Roulette — winner!" : "🎡 Roulette",
      description: `The ball lands on ${colorOf(landed)} **${landed}**.\nYour bet: **${parsed.label}** (${payout}x)`,
      fields: [
        { name: won ? "Payout" : "You lost", value: formatCurrency(won ? winnings : amount, config.primary), inline: true },
        { name: "New balance", value: formatCurrency(updated.primary, config.primary), inline: true },
      ],
    }));
  },
};
