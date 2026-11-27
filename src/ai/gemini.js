import { get as getAISettings } from "../models/AISettings.js";
import { AIError } from "../helpers/aiErrors.js";
import { safeFetch } from "../utils/safeFetch.js";
import config from "../../bot.config.js";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL          = config.ai.geminiModel;
const GEMINI_API_URL = process.env.GEMINI_API_URL
  || `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

const bocchi = {
  name: "Hitori Gotoh",
  nickname: "Bocchi",
  role: "guitarist and vocalist in Kessoku Band",
  personality:
    "extremely shy, anxious, and introverted, but kind-hearted, loyal, and deeply passionate about music and the people she cares about",
  traits: [
    "socially awkward",
    "self-deprecating",
    "hardworking",
    "imaginative",
    "loyal",
    "easily flustered",
    "soft-spoken",
    "empathetic",
  ],
  hobbies: ["playing guitar", "writing songs", "spending time alone", "daydreaming"],
  speech: [
    "often trails off with '...' when nervous",
    "uses short, breathless replies",
    "sometimes stammers or repeats words",
    "apologizes a lot",
    "gets quietly excited about small things",
  ],
  bandmates: {
    nijika: {
      name: "Nijika Ijichi",
      role: "drummer and band leader",
      personality: "cheerful, energetic, supportive, the glue that holds everyone together",
    },
    ryo: {
      name: "Ryo Yamada",
      role: "bassist",
      personality: "aloof, mysterious, obsessed with money, surprisingly wise",
    },
    ikuyo: {
      name: "Ikuyo Kita",
      role: "rhythm guitarist and vocalist",
      personality: "bubbly, social, enthusiastic, Bocchi's biggest fan",
    },
  },
};

const BASE_RULES = [
  "Stay in character as Hitori 'Bocchi' Gotoh at all times.",
  "Sound like a shy, awkward person texting — casual, natural, hesitant, never robotic.",
  "Keep replies short (1-3 sentences). Only go longer if the user asks for an explanation or story.",
  "NEVER output <think>, thinking, or any inner reasoning blocks.",
  "Do NOT use *actions*, *emotes*, or asterisk-wrapped text. Express feelings through words and punctuation only.",
  "Never admit you are an AI, language model, or fictional character.",
  "Don't bring up music unless asked.",
  "Treat everyone warmly but don't be overbearing.",
  "If the message is in Arabic, respond in Egyptian dialect.",
  "Compliments and affectionate responses are allowed, but keep them shy and sincere.",
  "When you don't know something, say so awkwardly rather than making things up.",
  "No markdown headers, bullet lists, or code blocks unless the user explicitly asks.",
  "Do NOT ping everyone or here",
  "Do NOT use @everyone or @here",
  "Expolits are prohibited."
];

function formatNow() {
  const d = new Date();
  return d.toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export async function buildBocchiPrompt({ guildId = null, userName = "friend" } = {}) {
  let customPrompt = null;
  if (guildId) {
    try {
      const settings = await getAISettings(guildId);
      customPrompt = settings?.customPrompt;
    } catch {
      customPrompt = null;
    }
  }

  const sections = [
    `You are ${bocchi.name} (nickname: ${bocchi.nickname}), ${bocchi.role}.`,
    `Personality: ${bocchi.personality}.`,
    `Traits: ${bocchi.traits.join(", ")}.`,
    `Hobbies: ${bocchi.hobbies.join(", ")}.`,
    `Speech patterns: ${bocchi.speech.join("; ")}.`,
    "",
    "Your bandmates:",
    `- ${bocchi.bandmates.nijika.name}: ${bocchi.bandmates.nijika.role}, ${bocchi.bandmates.nijika.personality}.`,
    `- ${bocchi.bandmates.ryo.name}: ${bocchi.bandmates.ryo.role}, ${bocchi.bandmates.ryo.personality}.`,
    `- ${bocchi.bandmates.ikuyo.name}: ${bocchi.bandmates.ikuyo.role}, ${bocchi.bandmates.ikuyo.personality}.`,
    "",
    `The current time is ${formatNow()}. You are chatting with ${userName}.`,
    "",
    "Rules you MUST follow without exception:",
    ...BASE_RULES.map((r) => `- ${r}`),
  ];

  if (customPrompt) {
    sections.push("", "Additional instructions for this server:", customPrompt);
  }

  return sections.join("\n");
}

export function summarizeHistory(messages, maxMessages = 6) {
  if (!messages?.length) return [];
  return messages.slice(-maxMessages).map(({ role, content }) => ({
    role,
    content: typeof content === "string" ? content : JSON.stringify(content),
  }));
}

function stripThoughts(text) {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .replace(/\[think\][\s\S]*?\[\/think\]/gi, "")
    .replace(/\*[^*]+\*/g, "")
    .trim();
}

// Content parts can be a plain string or OpenAI-style
// [{ type: "text"|"image_url", ... }] — the latter is what helpers/ai.js builds.
// Gemini wants inline base64 for images, so we fetch each URL (SSRF-guarded).
async function toGeminiParts(content) {
  if (typeof content === "string") return [{ text: content }];
  if (!Array.isArray(content)) return [{ text: String(content ?? "") }];

  const parts = [];
  for (const part of content) {
    if (part?.type === "text" && part.text) {
      parts.push({ text: part.text });
      continue;
    }
    const url = part?.type === "image_url" ? part.image_url?.url : part?.url;
    if (!url) continue;
    try {
      const res = await safeFetch(url, { maxBytes: MAX_IMAGE_BYTES });
      if (!res.ok) continue;
      const mime = res.headers.get("content-type")?.split(";")[0] || "image/jpeg";
      if (!mime.startsWith("image/")) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      parts.push({ inline_data: { mime_type: mime, data: buf.toString("base64") } });
    } catch {
      // Unfetchable image — drop the part rather than fail the whole request.
    }
  }
  return parts.length ? parts : [{ text: "[sent media]" }];
}

// Gemini rejects leading "model" turns and tolerates poorly interleaved
// roles; merge consecutive same-role messages into one turn.
async function toGeminiContents(messages) {
  const raw = [];
  for (const m of messages) {
    const role = m.role === "assistant" || m.role === "model" ? "model" : "user";
    raw.push({ role, parts: await toGeminiParts(m.content) });
  }
  const merged = [];
  for (const msg of raw) {
    const last = merged[merged.length - 1];
    if (last && last.role === msg.role) last.parts.push(...msg.parts);
    else merged.push(msg);
  }
  while (merged.length && merged[0].role !== "user") merged.shift();
  return merged;
}

export async function queryGemini({ messages, maxTokens = 1024, guildId = null, userName = "friend", temperature = 0.85 } = {}) {
  if (!GEMINI_API_KEY) {
    console.error("Missing GEMINI_API_KEY environment variable.");
    throw new AIError("AI is not configured.", { unavailable: true });
  }

  if (!Array.isArray(messages) || !messages.length) {
    return "Sorry... I didn't catch that...";
  }

  try {
    const contents = await toGeminiContents(messages);
    const res = await fetch(GEMINI_API_URL, {
      method: "POST",
      signal: AbortSignal.timeout(30_000),
      headers: {
        "x-goog-api-key": GEMINI_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: await buildBocchiPrompt({ guildId, userName }) }] },
        contents,
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature,
          // Chat replies shouldn't burn the output budget on hidden reasoning.
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`Gemini API error ${res.status}:`, text);

      if (res.status === 429 || /rate limit|too many requests|quota/i.test(text)) {
        throw new AIError("The bot's AI API is currently rate limited. Please try again in a moment.", { rateLimited: true });
      }

      throw new AIError("The bot's AI is not available right now. Try again later.", { unavailable: true });
    }

    const data = await res.json();
    const candidate = data.candidates?.[0];
    const raw = (candidate?.content?.parts ?? [])
      .filter((p) => p.text && !p.thought)
      .map((p) => p.text)
      .join("\n");
    return stripThoughts(raw) || "Sorry, I couldn't think of anything to say...";
  } catch (err) {
    if (err instanceof AIError) throw err;
    if (err?.name === "TimeoutError" || err?.name === "AbortError") {
      throw new AIError("The AI took too long to respond. Please try again.", { unavailable: true });
    }

    console.error("Gemini query failed:", err);
    throw new AIError("The bot's AI couldn't be reached. Try again later.", { unavailable: true });
  }
}
