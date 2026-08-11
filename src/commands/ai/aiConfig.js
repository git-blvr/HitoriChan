import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from "discord.js";
import * as AISettings from "../../models/AISettings.js";

const COLOR = 0x5865f2;
const SUBCOMMANDS = new Set(["toggle", "mode", "channel", "view", "prompt", "clearprompt"]);

function getSub(ctx) {
  const slash = ctx.source?.options?.getSubcommand?.();
  if (slash) return slash;
  const first = ctx.args?.[0]?.toLowerCase();
  return SUBCOMMANDS.has(first) ? first : null;
}

export default {
  data: new SlashCommandBuilder()
    .setName("aiconfig")
    .setDescription("Configure the AI chatbot")
    .addSubcommand((s) =>
      s.setName("toggle").setDescription("Enable or disable the AI chatbot")
    )
    .addSubcommand((s) =>
      s.setName("mode")
        .setDescription("Set where the bot responds")
        .addStringOption((o) =>
          o.setName("mode")
            .setDescription("everywhere = mentions only, channel = auto-reply in one channel")
            .setRequired(true)
            .addChoices(
              { name: "Everywhere (mention/reply to trigger)", value: "everywhere" },
              { name: "Specific channel (auto-reply, no mention needed)", value: "channel" }
            )
        )
    )
    .addSubcommand((s) =>
      s.setName("channel")
        .setDescription("Set the specific channel for channel mode")
        .addChannelOption((o) => o.setName("channel").setDescription("AI chat channel").setRequired(true))
    )
    .addSubcommand((s) =>
      s.setName("prompt")
        .setDescription("Add a custom server-wide system prompt note")
        .addStringOption((o) => o.setName("text").setDescription("Custom prompt instructions").setRequired(true).setMaxLength(1000))
    )
    .addSubcommand((s) =>
      s.setName("clearprompt").setDescription("Remove the custom prompt note")
    )
    .addSubcommand((s) =>
      s.setName("view").setDescription("View current AI settings")
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  prefixName: "aiconfig",
  syntax: "{prefix}aiconfig <toggle|mode|channel|prompt|clearprompt|view>",
  example: "{prefix}aiconfig toggle",
  async execute(ctx) {
    if (!ctx.member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
      await ctx.reply({ embeds: [new EmbedBuilder().setColor(COLOR).setDescription("You need Manage Server permission.")] });
      return;
    }

    const sub = getSub(ctx);
    if (!sub) {
      await ctx.reply({ embeds: [new EmbedBuilder().setColor(COLOR).setDescription("Usage: `aiconfig <toggle|mode|channel|prompt|clearprompt|view>`")] });
      return;
    }

    if (sub === "view") {
      const s = await AISettings.getOrCreate(ctx.guild.id);
      await ctx.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLOR)
            .setTitle("AI Chatbot Settings")
            .addFields(
              { name: "Status",   value: s.enabled ? "✅ Enabled" : "❌ Disabled", inline: true },
              { name: "Mode",     value: s.mode === "channel" ? "📌 Specific channel" : "🌐 Everywhere", inline: true },
              { name: "Channel",  value: s.channelId ? `<#${s.channelId}>` : "Not set", inline: true },
              { name: "Custom Prompt", value: s.customPrompt ? s.customPrompt.slice(0, 1000) : "None" },
            )
            .setFooter({ text: "Use /aiconfig mode to change how the bot triggers" }),
        ],
      });
      return;
    }

    if (sub === "toggle") {
      const s = await AISettings.toggle(ctx.guild.id);
      await ctx.reply({
        embeds: [new EmbedBuilder().setColor(COLOR).setDescription(`AI chatbot is now **${s.enabled ? "enabled ✅" : "disabled ❌"}**.`)],
      });
      return;
    }

    if (sub === "mode") {
      const mode = ctx.isInteraction
        ? ctx.source?.options?.getString("mode")
        : ctx.args?.[1]?.toLowerCase();

      if (!["everywhere", "channel"].includes(mode)) {
        await ctx.reply({ embeds: [new EmbedBuilder().setColor(COLOR).setDescription("Mode must be `everywhere` or `channel`.")] });
        return;
      }

      await AISettings.setMode(ctx.guild.id, mode);

      const desc = mode === "everywhere"
        ? "Bocchi will now respond to **mentions and replies** in any channel."
        : "Bocchi will now **auto-reply** in a specific channel. Set it with `/aiconfig channel`.";

      await ctx.reply({ embeds: [new EmbedBuilder().setColor(COLOR).setDescription(desc)] });
      return;
    }

    if (sub === "channel") {
      let channelId;
      if (ctx.isInteraction) {
        channelId = ctx.source?.options?.getChannel("channel")?.id;
      } else {
        const raw = ctx.args?.[1];
        const match = String(raw ?? "").match(/<#(\d+)>/);
        channelId = match?.[1] ?? raw;
      }

      if (!channelId) {
        await ctx.reply({ embeds: [new EmbedBuilder().setColor(COLOR).setDescription("Please mention a valid channel.")] });
        return;
      }

      await AISettings.setChannel(ctx.guild.id, channelId);
      await ctx.reply({
        embeds: [new EmbedBuilder().setColor(COLOR).setDescription(`AI chat channel set to <#${channelId}>.\nMode automatically switched to **channel**. `)],
      });
      return;
    }

    if (sub === "prompt") {
      const text = ctx.isInteraction
        ? ctx.source?.options?.getString("text")
        : ctx.args?.slice(1).join(" ");

      if (!text?.trim()) {
        await ctx.reply({ embeds: [new EmbedBuilder().setColor(COLOR).setDescription("Please provide prompt text.")] });
        return;
      }

      await AISettings.setCustomPrompt(ctx.guild.id, text.trim());
      await ctx.reply({
        embeds: [new EmbedBuilder().setColor(COLOR).setDescription("Custom prompt saved. Bocchi will keep it in mind when replying.")],
      });
      return;
    }

    if (sub === "clearprompt") {
      await AISettings.setCustomPrompt(ctx.guild.id, null);
      await ctx.reply({
        embeds: [new EmbedBuilder().setColor(COLOR).setDescription("Custom prompt removed.")],
      });
    }
  },
};
