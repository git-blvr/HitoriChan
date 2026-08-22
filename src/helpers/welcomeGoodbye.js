import { cv2, buildCV2Components, findFirstCV2ImageUrl } from "./cv2.js";
import { get_dominant_color } from "../utils/color_utils.js";

function replaceMemberVars(text, member) {
  if (!text) return "";
  return text
    .replace(/\{user\}/g, `<@${member.id}>`)
    .replace(/\{username\}/g, member.user?.username || "")
    .replace(/\{displayName\}/g, member.displayName || member.user?.username || "")
    .replace(/\{guild\}/g, member.guild?.name || "");
}

function replaceComponentVars(component, member) {
  if (!component) return component;
  const out = { ...component };
  if (out.content != null) out.content = replaceMemberVars(out.content, member);
  if (out.url) out.url = replaceMemberVars(out.url, member);
  if (Array.isArray(out.urls)) out.urls = out.urls.map((u) => replaceMemberVars(u, member));
  return out;
}

export async function sendWelcomeOrGoodbye(client, member, type = "welcome") {
  const { default: GuildSettings } = await import("../models/GuildSettings.js");
  const { getOrCreate } = GuildSettings;
  const settings = await getOrCreate(member.guild.id);

  const isWelcome = type === "welcome";
  const enabled = isWelcome ? settings.welcomeEnabled : settings.goodbyeEnabled;
  if (!enabled) return;

  const channelId = isWelcome ? settings.welcomeChannelId : settings.goodbyeChannelId;
  const components = isWelcome ? (settings.welcomeComponents || []) : (settings.goodbyeComponents || []);
  const fallbackColor = isWelcome ? settings.welcomeColor : settings.goodbyeColor;
  const useDominantColor = isWelcome ? settings.welcomeUseDominantColor : settings.goodbyeUseDominantColor;

  const channel = channelId ? client?.channels?.cache?.get(channelId) : member.guild.systemChannel;
  if (!channel?.isTextBased()) return;

  const avatar = member.user?.displayAvatarURL?.({ size: 128, forceStatic: true }) ?? null;

  let color = fallbackColor;
  if (useDominantColor) {
    const imageUrl = findFirstCV2ImageUrl(components) || avatar;
    if (imageUrl) {
      try {
        color = await get_dominant_color(imageUrl);
      } catch (err) {
        console.error("[welcomeGoodbye] Dominant color error:", err.message);
      }
    }
  }
  if (color == null || isNaN(color)) color = 0x8b5cf6;

  const cv2Components = buildCV2Components(components.map((c) => replaceComponentVars(c, member)));

  const payload = cv2({
    color,
    thumbnail: avatar,
    cv2Components,
  });

  try {
    await channel.send(payload);
  } catch (err) {
    console.error(`[welcomeGoodbye] Failed to send ${type} message:`, err.message);
  }
}
