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

// Emotion phrases get wrapped in markdown links to mood GIFs.
// Ordered specific → generic so overlapping phrases resolve sensibly.
const EMOTE_RULES = {
  sob: /\b(?:sobs?|sobbing|cries|cried|crying|tears?|weep(?:s|ing)?|sniff(?:le|les|ling)?|waa+h+)\b/gi,
  stutter: /\b[a-z]-[a-z]+\b/gi,
  blush: /\b(?:blush(?:ing|ed|es)?|fluster(?:ed|ing)?|(?:my |the |her )?(?:face|cheeks)(?:'s| is| are| feels| feel| gets| got)? (?:burning|burns|flushing|flushed|heating|hot|warm|red|glowing)|(?:face|cheeks) burning up|(?:turning|going|getting|turned|gone|went|feel) (?:so |really |all |bright )?(?:red|pink|warm)|(?:so |really |kinda )?(?:embarrassed|embarrassing|shy)|heat(?:ing)? up|hides? (?:my |her |the )?face|cover(?:ing|s)? (?:my |her |the )?face)\b/gi,
  exhausted: /\b(?:exhausted|worn out|drained|wiped(?: out)?|out of breath|no energy|phew)\b/gi,
  tired: /\b(?:tired|sleepy|drowsy|yawns?|yawning|dead tired|staring)\b/gi,
  happy: /\b(?:yay|happy|excited|wonderful|amazing|glad|delighted|hehe+|thrilled|hooray)\b/gi,
  nod: /\b(?:mhm|mm-hmm?|yep|yup|yes|sure thing|of course|definitely|absolutely|agreed|you got it|alright)\b/gi,
};
const EMOTE_ORDER = ["sob", "stutter", "blush", "exhausted", "tired", "happy", "nod"];

function linkifyFirst(text, regex, gifOrPicker) {
  regex.lastIndex = 0;
  let done = false;
  // Skip matches already inside a markdown link/image.
  return text.replace(regex, (match, offset, str) => {
    if (done) return match;
    const tail = str.slice(offset + match.length);
    if (tail.startsWith("](") || str.slice(0, offset).endsWith("[")) return match;
    done = true;
    const url = typeof gifOrPicker === "function" ? gifOrPicker() : gifOrPicker;
    return `[${match}](${url})`;
  });
}

// Pick the ONE most relevant emotion (most phrase matches; ties go to the
// earlier emotion in EMOTE_ORDER) and linkify only its first match — so a
// reply carries a single GIF embed no matter how many cues it has.
export function linkifyEmotes(text, emoteGifs) {
  if (!text || !emoteGifs) return text;
  let best = null;
  for (const emotion of EMOTE_ORDER) {
    const urls = emoteGifs[emotion];
    const regex = EMOTE_RULES[emotion];
    if (!urls?.length || !regex) continue;
    regex.lastIndex = 0;
    const count = (text.match(regex) ?? []).length;
    if (count > (best?.count ?? 0)) best = { urls, regex, count };
  }
  if (!best) return text;
  const pick = best.urls.length === 1
    ? best.urls[0]
    : () => best.urls[Math.floor(Math.random() * best.urls.length)];
  return linkifyFirst(text, best.regex, pick);
}

export function buildContextMessages(history, userMessage, imageURLs) {
  const past = summarizeHistory(history, 9);
  const final = { role: "user", content: buildUserContent(userMessage, imageURLs) };
  return [...past, final];
}

export { buildBocchiPrompt, summarizeHistory };
