import { embErr } from "./embeds.js";

export async function resolveMember(ctx, argIndex = 0) {
  if (ctx.isInteraction) {
    const user = ctx.source?.options?.getUser?.("target") ?? ctx.source?.options?.getUser?.("user");
    if (!user) return null;
    return withDiscord(() => ctx.guild.members.fetch(user.id), { label: "resolveMember" });
  }

  const raw = ctx.args?.[argIndex];
  if (!raw || !ctx.guild) return null;

  const mentionMatch = String(raw).match(/<@!?(\d+)>$/);
  const id = mentionMatch?.[1] ?? raw;
  if (!/^\d{17,20}$/.test(id)) return null;

  return withDiscord(() => ctx.guild.members.fetch(id), { label: "resolveMember" });
}

export function resolveChannelId(raw) {
  if (!raw) return null;
  const match = String(raw).match(/<#(\d+)>$/);
  const id = match?.[1] ?? raw;
  return /^\d{17,20}$/.test(id) ? id : null;
}

export function resolveRoleId(raw) {
  if (!raw) return null;
  const match = String(raw).match(/<@&(\d+)>$/);
  const id = match?.[1] ?? raw;
  return /^\d{17,20}$/.test(id) ? id : null;
}

export function resolveReason(ctx, argIndex = 1) {
  if (ctx.isInteraction) {
    return ctx.source?.options?.getString?.("reason") ?? "No reason provided";
  }
  const reason = (ctx.args ?? []).slice(argIndex).join(" ").trim();
  return reason || "No reason provided";
}

export function resolveAttachment(ctx) {
  if (ctx.isInteraction) {
    return ctx.source?.options?.getAttachment?.("attachment")?.url ?? null;
  }
  return ctx.source?.attachments?.first?.()?.url ?? null;
}

export async function requireServer(ctx) {
  if (!ctx.guild) {
    await ctx.reply(embErr("This command only works in a server."));
    return false;
  }
  return true;
}

export async function checkHierarchy(ctx, target) {
  const botMember = ctx.guild.members.me;
  if (target.id === ctx.user.id) {
    await ctx.reply(embErr("You cannot moderate yourself."));
    return false;
  }
  if (target.id === ctx.guild.ownerId) {
    await ctx.reply(embErr("You cannot moderate the server owner."));
    return false;
  }
  if (botMember.roles.highest.comparePositionTo(target.roles.highest) <= 0) {
    await ctx.reply(embErr("My role is too low to moderate that member."));
    return false;
  }
  if (ctx.member.roles.highest.comparePositionTo(target.roles.highest) <= 0) {
    await ctx.reply(embErr("Your role is too low to moderate that member."));
    return false;
  }
  return true;
}

const MAX_MESSAGE_LENGTH = 2000;
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryAfter(err) {
  const seconds = err.rawError?.retry_after ?? err.retryAfter;
  if (typeof seconds === "number" && Number.isFinite(seconds)) {
    return Math.min(seconds * 1000, 30_000);
  }
  return 1000;
}

export async function withDiscord(fn, { label = "discord", retries = 3 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = err.status ?? err.httpStatus;
      const code = err.code;

      if (status === 403 || status === 404 || code === 10013 || code === 10007) {
        return null;
      }

      if (RETRYABLE_STATUS.has(status) || err.name === "AbortError" || err.code === "ECONNRESET" || err.code === "ETIMEDOUT") {
        const delay = getRetryAfter(err) * (i + 1);
        console.warn(`[${label}] Discord API attempt ${i + 1}/${retries + 1} failed (status ${status ?? "network"}), retrying in ${delay}ms...`);
        await sleep(delay);
        continue;
      }

      console.error(`[${label}] Discord API error:`, err);
      return null;
    }
  }
  console.error(`[${label}] Discord API failed after ${retries + 1} attempts:`, lastErr);
  return null;
}

export function sanitizeMentions(content) {
  if (typeof content !== "string") return content;
  return content.replace(/@everyone/g, "everyone").replace(/@here/g, "here");
}

export function chunkMessage(content, maxLength = MAX_MESSAGE_LENGTH) {
  if (typeof content !== "string" || content.length <= maxLength) return [content];
  const chunks = [];
  let remaining = content;
  while (remaining.length > maxLength) {
    let splitAt = remaining.lastIndexOf("\n\n", maxLength);
    if (splitAt === -1) splitAt = remaining.lastIndexOf("\n", maxLength);
    if (splitAt <= 0) splitAt = maxLength;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

const DEFAULT_ALLOWED_MENTIONS = Object.freeze({ parse: ["users"], repliedUser: false });

export function safeMessagePayload(payload, { maxLength = MAX_MESSAGE_LENGTH, suppressMassMentions = true } = {}) {
  if (typeof payload === "string") {
    const content = sanitizeMentions(payload).slice(0, maxLength);
    return {
      content,
      allowedMentions: suppressMassMentions ? DEFAULT_ALLOWED_MENTIONS : undefined,
    };
  }

  const data = { ...payload };
  if (data.content != null) {
    let content = String(data.content);
    if (suppressMassMentions) content = sanitizeMentions(content);
    if (content.length > maxLength) content = content.slice(0, maxLength - 3) + "...";
    data.content = content;
  }
  if (suppressMassMentions && !data.allowedMentions) {
    data.allowedMentions = DEFAULT_ALLOWED_MENTIONS;
  }
  return data;
}

export async function safeSend(target, payload) {
  const safe = safeMessagePayload(payload);
  if (typeof safe.content !== "string") {
    return target.send(safe);
  }
  const chunks = chunkMessage(safe.content, MAX_MESSAGE_LENGTH);
  const results = [];
  for (let i = 0; i < chunks.length; i++) {
    const part = i === chunks.length - 1 ? { ...safe, content: chunks[i] } : { content: chunks[i], allowedMentions: safe.allowedMentions };
    results.push(await target.send(part));
  }
  return results.length === 1 ? results[0] : results;
}

export async function safeReply(message, payload) {
  const safe = safeMessagePayload(payload);
  if (typeof safe.content !== "string") {
    return message.reply(safe);
  }
  const chunks = chunkMessage(safe.content, MAX_MESSAGE_LENGTH);
  const results = [];
  for (let i = 0; i < chunks.length; i++) {
    const part = i === chunks.length - 1 ? { ...safe, content: chunks[i] } : { content: chunks[i], allowedMentions: safe.allowedMentions };
    results.push(await message.reply(part));
  }
  return results.length === 1 ? results[0] : results;
}
