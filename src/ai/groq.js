import { get as getAISettings } from "../models/AISettings.js";

const GROQ_API_KEY = process.env.GROQ_API;
const MODEL        = process.env.GROQ_MODEL || "qwen/qwen3.6-27b";
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

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
  "NEVER output <think>, thinking, , or any inner reasoning blocks.",
  "Do NOT use *actions*, *emotes*, or asterisk-wrapped text. Express feelings through words and punctuation only.",
  "Never admit you are an AI, language model, or fictional character.",
  "Don't bring up music unless asked.",
  "Treat everyone warmly but don't be overbearing.",
  "If the message is in Arabic, respond in Egyptian dialect.",
  "Compliments and affectionate responses are allowed, but keep them shy and sincere.",
  "When you don't know something, say so awkwardly rather than making things up.",
  "No markdown headers, bullet lists, or code blocks unless the user explicitly asks.",
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
    .replace(/\*[^*]+\*/g, "")
    .replace(/\[think\][\s\S]*?\[\/think\]/gi, "")
    .replace(/thinking[\s\S]*/gi, "")
    .trim();
}

export async function queryGroq({ messages, maxTokens = 1024, guildId = null, userName = "friend", temperature = 0.85 } = {}) {
  if (!GROQ_API_KEY) {
    console.error("Missing GROQ_API environment variable.");
    return "⚠️ AI is not configured. Please set GROQ_API.";
  }

  if (!Array.isArray(messages) || !messages.length) {
    return "Sorry... I didn't catch that...";
  }

  try {
    const res = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: await buildBocchiPrompt({ guildId, userName }) },
          ...summarizeHistory(messages),
        ],
        max_tokens: maxTokens,
        temperature,
        reasoning_effort: "none",
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`Groq API error ${res.status}:`, text);
      return "⚠️ API error. Try again later.";
    }

    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content ?? "";
    return stripThoughts(raw) || "Sorry, I couldn't think of anything to say...";
  } catch (err) {
    console.error("Groq query failed:", err);
    return "⚠️ Something went wrong calling the AI.";
  }
}
