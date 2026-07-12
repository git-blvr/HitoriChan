import { EmbedBuilder } from "discord.js";
import StreakProfile from "../models/StreakProfile.js";
import StreakSettings from "../models/StreakSettings.js";
import EconomyProfile from "../models/EconomyProfile.js";

const MILESTONES = new Set([3, 7, 14, 30, 60, 100, 200, 365]);

const MILESTONE_MESSAGES = {
  3:   "You're on a roll!",
  7:   "A whole week — impressive!",
  14:  "Two weeks strong, keep it up!",
  30:  "A month of dedication!",
  60:  "Two months? You're unstoppable!",
  100: "100 days! Legendary.",
  200: "200 days. Absolutely unreal.",
  365: "A FULL YEAR. You're a legend.",
};

const STREAK_BASE_FOLTS      = 1_000;
const MSG_FOLT_PER_MESSAGE   = 100;
const MSG_FOLT_CAP_MESSAGES  = 1_000;
const MSG_FOLT_MAX_BONUS     = MSG_FOLT_PER_MESSAGE * MSG_FOLT_CAP_MESSAGES; // 100,000

function toDateString(date) {
  return date.toISOString().split("T")[0];
}

function getYesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return toDateString(d);
}

async function awardFolts(userId, guildId, amount) {
  await EconomyProfile.findOneAndUpdate(
    { userId, guildId },
    { $inc: { folts: amount } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

function buildStreakEmbed(member, streak, isMilestone, wasReset, foltBonus) {
  const color = isMilestone ? 0xf5c542 : wasReset ? 0x5865f2 : 0xff6b6b;

  const title = isMilestone
    ? `🎉 ${streak}-Day Streak Milestone!`
    : wasReset
    ? `🔥 Streak Started!`
    : `🔥 Day ${streak} Streak!`;

  const lines = [
    `**${member.displayName}** ${wasReset ? "started a new streak!" : `is on a **${streak}-day** streak!`}`,
    ``,
    `🎰 +**${STREAK_BASE_FOLTS.toLocaleString()} £T** streak bonus`,
    foltBonus > 0 ? `📨 +**${foltBonus.toLocaleString()} £T** message bonus` : null,
    ``,
    isMilestone ? `✨ ${MILESTONE_MESSAGES[streak] ?? "Amazing milestone!"}` : null,
    !wasReset ? `-# Keep messaging daily to maintain your streak!` : null,
  ].filter((l) => l !== null).join("\n");

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(lines)
    .setThumbnail(member.user.displayAvatarURL())
    .setFooter({ text: `Longest streak: ${Math.max(streak, 0)} days` });
}

function buildCapEmbed(member) {
  return new EmbedBuilder()
    .setColor(0xf5c542)
    .setTitle("📨 Daily Message Cap Reached!")
    .setDescription(
      `**${member.displayName}** sent **${MSG_FOLT_CAP_MESSAGES.toLocaleString()} messages** today!\n\n` +
      `🎰 +**${MSG_FOLT_MAX_BONUS.toLocaleString()} £T** total message bonus earned.\n` +
      `-# You've hit the daily cap — no more bonus £T until tomorrow.`
    )
    .setThumbnail(member.user.displayAvatarURL());
}

export async function handleStreak(message) {
  if (!message.guild || message.author.bot) return;

  const { guild, author, channel } = message;

  const settings = await StreakSettings.findOne({ guildId: guild.id });
  if (!settings?.enabled) return;

  if (settings.trackChannelId && channel.id !== settings.trackChannelId) return;

  const today = toDateString(new Date());
  const yesterday = getYesterday();

  let profile = await StreakProfile.findOne({ userId: author.id, guildId: guild.id });
  if (!profile) {
    profile = new StreakProfile({ userId: author.id, guildId: guild.id });
  }

  const member = await guild.members.fetch(author.id).catch(() => null);
  if (!member) return;

  const notifyChannel = settings.notifyChannelId
    ? await guild.channels.fetch(settings.notifyChannelId).catch(() => null)
    : channel;

  // ── Per-message FOLT bonus ─────────────────────────────────────────────────
  if (profile.dailyMessageDate !== today) {
    profile.dailyMessageCount = 0;
    profile.dailyMessageDate = today;
  }

  const alreadyCapped = profile.dailyMessageCount >= MSG_FOLT_CAP_MESSAGES;

  if (!alreadyCapped) {
    profile.dailyMessageCount += 1;
    await awardFolts(author.id, guild.id, MSG_FOLT_PER_MESSAGE);

    if (profile.dailyMessageCount === MSG_FOLT_CAP_MESSAGES) {
      if (notifyChannel?.isTextBased()) {
        await notifyChannel.send({ embeds: [buildCapEmbed(member)] }).catch(() => {});
      }
    }
  }

  // ── Daily streak credit ────────────────────────────────────────────────────
  const lastDate = profile.lastStreakDate ? toDateString(new Date(profile.lastStreakDate)) : null;

  if (lastDate !== today) {
    const wasReset = lastDate !== yesterday && lastDate !== null;
    profile.currentStreak = wasReset ? 1 : profile.currentStreak + 1;
    profile.longestStreak = Math.max(profile.longestStreak, profile.currentStreak);
    profile.lastStreakDate = new Date();
    profile.totalDays += 1;

    const foltBonus = Math.min(profile.dailyMessageCount, MSG_FOLT_CAP_MESSAGES) * MSG_FOLT_PER_MESSAGE;
    await awardFolts(author.id, guild.id, STREAK_BASE_FOLTS);

    const isMilestone = MILESTONES.has(profile.currentStreak);
    const embed = buildStreakEmbed(member, profile.currentStreak, isMilestone, wasReset && profile.currentStreak === 1, foltBonus);

    if (notifyChannel?.isTextBased()) {
      await notifyChannel.send({ embeds: [embed] }).catch(() => {});
    }
  }

  await profile.save();
}