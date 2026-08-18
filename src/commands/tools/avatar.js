import { SlashCommandBuilder } from "discord.js";
import { cv2 } from "../../helpers/cv2.js";
import { embErr } from "../../helpers/embeds.js";
import { extractImageColor } from "../../utils/image_color.js";

const DEFAULT_ACCENT = 0x5865f2;

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
    const target = await resolveTarget(ctx, raw);

    const displayName = target.displayName ?? target.globalName ?? target.username;
    const avatarUrl = target.displayAvatarURL({
      size: 512,
      extension: "png",
      forceStatic: true,
    });

    try {
      const accent = await extractImageColor(avatarUrl).catch(() => null);
      const finalAccent = accent ?? target.user?.accentColor ?? target.accentColor ?? DEFAULT_ACCENT;

      await ctx.reply(
        cv2({
          color: finalAccent,
          title: `Avatar of ${displayName}`,
          image: { url: avatarUrl },
        })
      );
    } catch (error) {
      console.error("Avatar command error:", error);
      await ctx.reply(embErr("Could not load that avatar. Please try again later."));
    }
  },
};

async function resolveTarget(ctx, raw) {
  if (!raw) return ctx.user;

  let id;
  if (ctx.isInteraction) {
    id = raw;
  } else {
    const mention = String(raw).match(/^<@!?(\d+)>$/);
    id = mention ? mention[1] : raw;
  }

  if (!/^\d{17,20}$/.test(id)) return ctx.user;

  try {
    if (ctx.guild) {
      const member = await ctx.guild.members.fetch(id);
      return member;
    }
  } catch {
    // fall through to global user fetch
  }

  try {
    return await ctx.client.users.fetch(id);
  } catch {
    return ctx.user;
  }
}
