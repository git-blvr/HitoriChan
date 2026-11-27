import { SlashCommandBuilder } from "discord.js";
import { cv2 } from "../../helpers/cv2.js";
import {
  getGuildEconomyConfig, getBankAccount, bankDeposit, bankWithdraw, formatCurrency,
} from "../../utils/economyManager.js";
import { embErr } from "../../helpers/embeds.js";

function parseAmount(raw, max) {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "all" || s === "max") return max;
  const n = Math.floor(Number(s));
  return Number.isFinite(n) ? n : NaN;
}

export default {
  data: new SlashCommandBuilder()
    .setName("bank")
    .setDescription("Manage your bank — deposits are safe from robberies and earn interest")
    .addSubcommand((s) =>
      s.setName("info").setDescription("View wallet, bank, and accrued interest"))
    .addSubcommand((s) =>
      s.setName("deposit").setDescription("Move coins into the bank")
        .addStringOption((o) => o.setName("amount").setDescription("Amount, or 'all'").setRequired(true)))
    .addSubcommand((s) =>
      s.setName("withdraw").setDescription("Pull coins out of the bank")
        .addStringOption((o) => o.setName("amount").setDescription("Amount, or 'all'").setRequired(true))),
  prefixName: "bank",
  aliases: ["vault"],
  syntax: "{prefix}bank | {prefix}bank deposit <amount|all> | {prefix}bank withdraw <amount|all>",
  example: "{prefix}bank deposit 500",

  async execute(ctx) {
    if (!ctx.guild) return ctx.reply(embErr("This command only works in a server."));

    const sub = ctx.isInteraction ? ctx.source.options.getSubcommand() : (ctx.args[0] || "info").toLowerCase();
    const amountRaw = ctx.getOption("amount", 1);
    const config = await getGuildEconomyConfig(ctx.guild.id);

    if (sub === "deposit" || sub === "dep") {
      const { account } = await getBankAccount(ctx.guild.id, ctx.user.id);
      const amount = parseAmount(amountRaw, account.primary);
      if (!Number.isFinite(amount) || amount <= 0) return ctx.reply(embErr("Enter a valid amount, or `all`."));
      try {
        const updated = await bankDeposit(ctx.guild.id, ctx.user.id, amount);
        return ctx.reply(cv2({
          color: 0x57f287,
          title: "🏦 Deposit complete",
          fields: [
            { name: "Deposited", value: formatCurrency(amount, config.primary), inline: true },
            { name: "Wallet", value: formatCurrency(updated.primary, config.primary), inline: true },
            { name: "Bank", value: formatCurrency(updated.bank, config.primary), inline: true },
          ],
        }));
      } catch (err) {
        return ctx.reply(embErr(err.message));
      }
    }

    if (sub === "withdraw" || sub === "wd") {
      const { account } = await getBankAccount(ctx.guild.id, ctx.user.id);
      const amount = parseAmount(amountRaw, account.bank);
      if (!Number.isFinite(amount) || amount <= 0) return ctx.reply(embErr("Enter a valid amount, or `all`."));
      try {
        const updated = await bankWithdraw(ctx.guild.id, ctx.user.id, amount);
        return ctx.reply(cv2({
          color: 0x57f287,
          title: "🏦 Withdrawal complete",
          fields: [
            { name: "Withdrew", value: formatCurrency(amount, config.primary), inline: true },
            { name: "Wallet", value: formatCurrency(updated.primary, config.primary), inline: true },
            { name: "Bank", value: formatCurrency(updated.bank, config.primary), inline: true },
          ],
        }));
      } catch (err) {
        return ctx.reply(embErr(err.message));
      }
    }

    const { account, games, interest } = await getBankAccount(ctx.guild.id, ctx.user.id);
    const emoji = config.primary.emoji ? `${config.primary.emoji} ` : "";
    await ctx.reply(cv2({
      color: 0x5865f2,
      title: "🏦 Your bank",
      fields: [
        { name: "Wallet", value: `${emoji}${account.primary.toLocaleString()}`, inline: true },
        { name: "Bank", value: `${emoji}${account.bank.toLocaleString()}`, inline: true },
        { name: "Interest", value: `${games.bankInterestRate}% daily${interest ? ` (+${interest.toLocaleString()} just accrued)` : ""}`, inline: true },
      ],
      footer: { text: "Banked coins can't be stolen by /rob" },
    }));
  },
};
