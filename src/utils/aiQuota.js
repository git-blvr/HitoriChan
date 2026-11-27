// Per-user AI chat quota: sliding window so bursts can't drain the API.
const windows = new Map(); // userId -> number[] of consume timestamps
export const AI_MESSAGE_LIMIT = 5;
export const AI_WINDOW_MS = 4 * 60 * 60 * 1000;
export const AI_MESSAGE_CHARS = 128;
const MAX_ENTRIES = 20_000;
const SWEEP_MS = 5 * 60 * 1000;
let lastSweep = 0;

function sweep(now) {
  if (now - lastSweep < SWEEP_MS) return;
  lastSweep = now;
  for (const [id, stamps] of windows) {
    const live = stamps.filter((t) => now - t < AI_WINDOW_MS);
    if (live.length) windows.set(id, live);
    else windows.delete(id);
  }
}

/**
 * Consume one AI message slot for a user.
 * @returns {{ allowed: boolean, remaining: number, retryAfterMs: number }}
 */
export function consumeAIQuota(userId) {
  const now = Date.now();
  sweep(now);
  if (windows.size >= MAX_ENTRIES && !windows.has(userId)) {
    let dropped = 0;
    for (const k of windows.keys()) {
      windows.delete(k);
      if (++dropped >= MAX_ENTRIES / 4) break;
    }
  }
  const stamps = (windows.get(userId) ?? []).filter((t) => now - t < AI_WINDOW_MS);
  if (stamps.length >= AI_MESSAGE_LIMIT) {
    windows.set(userId, stamps);
    return { allowed: false, remaining: 0, retryAfterMs: stamps[0] + AI_WINDOW_MS - now };
  }
  stamps.push(now);
  windows.set(userId, stamps);
  return { allowed: true, remaining: AI_MESSAGE_LIMIT - stamps.length, retryAfterMs: 0 };
}

export function formatRetryAfter(ms) {
  const totalMin = Math.ceil(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
