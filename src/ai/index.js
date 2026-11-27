// AI provider switch — pick "gemini" | "groq" in bot.config.js (ai.provider)
// or AI_PROVIDER in .env. Auto: Gemini if GEMINI_API_KEY is set, else Groq.
import config from "../../bot.config.js";

const PROVIDER = (config.ai.provider || (process.env.GEMINI_API_KEY ? "gemini" : "groq")).toLowerCase();

const impl = PROVIDER === "groq" ? await import("./groq.js") : await import("./gemini.js");

export const activeProvider = PROVIDER;
export const buildBocchiPrompt = impl.buildBocchiPrompt;
export const summarizeHistory = impl.summarizeHistory;
export const queryAI = impl.queryGemini ?? impl.queryGroq;

console.log(`[ai] provider: ${PROVIDER}`);
