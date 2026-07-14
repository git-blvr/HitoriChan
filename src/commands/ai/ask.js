import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";
import { queryGroq } from "../../ai/groq.js";
import { checkCooldown, clearCooldown } from "../../utils/cooldowns.js";
import EconomyAccount from "../../models/EconomyAccount.js";

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
      await ctx.reply({
        embeds: [new EmbedBuilder().setColor(0xff3333).setDescription(
          `⏳ You're on cooldown! Try again in **${timeStr}**.${isBoosting ? "\n-# Booster discount applied ✨" : ""}`
        )],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const profile = await EconomyAccount.findOne({ userId: ctx.user.id, guildId: ctx.guild.id });
    const balance = profile?.secondary ?? 0;

    if (balance < FOLT_COST) {
      clearCooldown(ctx.user.id, "ask");
      await ctx.reply({
        embeds: [new EmbedBuilder().setColor(0xff3333).setDescription(
          `You need **${FOLT_COST} £T** to use this command.\nYour balance: **${balance.toLocaleString()} £T**`
        )],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const question = ctx.isInteraction
      ? ctx.source?.options?.getString("question")
      : ctx.args?.join(" ");

    if (!question?.trim()) {
      clearCooldown(ctx.user.id, "ask");
      await ctx.reply({
        embeds: [new EmbedBuilder().setColor(COLOR).setDescription("Please provide a question.")],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await ctx.deferReply();

    try {
      const reply = await queryGroq([{ role: "user", content: question }], 512);

      await EconomyAccount.findOneAndUpdate(
        { userId: ctx.user.id, guildId: ctx.guild.id },
        { $inc: { folts: -FOLT_COST } }
      );

      const embed = new EmbedBuilder()
        .setColor(COLOR)
        .setAuthor({ name: ctx.user.username, iconURL: ctx.user.displayAvatarURL() })
        .addFields(
          { name: "Question", value: question.slice(0, 1024) },
          { name: "Answer",   value: reply.slice(0, 1024) }
        )
        .setFooter({ text: `Cost: 750 £T${isBoosting ? " • Booster discount applied ✨" : ""}` });

      await ctx.editReply({ embeds: [embed] });
    } catch (err) {
      console.error("Ask command error:", err);
      clearCooldown(ctx.user.id, "ask");
      await ctx.editReply({
        embeds: [new EmbedBuilder().setColor(0xff3333).setDescription("❌ Something went wrong. You were not charged and your cooldown has been reset.")],
      });
    }
  },
};