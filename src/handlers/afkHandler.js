import { cv2 } from "../helpers/cv2.js";
import { formatDuration } from "../helpers/time.js";
import * as AfkStatus from "../models/AfkStatus.js";

const COLOR = 0x57f287;
const MIN_AFK_MS = 15_000; // don't clear statuses younger than this (prefix command race)

export async function handleAfk(message) {
  if (!message.guild || message.author.bot) return;

  const { guild, author } = message;

  // Author returning from AFK — skip the /afk set flow itself (prefix commands
  // create the status in the same message, so only clear older statuses).
  const own = AfkStatus.get(author.id, guild.id);
  if (own && Date.now() - own.since >= MIN_AFK_MS) {
    AfkStatus.clear(author.id, guild.id);
    const away = formatDuration(Date.now() - own.since);
    await message
      .reply(cv2({
        color: COLOR,
        description: `Welcome back, **${message.member?.displayName || author.username}** — you were AFK for ${away}.`,
      }))
      .catch(() => {});
  }

  // Mentions of AFK users.
  const mentioned = [...message.mentions.users.values()].filter((u) => u.id !== author.id && !u.bot);
  if (!mentioned.length) return;
  const statuses = AfkStatus.getForUsers(guild.id, mentioned.map((u) => u.id));
  if (!statuses.size) return;

  const lines = [];
  for (const [userId, status] of statuses) {
    const name = message.mentions.users.get(userId)?.username || userId;
    const ago = formatDuration(Date.now() - status.since);
    lines.push(`**${name}** is AFK${status.message ? `: ${status.message}` : ""} — ${ago} ago`);
  }

  await message
    .reply(cv2({ color: 0xffb224, description: lines.join("\n") }))
    .catch(() => {});
}
