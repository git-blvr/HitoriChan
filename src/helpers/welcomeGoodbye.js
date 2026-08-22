import { cv2 } from "./cv2.js";
import { get_dominant_color } from "../utils/color_utils.js";

function replaceMemberVars(text, member) {
  if (!text) return "";
  return text
    .replace(/\{user\}/g, `<@${member.id}>`)
    .replace(/\{username\}/g, member.user?.username || "")
    .replace(/\{displayName\}/g, member.displayName || member.user?.username || "")
    .replace(/\{guild\}/g, member.guild?.name || "");
}

export async function sendWelcomeOrGoodbye(client, member, type = "welcome") {
  const { default: GuildSettings } = await import("../models/GuildSettings.js");
  const { getOrCreate } = GuildSettings;
  const settings = await getOrCreate(member.guild.id);

  const isWelcome = type === "welcome";
  const enabled = isWelcome ? settings.welcomeEnabled : settings.goodbyeEnabled;
  if (!enabled) return;

  const channelId = isWelcome ? settings.welcomeChannelId : settings.goodbyeChannelId;
  const title = isWelcome ? settings.welcomeTitle : settings.goodbyeTitle;
  const description = isWelcome ? settings.welcomeDescription : settings.goodbyeDescription;
  const fallbackColor = isWelcome ? settings.welcomeColor : settings.goodbyeColor;
  const useDominantColor = isWelcome ? settings.welcomeUseDominantColor : settings.goodbyeUseDominantColor;

  const channel = channelId ? client?.channels?.cache?.get(channelId) : member.guild.systemChannel;
  if (!channel?.isTextBased()) return;

  const avatar = member.user?.displayAvatarURL?.({ size: 128, forceStatic: true }) ?? null;

  let color = fallbackColor;
  if (useDominantColor && avatar) {
    try {
      color = await get_dominant_color(avatar);
    } catch (err) {
      console.error("[welcomeGoodbye] Dominant color error:", err.message);
    }
  }
  if (color == null || isNaN(color)) color = 0x8b5cf6;

  const payload = cv2({
    color,
    title: replaceMemberVars(title, member),
    description: replaceMemberVars(description, member),
    thumbnail: avatar,
  });

  try {
    await channel.send(payload);
  } catch (err) {
    console.error(`[welcomeGoodbye] Failed to send ${type} message:`, err.message);
  }
}
