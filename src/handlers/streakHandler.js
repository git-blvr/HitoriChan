import { cv2 } from "../helpers/cv2.js";
import * as StreakProfile from "../models/StreakProfile.js";
import * as StreakSettings from "../models/StreakSettings.js";
import * as EconomyAccount from "../models/EconomyAccount.js";
import { toDateString, getYesterday } from "../helpers/time.js";

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
const MSG_FOLT_MAX_BONUS     = MSG_FOLT_PER_MESSAGE * MSG_FOLT_CAP_MESSAGES;

async function awardFolts(userId, guildId, amount) {
  await EconomyAccount.adjust(guildId, userId, "secondary", amount);
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

  return cv2({
    color,
    title,
    description: lines,
    thumbnail: member.user.displayAvatarURL(),
    footer: { text: `Longest streak: ${Math.max(streak, 0)} days` },
  });
}

function buildCapEmbed(member) {
  return cv2({
    color: 0xf5c542,
    title: "📨 Daily Message Cap Reached!",
    description:
      `**${member.displayName}** sent **${MSG_FOLT_CAP_MESSAGES.toLocaleString()} messages** today!\n\n` +
      `🎰 +**${MSG_FOLT_MAX_BONUS.toLocaleString()} £T** total message bonus earned.\n` +
      `-# You've hit the daily cap — no more bonus £T until tomorrow.`,
    thumbnail: member.user.displayAvatarURL(),
  });
}

export async function handleStreak(message) {
  if (!message.guild || message.author.bot) return;

  const { guild, author, channel } = message;

  const settings = await StreakSettings.get(guild.id);
  if (!settings?.enabled) return;

  if (settings.trackChannelId && channel.id !== settings.trackChannelId) return;

  const today = toDateString();
  const yesterday = getYesterday();

  const profile = await StreakProfile.getOrCreate(author.id, guild.id);

  const member = await guild.members.fetch(author.id).catch(() => null);
  if (!member) return;

  const notifyChannel = settings.notifyChannelId
    ? await guild.channels.fetch(settings.notifyChannelId).catch(() => null)
    : channel;

  if (profile.dailyMessageDate !== today) {
    profile.dailyMessageCount = 0;
    profile.dailyMessageDate = today;
    await StreakProfile.save(profile);
  }

  const alreadyCapped = profile.dailyMessageCount >= MSG_FOLT_CAP_MESSAGES;

  if (!alreadyCapped) {
    profile.dailyMessageCount += 1;
    await awardFolts(author.id, guild.id, MSG_FOLT_PER_MESSAGE);
    await StreakProfile.save(profile);

    if (profile.dailyMessageCount === MSG_FOLT_CAP_MESSAGES) {
      if (notifyChannel?.isTextBased()) {
        await notifyChannel.send(buildCapEmbed(member)).catch(() => {});
      }
    }
  }

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
      await notifyChannel.send(embed).catch(() => {});
    }

    await StreakProfile.save(profile);
  }
}
