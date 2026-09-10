import { cv2 } from "../helpers/cv2.js";
import { replacePlaceholders } from "../helpers/placeholders.js";
import * as InteractionSettings from "../models/InteractionSettings.js";

export const DEFAULT_INTERACTIONS = {
  happy: { message: "{user} is happy!", requiresTarget: false },
  sad: { message: "{user} is sad...", requiresTarget: false },
  kiss: { message: "{user} kisses {target}", requiresTarget: true },
  slap: { message: "{user} slaps {target}", requiresTarget: true },
  hug: { message: "{user} hugs {target}", requiresTarget: true },
  punch: { message: "{user} punches {target}", requiresTarget: true },
  wave: { message: "{user} waves at {target}", requiresTarget: true },
  dance: { message: "{user} dances with {target}", requiresTarget: true },
  wink: { message: "{user} winks at {target}", requiresTarget: true },
  pat: { message: "{user} pats {target}", requiresTarget: true },
  cuddle: { message: "{user} cuddles {target}", requiresTarget: true },
  cry: { message: "{user} is crying...", requiresTarget: false },
  laugh: { message: "{user} laughs", requiresTarget: false },
  angry: { message: "{user} is angry!", requiresTarget: false },
};

export async function getConfig(guildId) {
  return InteractionSettings.getOrCreate(guildId);
}

export function getInteractionDefaults(type) {
  return DEFAULT_INTERACTIONS[type] || { message: `{user} ${type}s`, requiresTarget: false };
}

export async function buildInteractionPayload(type, user, target, guild) {
  const settings = await getConfig(guild?.id);
  const config = settings?.interactions?.[type] || {};
  const defaults = getInteractionDefaults(type);

  const message = config.message || defaults.message;

  let image = null;
  const images = [];
  if (config.image) images.push(config.image);
  if (Array.isArray(config.images)) images.push(...config.images.filter(Boolean));
  image = images.length ? images : null;

  const text = replacePlaceholders(message, {
    user,
    member: user,
    target: target || user,
    guild,
    channel: null,
    level: null,
    xp: null,
    quest: null,
  });

  return cv2({
    color: 0x8b5cf6,
    title: `${type[0].toUpperCase() + type.slice(1)}`,
    description: text,
    image: image || undefined,
    thumbnail: user?.displayAvatarURL?.({ size: 128 }) ?? target?.displayAvatarURL?.({ size: 128 }) ?? null,
  });
}
