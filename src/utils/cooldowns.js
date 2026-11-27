const cooldowns = new Map();
const MAX_ENTRIES = 10_000;
let lastSweep = 0;
const SWEEP_MS = 60_000;

// Entries store their own expiry so stale rows can be evicted lazily.
// Without this the map grew forever on a busy bot.
function sweep(now) {
  if (now - lastSweep < SWEEP_MS) return;
  lastSweep = now;
  for (const [id, expiresAt] of cooldowns) {
    if (expiresAt <= now) cooldowns.delete(id);
  }
}

/**
 * @param {string} userId
 * @param {string} key
 * @param {number} ms - base cooldown in milliseconds
 * @param {boolean} [isBoosting] - if true, cooldown is halved
 * @returns {number} seconds remaining (0 = allowed)
 */
export function checkCooldown(userId, key, ms, isBoosting = false) {
  const effectiveMs = isBoosting ? Math.floor(ms / 2) : ms;
  const id = `${userId}:${key}`;
  const now = Date.now();
  sweep(now);
  const expiresAt = cooldowns.get(id) ?? 0;
  const remaining = expiresAt - now;
  if (remaining > 0) return Math.ceil(remaining / 1000);
  if (cooldowns.size >= MAX_ENTRIES) {
    // Emergency bound: drop the oldest quarter rather than grow without limit.
    let dropped = 0;
    for (const k of cooldowns.keys()) {
      cooldowns.delete(k);
      if (++dropped >= MAX_ENTRIES / 4) break;
    }
  }
  cooldowns.set(id, now + effectiveMs);
  return 0;
}

export function clearCooldown(userId, key) {
  // Entries may be stored under either shape; delete both to be safe.
  cooldowns.delete(`${userId}:${key}`);
}
