import { SlashCommandBuilder } from "discord.js";
import { cv2 } from "../../helpers/cv2.js";
import * as AfkStatus from "../../models/AfkStatus.js";

const COLOR = 0x57f287;

export default {
  data: new SlashCommandBuilder()
    .setName("afk")
    .setDescription("Set or clear your AFK status in this server.")
    .addStringOption((option) =>
      option.setName("message").setDescription("Why you're away (optional)")
    ),
  prefixName: "afk",
  syntax: "{prefix}afk [message]",
  example: "{prefix}afk grabbing food",
  async execute(ctx) {
    if (!ctx.guild) {
      await ctx.reply(cv2({ color: 0xff0000, description: "This command only works in a server." }));
      return;
    }

    let message = ctx.isInteraction
      ? (ctx.getOption("message") ?? "")
      : (ctx.args || []).join(" ");
    message = String(message).trim().slice(0, 200);

    const existing = AfkStatus.get(ctx.user.id, ctx.guild.id);
    if (existing && !message) {
      AfkStatus.clear(ctx.user.id, ctx.guild.id);
      await ctx.reply(cv2({ color: COLOR, title: "AFK cleared", description: "Your AFK status was removed." }));
      return;
    }

    AfkStatus.set(ctx.user.id, ctx.guild.id, message || null);
    await ctx.reply(cv2({
      color: COLOR,
      title: "You are now AFK",
      description: message ? `**${ctx.member?.displayName || ctx.user.username}** is AFK: ${message}` : `**${ctx.member?.displayName || ctx.user.username}** is AFK.`,
    }));
  },
};
