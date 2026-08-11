import { buildBocchiPrompt, summarizeHistory } from "../ai/groq.js";

export function buildUserContent(text, imageURLs = []) {
  if (!imageURLs.length) return text || "[sent media]";
  const parts = [];
  if (text) parts.push({ type: "text", text });
  for (const url of imageURLs) parts.push({ type: "image_url", image_url: { url } });
  return parts;
}

export function getImageURLs(msg) {
  const urls = [];
  for (const a of msg.attachments?.values?.() ?? []) {
    if (a.contentType?.startsWith("image/") || a.url?.endsWith(".gif")) urls.push(a.url);
  }
  for (const e of msg.embeds ?? []) {
    for (const url of [e.image?.url, e.thumbnail?.url].filter(Boolean)) {
      if (!urls.includes(url)) urls.push(url);
    }
  }
  return urls;
}

export function trimHistory(messages, max = 10) {
  return messages.length > max ? messages.slice(-max) : messages;
}

export function buildContextMessages(history, userMessage, imageURLs) {
  const past = summarizeHistory(history, 9);
  const final = { role: "user", content: buildUserContent(userMessage, imageURLs) };
  return [...past, final];
}

export { buildBocchiPrompt, summarizeHistory };
