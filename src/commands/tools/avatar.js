import { SlashCommandBuilder } from "discord.js";
import { cv2 } from "../../helpers/cv2.js";
import { embErr } from "../../helpers/embeds.js";
import { get_dominant_color } from "../../utils/color_utils.js";
import { resolveTarget } from "../../utils/resolveTarget.js";

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
    const { target, refMessage } = await resolveTarget(ctx, {
      optionName: "user",
      argIndex: 0,
      fallbackToAuthor: true,
      allowReference: true,
      allowUserFallback: true,
    });

    if (!target) {
      await ctx.reply(embErr("Could not find that user."));
      return;
    }

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
