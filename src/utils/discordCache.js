const cache = new Map();
const DEFAULT_TTL_MS = 30_000;
const MAX_ENTRIES = 300;
let lastSweep = 0;
const SWEEP_MS = 30_000;

function key(parts) {
  return Array.isArray(parts) ? parts.join(":") : String(parts);
}

function sweep(now) {
  if (now - lastSweep < SWEEP_MS) return;
  lastSweep = now;
  for (const [k, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(k);
  }
}

function getOrSet(parts, factory, ttlMs = DEFAULT_TTL_MS) {
  const k = key(parts);
  const now = Date.now();
  sweep(now);
  const hit = cache.get(k);
  if (hit && hit.expiresAt > now) {
    return hit.value;
  }
  if (hit) cache.delete(k); // drop the stale copy so it can't linger
  if (cache.size >= MAX_ENTRIES) {
    // Bound memory: member collections can be megabytes each.
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  const value = factory();
  if (value && typeof value.then === "function") {
    return value.then((resolved) => {
      cache.set(k, { value: resolved, expiresAt: Date.now() + ttlMs });
      return resolved;
    });
  }
  cache.set(k, { value, expiresAt: now + ttlMs });
  return value;
}

export async function fetchGuildMembers(guild, { query = "", limit = 100 } = {}) {
  const cacheKey = ["members", guild.id, query.toLowerCase(), limit];
  return getOrSet(cacheKey, async () => {
    try {
      if (query) {
        return await guild.members.fetch({ query, limit: Math.min(limit, 100) });
      }
      if (guild.memberCount <= limit) {
        return await guild.members.fetch({ limit });
      }
      return guild.members.cache;
    } catch (err) {
      console.error(`[discordCache] fetch members for ${guild.id} failed:`, err.message);
      return guild.members.cache;
    }
  });
}

export async function fetchGuildRoles(guild) {
  return getOrSet(["roles", guild.id], () => Promise.resolve(guild.roles.cache));
}

export async function fetchGuildChannels(guild) {
  return getOrSet(["channels", guild.id], () => Promise.resolve(guild.channels.cache));
}

export function invalidateGuild(guildId) {
  for (const k of cache.keys()) {
    if (k.startsWith(`${guildId}:`) || k.includes(`:${guildId}:`)) {
      cache.delete(k);
    }
  }
}
