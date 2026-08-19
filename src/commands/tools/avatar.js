import { SlashCommandBuilder } from "discord.js";
import { cv2 } from "../../helpers/cv2.js";
import { embErr } from "../../helpers/embeds.js";
import { get_dominant_color } from "../../utils/color_utils.js";

export default {
  data: new SlashCommandBuilder()
    .setName("avatar")
    .setDescription("Show a member's avatar.")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("The member to show (defaults to you)")
        .setRequired(false)
    ),
  prefixName: "avatar",
  aliases: ["av"],
  triggers: ["av"],
  syntax: "{prefix}avatar [@user]",
  example: "{prefix}avatar @someone",
  async execute(ctx) {
    const raw = ctx.getOption("user", 0);
    const { target, refMessage } = await resolveTarget(ctx, raw);

    const displayName = target.displayName ?? target.globalName ?? target.username;
    const avatarUrl = target.displayAvatarURL({
      size: 512,
      extension: "png",
      forceStatic: true,
    });

    try {
      const accent = await get_dominant_color(avatarUrl);

      const payload = cv2({
        color: accent,
        title: `Avatar of ${displayName}`,
        image: { url: avatarUrl },
      });

      if (!ctx.isInteraction) {
        payload.allowedMentions = { repliedUser: false };
      }

      if (refMessage && !ctx.isInteraction) {
        await refMessage.reply(payload);
      } else {
        await ctx.reply(payload);
      }
    } catch (error) {
      console.error("Avatar command error:", error);
      await ctx.reply(embErr("Could not load that avatar. Please try again later."));
    }
  },
};

async function resolveTarget(ctx, raw) {
  if (!raw && !ctx.isInteraction && ctx.reference?.messageId) {
    try {
      const refMessage = await ctx.channel.messages.fetch(ctx.reference.messageId);
      return { target: refMessage.author, refMessage };
    } catch {
      return { target: ctx.user, refMessage: null };
    }
  }

  if (!raw) return { target: ctx.user, refMessage: null };

  let id;
  if (ctx.isInteraction) {
    id = raw;
  } else {
    const mention = String(raw).match(/^<@!?(\d+)>$/);
    id = mention ? mention[1] : raw;
  }

  if (!/^\d{17,20}$/.test(id)) return { target: ctx.user, refMessage: null };

  try {
    if (ctx.guild) {
      const member = await ctx.guild.members.fetch(id);
      return { target: member, refMessage: null };
    }
  } catch {
    // fall through to global user fetch
  }

  try {
    return { target: await ctx.client.users.fetch(id), refMessage: null };
  } catch {
    return { target: ctx.user, refMessage: null };
  }
}
