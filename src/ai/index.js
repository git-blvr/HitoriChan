// AI provider switch — set AI_PROVIDER=gemini|groq in .env to pick.
// Unset: Gemini wins if GEMINI_API_KEY is set, else Groq if GROQ_API is set.
const PROVIDER = (process.env.AI_PROVIDER || (process.env.GEMINI_API_KEY ? "gemini" : "groq")).toLowerCase();

const impl = PROVIDER === "groq" ? await import("./groq.js") : await import("./gemini.js");

export const activeProvider = PROVIDER;
export const buildBocchiPrompt = impl.buildBocchiPrompt;
export const summarizeHistory = impl.summarizeHistory;
export const queryAI = impl.queryGemini ?? impl.queryGroq;

console.log(`[ai] provider: ${PROVIDER}`);
