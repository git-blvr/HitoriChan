import { buildBocchiPrompt, summarizeHistory } from "../ai/index.js";

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

// Blushing/flustered phrases — wrapped in a markdown link to the blush GIF.
const BLUSH_RE = new RegExp(
  [
    "blush(?:ing|ed|es)?",
    "fluster(?:ed|ing)?",
    "(?:my |the |her )?(?:face|cheeks)(?:'s| is| are| feels| feel| gets| got)? (?:burning|burns|flushing|flushed|heating|hot|warm|red|glowing)",
    "(?:face|cheeks) burning up",
    "(?:turning|going|getting|turned|gone|went|feel) (?:so |really |all |bright )?(?:red|pink|warm)",
    "(?:so |really |kinda )?(?:embarrassed|embarrassing|shy)",
    "heat(?:ing)? up",
    "hides? (?:my |her |the )?face",
    "cover(?:ing|s)? (?:my |her |the )?face",
  ].join("|"),
  "gi"
);

export function linkifyBlush(text, gifUrl) {
  if (!text || !gifUrl) return text;
  BLUSH_RE.lastIndex = 0;
  // Skip matches already inside a markdown link/image.
  return text.replace(BLUSH_RE, (match, offset, str) => {
    const tail = str.slice(offset + match.length);
    if (tail.startsWith("](") || str.slice(0, offset).endsWith("[")) return match;
    return `[${match}](${gifUrl})`;
  });
}

export function buildContextMessages(history, userMessage, imageURLs) {
  const past = summarizeHistory(history, 9);
  const final = { role: "user", content: buildUserContent(userMessage, imageURLs) };
  return [...past, final];
}

export { buildBocchiPrompt, summarizeHistory };
