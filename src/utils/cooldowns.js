const cooldowns = new Map();

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
  const last = cooldowns.get(id) ?? 0;
  const remaining = effectiveMs - (now - last);
  if (remaining > 0) return Math.ceil(remaining / 1000);
  cooldowns.set(id, now);
  return 0;
}

export function clearCooldown(userId, key) {
  cooldowns.delete(`${userId}:${key}`);
}