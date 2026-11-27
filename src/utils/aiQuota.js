// Per-user AI chat quota: sliding windows so bursts can't drain the API.
import config from "../../bot.config.js";

const windows = new Map(); // userId -> number[] of consume timestamps
export const AI_MESSAGE_CHARS = config.ai.maxMessageChars;
export const AI_MINUTE_LIMIT = config.ai.perMinute;
export const AI_HOUR_LIMIT = config.ai.perHour;
export const AI_LIMIT_LABEL = `${AI_MINUTE_LIMIT}/min · ${AI_HOUR_LIMIT}/hour`;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * 60_000;
const WINDOWS = [
  { limit: AI_MINUTE_LIMIT, ms: MINUTE_MS },
  { limit: AI_HOUR_LIMIT, ms: HOUR_MS },
];
const MAX_STAMP_AGE = HOUR_MS; // prune stamps older than the longest window
const MAX_ENTRIES = 20_000;
const SWEEP_MS = 5 * 60_000;
let lastSweep = 0;

function sweep(now) {
  if (now - lastSweep < SWEEP_MS) return;
  lastSweep = now;
  for (const [id, stamps] of windows) {
    const live = stamps.filter((t) => now - t < MAX_STAMP_AGE);
    if (live.length) windows.set(id, live);
    else windows.delete(id);
  }
}

/**
 * Consume one AI message slot for a user. A request must fit every window.
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
  const stamps = (windows.get(userId) ?? []).filter((t) => now - t < MAX_STAMP_AGE);
  for (const w of WINDOWS) {
    const inWindow = stamps.filter((t) => now - t < w.ms);
    if (inWindow.length >= w.limit) {
      windows.set(userId, stamps);
      return { allowed: false, remaining: 0, retryAfterMs: inWindow[0] + w.ms - now };
    }
  }
  stamps.push(now);
  windows.set(userId, stamps);
  return { allowed: true, remaining: AI_HOUR_LIMIT - stamps.length, retryAfterMs: 0 };
}

export function formatRetryAfter(ms) {
  const totalSec = Math.ceil(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const totalMin = Math.ceil(totalSec / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
