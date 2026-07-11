import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { buildEmbed } from "./moderationHelpers.js";
import ModerationSettings from "../../models/ModerationSettings.js";

const SUBCOMMANDS = new Set(["logchannel", "modrole", "view"]);

function getSubcommand(ctx) {
  const slash = ctx.source?.options?.getSubcommand?.();
  if (slash) return slash;
  const first = ctx.args?.[0]?.toLowerCase();
  return SUBCOMMANDS.has(first) ? first : null;
}

async function getOrCreate(guildId) {
  return ModerationSettings.findOneAndUpdate(
    { guildId },
    {},
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
  );
}

export default {
  data: new SlashCommandBuilder()
    .setName("modconfig")
    .setDescription("Configure moderation settings")
    .addSubcommand((s) =>
      s.setName("logchannel")
        .setDescription("Set the moderation log channel")
        .addChannelOption((o) => o.setName("channel").setDescription("Log channel").setRequired(true))
    )
    .addSubcommand((s) =>
      s.setName("modrole")
        .setDescription("Set the moderator role")
        .addRoleOption((o) => o.setName("role").setDescription("Mod role").setRequired(true))
    )
    .addSubcommand((s) =>
      s.setName("view")
        .setDescription("View current moderation settings")
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  prefixName: "modconfig",
  syntax: "{prefix}modconfig <logchannel|modrole|view> [value]",
  example: "{prefix}modconfig logchannel #mod-logs",
  async execute(ctx) {
    if (!ctx.member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
      await ctx.reply({ embeds: [buildEmbed("You need the Manage Server permission to use this command.")] });
      return;
    }

    const sub = getSubcommand(ctx);
    if (!sub) {
      await ctx.reply({ embeds: [buildEmbed("Usage: `modconfig <logchannel|modrole|view>`")] });
      return;
    }

    if (sub === "view") {
      const settings = await getOrCreate(ctx.guild.id);
      const logChannel = settings.logChannelId ? `<#${settings.logChannelId}>` : "Not set";
      const modRole = settings.modRoleId ? `<@&${settings.modRoleId}>` : "Not set";
      await ctx.reply({ embeds: [buildEmbed(`**Moderation Settings**\n\n**Log Channel:** ${logChannel}\n**Mod Role:** ${modRole}`)] });
      return;
    }

    if (sub === "logchannel") {
      let channelId;
      if (ctx.isInteraction) {
        channelId = ctx.source?.options?.getChannel("channel")?.id;
      } else {
        const raw = ctx.args?.[1];
        const match = String(raw ?? "").match(/<#(\d+)>/);
        channelId = match?.[1] ?? raw;
      }

      if (!channelId) {
        await ctx.reply({ embeds: [buildEmbed("Please mention a valid channel.")] });
        return;
      }

      await ModerationSettings.findOneAndUpdate({ guildId: ctx.guild.id }, { logChannelId: channelId }, { upsert: true });
      await ctx.reply({ embeds: [buildEmbed(`Log channel set to <#${channelId}>.`)] });
      return;
    }

    if (sub === "modrole") {
      let roleId;
      if (ctx.isInteraction) {
        roleId = ctx.source?.options?.getRole("role")?.id;
      } else {
        const raw = ctx.args?.[1];
        const match = String(raw ?? "").match(/<@&(\d+)>/);
        roleId = match?.[1] ?? raw;
      }

      if (!roleId) {
        await ctx.reply({ embeds: [buildEmbed("Please mention a valid role.")] });
        return;
      }

      await ModerationSettings.findOneAndUpdate({ guildId: ctx.guild.id }, { modRoleId: roleId }, { upsert: true });
      await ctx.reply({ embeds: [buildEmbed(`Mod role set to <@&${roleId}>.`)] });
    }
  },
};