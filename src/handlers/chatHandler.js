import { queryGroq } from "../ai/groq.js";
import { checkCooldown } from "../utils/cooldowns.js";
import MessageHistory from "../models/MessageHistory.js";
import AISettings from "../models/AISettings.js";

const MAX_HISTORY        = 10;
const MAX_DISCORD_LENGTH = 1900;
const COOLDOWN_MS        = 10_000;

function getImageURLs(msg) {
  const urls = [];
  for (const a of msg.attachments.values()) {
    if (a.contentType?.startsWith("image/") || a.url.endsWith(".gif")) urls.push(a.url);
  }
  for (const e of msg.embeds) {
    for (const url of [e.image?.url, e.thumbnail?.url].filter(Boolean)) {
      if (!urls.includes(url)) urls.push(url);
    }
  }
  return urls;
}

function buildUserContent(text, imageURLs = []) {
  if (!imageURLs.length) return text || "[sent media]";
  const parts = [];
  if (text) parts.push({ type: "text", text });
  for (const url of imageURLs) parts.push({ type: "image_url", image_url: { url } });
  return parts;
}

function trimHistory(messages) {
  return messages.length > MAX_HISTORY ? messages.slice(-MAX_HISTORY) : messages;
}

export async function handleChat(message) {
  if (!message.guild || message.author.bot) return;
  if (!message.content?.trim()) return;

  const { guild, author, channel } = message;

  const settings = await AISettings.findOne({ guildId: guild.id });
  if (!settings?.enabled) return;

  const mention = `<@${message.client.user.id}>`;
  let shouldReply = false;
  let userMessage = message.content ?? "";
  let imageURLs = getImageURLs(message);

  // Channel mode — auto-reply to everything in the configured channel
  if (settings.mode === "channel" && settings.channelId === channel.id) {
    shouldReply = true;
  }

  // Mention trigger (works in both modes)
  if (message.content?.includes(mention)) {
    userMessage = userMessage.replace(new RegExp(mention, "g"), "").trim();
    shouldReply = true;
  }

  // Reply to bot trigger
  if (message.reference?.messageId) {
    try {
      const replied = await channel.messages.fetch(message.reference.messageId);
      if (replied.author.id === message.client.user.id) {
        shouldReply = true;
      } else if (shouldReply) {
        const quotedAuthor = replied.member?.displayName ?? replied.author.username;
        const quotedText = replied.content?.slice(0, 300) ?? "";
        const quotedImages = getImageURLs(replied);
        imageURLs = [...imageURLs, ...quotedImages];
        const mediaNote = quotedImages.length ? ` [+ ${quotedImages.length} image(s)]` : "";
        userMessage = `[Replying to ${quotedAuthor}: "${quotedText}${mediaNote}"] ${userMessage}`.trim();
      }
    } catch {
      return;
    }
  }

  if (!shouldReply) return;
  if (!userMessage && !imageURLs.length) return;

  // Cooldown — boosters get half
  const isBoosting = !!message.member?.premiumSince;
  const cooldown = checkCooldown(author.id, "chat", COOLDOWN_MS, isBoosting);
  if (cooldown > 0) {
    await message.reply(`⏳ **${cooldown}s** cooldown remaining.${isBoosting ? " ✨" : ""}`);
    return;
  }

  const typingInterval = (() => {
    channel.sendTyping().catch(() => {});
    return setInterval(() => channel.sendTyping().catch(() => {}), 8000);
  })();

  try {
    const historyDoc = await MessageHistory.findOneAndUpdate(
      { userId: author.id, guildId: guild.id, channelId: channel.id },
      {},
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
    );

    const historyText = userMessage || (imageURLs.length ? "[sent an image]" : "[sent media]");
    historyDoc.messages.push({ role: "user", content: historyText });
    historyDoc.messages = trimHistory(historyDoc.messages);
    await historyDoc.save();

    const contextMessages = [
      ...historyDoc.messages.slice(0, -1).map(({ role, content }) => ({ role, content })),
      { role: "user", content: buildUserContent(userMessage, imageURLs) },
    ];

    const reply = await queryGroq(contextMessages);

    historyDoc.messages.push({ role: "assistant", content: reply });
    historyDoc.messages = trimHistory(historyDoc.messages);
    historyDoc.updatedAt = new Date();
    await historyDoc.save();

    const safeReply = reply.length > MAX_DISCORD_LENGTH
      ? reply.slice(0, MAX_DISCORD_LENGTH) + "...\n-# *(truncated)*"
      : reply;

    await message.reply(safeReply);
  } catch (err) {
    console.error("Chat handler error:", err);
    await message.reply("❌ Something went wrong. Please try again later.");
  } finally {
    clearInterval(typingInterval);
  }
}