import { SlashCommandBuilder } from "discord.js";
import { cv2 } from "../../helpers/cv2.js";
import { queryGroq } from "../../ai/groq.js";
import { checkCooldown, clearCooldown } from "../../utils/cooldowns.js";
import * as EconomyAccount from "../../models/EconomyAccount.js";

const FOLT_COST   = 750;
const COOLDOWN_MS = 5 * 60 * 1000;
const COLOR       = 0x5865f2;

export default {
  data: new SlashCommandBuilder()
    .setName("ask")
    .setDescription("Ask Bocchi anything (costs 750 FOLTs)")
    .addStringOption((o) =>
      o.setName("question").setDescription("Your question").setRequired(true)
    ),
  prefixName: "ask",
  syntax: "{prefix}ask <question>",
  example: "{prefix}ask what's your favorite song?",
  async execute(ctx) {
    const isBoosting = !!ctx.member?.premiumSince;
    const cooldown = checkCooldown(ctx.user.id, "ask", COOLDOWN_MS, isBoosting);

    if (cooldown > 0) {
      const mins = Math.floor(cooldown / 60);
      const secs = cooldown % 60;
      const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
      await ctx.reply(cv2({
        color: 0xff3333,
        description: `⏳ You're on cooldown! Try again in **${timeStr}**.${isBoosting ? "\n-# Booster discount applied ✨" : ""}`,
        ephemeral: true,
      }));
      return;
    }

    const account = await EconomyAccount.getOrCreate(ctx.guild.id, ctx.user.id);

    if (account.secondary < FOLT_COST) {
      clearCooldown(ctx.user.id, "ask");
      await ctx.reply(cv2({
        color: 0xff3333,
        description: `You need **${FOLT_COST} £T** to use this command.\nYour balance: **${account.secondary.toLocaleString()} £T**`,
        ephemeral: true,
      }));
      return;
    }

    const question = ctx.isInteraction
      ? ctx.source?.options?.getString("question")
      : ctx.args?.join(" ");

    if (!question?.trim()) {
      clearCooldown(ctx.user.id, "ask");
      await ctx.reply(cv2({
        color: COLOR,
        description: "Please provide a question.",
        ephemeral: true,
      }));
      return;
    }

    await ctx.deferReply();

    try {
      const reply = await queryGroq({
        messages: [{ role: "user", content: question }],
        maxTokens: 512,
        guildId: ctx.guild?.id,
        userName: ctx.user.username,
      });

      await EconomyAccount.adjust(ctx.guild.id, ctx.user.id, "secondary", -FOLT_COST);

      await ctx.editReply(cv2({
        color: COLOR,
        author: { name: ctx.user.username, iconURL: ctx.user.displayAvatarURL() },
        fields: [
          { name: "Question", value: question.slice(0, 1024) },
          { name: "Answer",   value: reply.slice(0, 1024) },
        ],
        footer: { text: `Cost: 750 £T${isBoosting ? " • Booster discount applied ✨" : ""}` },
      }));
    } catch (err) {
      console.error("Ask command error:", err);
      clearCooldown(ctx.user.id, "ask");
      await ctx.editReply(cv2({
        color: 0xff3333,
        description: "❌ Something went wrong. You were not charged and your cooldown has been reset.",
      }));
    }
  },
};
