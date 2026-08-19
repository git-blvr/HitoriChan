import { SlashCommandBuilder } from "discord.js";
import { cv2 } from "../../helpers/cv2.js";
import * as StreakProfile from "../../models/StreakProfile.js";
import { toDateString, getYesterday } from "../../helpers/time.js";
import { embErr } from "../../helpers/embeds.js";
import { resolveTarget } from "../../utils/resolveTarget.js";

const COLOR = 0xf5c542;

function streakStatus(profile) {
  if (!profile || profile.currentStreak === 0) return "No active streak";
  const today = toDateString();
  const yesterday = getYesterday();
  const last = profile.lastStreakDate ? toDateString(new Date(profile.lastStreakDate)) : null;
  if (last === today) return `🔥 Active — credited today`;
  if (last === yesterday) return `⚠️ Active — message today to keep it!`;
  return `💔 Broken — last activity ${last ?? "never"}`;
}

export default {
  data: new SlashCommandBuilder()
    .setName("streak")
    .setDescription("Check your or another member's daily streak")
    .addUserOption((o) => o.setName("target").setDescription("Member to check")),
  prefixName: "streak",
  syntax: "{prefix}streak [@member]",
  example: "{prefix}streak",
  async execute(ctx) {
    const { target, refMessage } = await resolveTarget(ctx, {
      optionName: "target",
      argIndex: 0,
      fallbackToAuthor: true,
      allowReference: true,
      allowUserFallback: false,
    });

    if (!target) {
      await ctx.reply(embErr("Couldn't find that member."));
      return;
    }

    const profile = await StreakProfile.get(target.id, ctx.guild.id);

    const current = profile?.currentStreak ?? 0;
    const longest = profile?.longestStreak ?? 0;
    const total = profile?.totalDays ?? 0;
    const status = streakStatus(profile);

    await ctx.reply(cv2({
      color: COLOR,
      title: `${target.displayName}'s Streak`,
      thumbnail: target.user.displayAvatarURL(),
      fields: [
        { name: "🔥 Current Streak", value: `${current} day${current !== 1 ? "s" : ""}`, inline: true },
        { name: "🏆 Longest Streak", value: `${longest} day${longest !== 1 ? "s" : ""}`, inline: true },
        { name: "📅 Total Days",     value: `${total} day${total !== 1 ? "s" : ""}`, inline: true },
        { name: "Status", value: status },
      ],
    }), refMessage);
  },
};
