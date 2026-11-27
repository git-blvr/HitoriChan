// ─────────────────────────────────────────────────────────────────────────────
// HitoriChan — central dev config
//
// One place for every tunable. Secrets (tokens, API keys) stay in .env.
// Values marked "env:" are overridden by that env var when it is set —
// remove the env line from .env if you want this file to be the source of truth.
// ─────────────────────────────────────────────────────────────────────────────

export default {
  ai: {
    // "gemini" | "groq" | null (null = auto: gemini if its key exists, else groq)
    provider: process.env.AI_PROVIDER || null,
    geminiModel: process.env.GEMINI_MODEL || "gemini-3.6-flash",
    groqModel: process.env.GROQ_MODEL || "qwen/qwen3.8-27b",

    // Chat rate limits — per user, sliding windows
    perMinute: 4,
    perHour: 30,
    maxMessageChars: 128,

    cooldownMs: 10_000,            // base cooldown between AI chat messages (boosters get half)
    historyMessages: 10,           // turns of context kept per user+channel
    maxTokens: 1024,               // reply length budget
    temperature: 0.85,
  },

  ask: {
    costFolts: 750,                // secondary-currency cost per /ask
    cooldownMs: 5 * 60_000,
    maxTokens: 512,
  },

  // discord.js cache bounds — the idle-RAM knobs
  cache: {
    users: 500,
    members: 250,                  // bot member always stays cached
    voiceStates: 250,
    userSweepIntervalMs: 900_000,
    memberSweepIntervalMs: 900_000,
    messageSweepLifetimeMs: 300_000,
  },

  games: {
    maxSessions: 250,              // hard cap on concurrent game sessions
    sweepIntervalMs: 5_000,
    defaultTtlMs: 10 * 60_000,
  },
};
