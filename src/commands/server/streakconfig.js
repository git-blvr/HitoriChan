import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { cv2 } from "../../helpers/cv2.js";
import * as StreakSettings from "../../models/StreakSettings.js";
import { embErr, embWrn } from "../../helpers/embeds.js";

const COLOR = 0xf5c542;
const SUBCOMMANDS = new Set(["toggle", "trackchannel", "notifychannel", "view"]);

function getSub(ctx) {
  const slash = ctx.source?.options?.getSubcommand?.();
  if (slash) return slash;
  const first = ctx.args?.[0]?.toLowerCase();
  return SUBCOMMANDS.has(first) ? first : null;
}

function resolveChannelId(ctx, slashOption, argIndex) {
  if (ctx.isInteraction) return ctx.source?.options?.getChannel(slashOption)?.id ?? null;
  const raw = ctx.args?.[argIndex];
  if (!raw) return null;
  const match = String(raw).match(/<#(\d+)>/);
  return match?.[1] ?? raw;
}

export default {
  data: new SlashCommandBuilder()
    .setName("streakconfig")
    .setDescription("Configure the daily streak system")
    .addSubcommand((s) =>
      s.setName("toggle").setDescription("Enable or disable the streak system")
    )
    .addSubcommand((s) =>
      s.setName("trackchannel")
        .setDescription("Set a specific channel to track (leave empty to track all)")
        .addChannelOption((o) => o.setName("channel").setDescription("Channel to track (omit to track all)"))
    )
    .addSubcommand((s) =>
      s.setName("notifychannel")
        .setDescription("Set where streak notifications are sent (leave empty for same channel)")
        .addChannelOption((o) => o.setName("channel").setDescription("Notification channel (omit for same channel)"))
    )
    .addSubcommand((s) =>
      s.setName("view").setDescription("View current streak settings")
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  prefixName: "streakconfig",
  syntax: "{prefix}streakconfig <toggle|trackchannel|notifychannel|view>",
  example: "{prefix}streakconfig toggle",
  async execute(ctx) {
    if (!ctx.member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
      await ctx.reply(embErr("You need Manage Server permission."));
      return;
    }

    const sub = getSub(ctx);
    if (!sub) {
      await ctx.reply(embWrn("Usage: `streakconfig <toggle|trackchannel|notifychannel|view>`"));
      return;
    }

    if (sub === "view") {
      const settings = await StreakSettings.getOrCreate(ctx.guild.id);
      await ctx.reply(cv2({
        color: COLOR,
        title: "Streak Settings",
        fields: [
          { name: "Status", value: settings.enabled ? "✅ Enabled" : "❌ Disabled", inline: true },
          { name: "Track Channel", value: settings.trackChannelId ? `<#${settings.trackChannelId}>` : "All channels", inline: true },
          { name: "Notify Channel", value: settings.notifyChannelId ? `<#${settings.notifyChannelId}>` : "Same channel", inline: true },
        ],
      }));
      return;
    }

    if (sub === "toggle") {
      const settings = await StreakSettings.toggle(ctx.guild.id);
      await ctx.reply(cv2({
        color: COLOR,
        description: `Streak system is now **${settings.enabled ? "enabled ✅" : "disabled ❌"}**.`,
      }));
      return;
    }

    if (sub === "trackchannel") {
      const channelId = resolveChannelId(ctx, "channel", 1);
      await StreakSettings.set(ctx.guild.id, { trackChannelId: channelId });
      await ctx.reply(cv2({
        color: COLOR,
        description: channelId ? `Streaks will now only be tracked in <#${channelId}>.` : "Streaks will now be tracked in **all channels**.",
      }));
      return;
    }

    if (sub === "notifychannel") {
      const channelId = resolveChannelId(ctx, "channel", 1);
      await StreakSettings.set(ctx.guild.id, { notifyChannelId: channelId });
      await ctx.reply(cv2({
        color: COLOR,
        description: channelId ? `Streak notifications will be sent to <#${channelId}>.` : "Streak notifications will be sent in the **same channel** as the message.",
      }));
    }
  },
};
