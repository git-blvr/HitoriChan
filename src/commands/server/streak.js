import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import StreakProfile from "../../models/StreakProfile.js";

const COLOR = 0xf5c542;

function toDateString(date) {
  return date.toISOString().split("T")[0];
}

function streakStatus(profile) {
  if (!profile || profile.currentStreak === 0) return "No active streak";
  const today = toDateString(new Date());
  const yesterday = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return toDateString(d);
  })();
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
    let target = ctx.member;
    if (ctx.isInteraction) {
      const user = ctx.source?.options?.getUser("target");
      if (user) target = await ctx.guild.members.fetch(user.id).catch(() => null);
    } else if (ctx.args?.[0]) {
      const match = String(ctx.args[0]).match(/<@!?(\d+)>/);
      const id = match?.[1] ?? ctx.args[0];
      target = await ctx.guild.members.fetch(id).catch(() => null);
    }

    if (!target) {
      await ctx.reply({ embeds: [new EmbedBuilder().setColor(COLOR).setDescription("Couldn't find that member.")] });
      return;
    }

    const profile = await StreakProfile.findOne({ userId: target.id, guildId: ctx.guild.id });

    const current = profile?.currentStreak ?? 0;
    const longest = profile?.longestStreak ?? 0;
    const total = profile?.totalDays ?? 0;
    const status = streakStatus(profile);

    await ctx.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLOR)
          .setAuthor({ name: `${target.displayName}'s Streak`, iconURL: target.user.displayAvatarURL() })
          .addFields(
            { name: "🔥 Current Streak", value: `${current} day${current !== 1 ? "s" : ""}`, inline: true },
            { name: "🏆 Longest Streak", value: `${longest} day${longest !== 1 ? "s" : ""}`, inline: true },
            { name: "📅 Total Days",     value: `${total} day${total !== 1 ? "s" : ""}`, inline: true },
            { name: "Status", value: status },
          ),
      ],
    });
  },
};