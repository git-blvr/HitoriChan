import { queryGroq } from "../ai/groq.js";
import { checkCooldown } from "../utils/cooldowns.js";
import { getImageURLs, buildContextMessages, trimHistory } from "../helpers/ai.js";
import { truncate } from "../helpers/format.js";
import * as MessageHistory from "../models/MessageHistory.js";
import * as AISettings from "../models/AISettings.js";

const MAX_HISTORY = 10;
const MAX_DISCORD_LENGTH = 1900;
const COOLDOWN_MS = 10_000;

function formatQuote(replied, imageURLs) {
  const quotedAuthor = replied.member?.displayName ?? replied.author.username;
  const quotedText = truncate(replied.content ?? "", 300);
  const quotedImages = getImageURLs(replied);
  imageURLs.push(...quotedImages.filter((u) => !imageURLs.includes(u)));
  const mediaNote = quotedImages.length ? ` [+ ${quotedImages.length} image(s)]` : "";
  return `[Replying to ${quotedAuthor}: "${quotedText}${mediaNote}"]`;
}

export async function handleChat(message) {
  if (!message.guild || message.author.bot) return;
  if (!message.content?.trim()) return;

  const { guild, author, channel } = message;

  const settings = await AISettings.get(guild.id);
  if (!settings?.enabled) return;

  const mention = `<@${message.client.user.id}>`;
  let shouldReply = false;
  let userMessage = message.content ?? "";
  const imageURLs = getImageURLs(message);

  if (settings.mode === "channel" && settings.channelId === channel.id) {
    shouldReply = true;
  }

  if (message.content?.includes(mention)) {
    userMessage = userMessage.replace(new RegExp(mention, "g"), "").trim();
    shouldReply = true;
  }

  if (message.reference?.messageId) {
    try {
      const replied = await channel.messages.fetch(message.reference.messageId);
      if (replied.author.id === message.client.user.id) {
        shouldReply = true;
      } else if (shouldReply) {
        userMessage = `${formatQuote(replied, imageURLs)} ${userMessage}`.trim();
      }
    } catch {
      return;
    }
  }

  if (!shouldReply) return;
  if (!userMessage && !imageURLs.length) return;

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
    const historyDoc = await MessageHistory.getOrCreate(guild.id, author.id, channel.id);
    const historyText = userMessage || (imageURLs.length ? "[sent an image]" : "[sent media]");

    historyDoc.messages.push({ role: "user", content: historyText, ts: Date.now() });
    historyDoc.messages = trimHistory(historyDoc.messages, MAX_HISTORY);
    await MessageHistory.save(historyDoc);

    const contextMessages = buildContextMessages(historyDoc.messages, userMessage, imageURLs);

    const reply = await queryGroq({
      messages: contextMessages,
      maxTokens: 1024,
      guildId: guild.id,
      userName: author.username,
    });

    historyDoc.messages.push({ role: "assistant", content: reply, ts: Date.now() });
    historyDoc.messages = trimHistory(historyDoc.messages, MAX_HISTORY);
    await MessageHistory.save(historyDoc);

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
