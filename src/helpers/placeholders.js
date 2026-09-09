export function replacePlaceholders(text, { member, user, guild, channel, client, level, xp } = {}) {
  if (!text) return "";

  const resolvedUser = member?.user || user;
  const resolvedGuild = member?.guild || guild;
  const resolvedChannel = channel;

  const values = {
    user: resolvedUser ? `<@${resolvedUser.id}>` : "",
    username: resolvedUser?.username || "",
    displayname: member?.displayName || resolvedUser?.username || "",
    "user.id": resolvedUser?.id || "",
    "user.avatar": resolvedUser?.displayAvatarURL?.({ size: 128, forceStatic: true }) || "",
    "user.tag": resolvedUser?.tag || resolvedUser?.username || "",
    guild: resolvedGuild?.name || "",
    "guild.id": resolvedGuild?.id || "",
    "guild.icon": resolvedGuild?.iconURL?.({ size: 128 }) || "",
    membercount: resolvedGuild?.memberCount?.toLocaleString?.() || "",
    servercount: resolvedGuild?.memberCount?.toLocaleString?.() || "",
    boostcount: (resolvedGuild?.premiumSubscriptionCount ?? 0).toLocaleString(),
    boosts: (resolvedGuild?.premiumSubscriptionCount ?? 0).toLocaleString(),
    channel: resolvedChannel ? `<#${resolvedChannel.id}>` : "",
    "channel.id": resolvedChannel?.id || "",
    "channel.name": resolvedChannel?.name || "",
    date: new Date().toLocaleDateString(),
    time: new Date().toLocaleTimeString(),
    now: new Date().toISOString(),
    level: level != null ? String(level) : "",
    xp: xp != null ? String(xp) : "",
  };

  return String(text).replace(/{([a-zA-Z0-9._]+)}/g, (match, key) => {
    const normalized = key.toLowerCase();
    return values.hasOwnProperty(normalized) ? values[normalized] : match;
  });
}

export function replaceObjectPlaceholders(obj, ctx) {
  if (obj == null) return obj;
  if (typeof obj === "string") return replacePlaceholders(obj, ctx);
  if (typeof obj !== "object") return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => replaceObjectPlaceholders(item, ctx));
  }

  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === "type") {
      out[key] = value;
    } else if (typeof value === "string") {
      out[key] = replacePlaceholders(value, ctx);
    } else if (Array.isArray(value)) {
      out[key] = value.map((item) => replaceObjectPlaceholders(item, ctx));
    } else if (typeof value === "object" && value !== null) {
      out[key] = replaceObjectPlaceholders(value, ctx);
    } else {
      out[key] = value;
    }
  }

  return out;
}
