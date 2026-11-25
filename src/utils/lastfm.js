import * as LastfmUser from "../models/LastfmUser.js";

const API_ROOT = "https://ws.audioscrobbler.com/2.0/";
const TIMEOUT_MS = 8_000;

export const LASTFM_COLOR = 0xba0000;
export const USERNAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{1,14}$/;

export class LastfmError extends Error {
  constructor(message, code = 0) {
    super(message);
    this.name = "LastfmError";
    this.code = code;
  }
}

export function isConfigured() {
  return Boolean(process.env.LASTFM_API);
}

export const PERIOD_CHOICES = [
  { name: "All time", value: "overall" },
  { name: "Last 7 days", value: "7day" },
  { name: "Last month", value: "1month" },
  { name: "Last 3 months", value: "3month" },
  { name: "Last 6 months", value: "6month" },
  { name: "Last year", value: "12month" },
];

const PERIOD_ALIASES = new Map([
  ["overall", "overall"], ["all", "overall"], ["alltime", "overall"],
  ["7d", "7day"], ["7day", "7day"], ["week", "7day"], ["weekly", "7day"],
  ["1m", "1month"], ["1month", "1month"], ["month", "1month"], ["monthly", "1month"],
  ["3m", "3month"], ["3month", "3month"], ["quarter", "3month"],
  ["6m", "6month"], ["6month", "6month"],
  ["12m", "12month"], ["12month", "12month"], ["1y", "12month"], ["year", "12month"], ["yearly", "12month"],
]);

export function parsePeriod(raw) {
  if (!raw) return null;
  return PERIOD_ALIASES.get(String(raw).toLowerCase().replace(/\s+/g, "")) ?? null;
}

export function periodLabel(period) {
  return PERIOD_CHOICES.find((p) => p.value === period)?.name ?? "All time";
}

export async function apiCall(params) {
  if (!isConfigured()) {
    throw new LastfmError("Last.fm integration is not configured (missing LASTFM_API key).", 0);
  }
  const qs = new URLSearchParams({ ...params, api_key: process.env.LASTFM_API, format: "json" });
  const url = `${API_ROOT}?${qs}`;

  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      const data = await res.json().catch(() => null);
      if (data?.error) {
        throw new LastfmError(String(data.message ?? "Last.fm error"), Number(data.error));
      }
      if (!res.ok || data == null) {
        throw new LastfmError(`Last.fm returned HTTP ${res.status}`, -2);
      }
      return data;
    } catch (err) {
      lastErr = err;
      const retriable = !(err instanceof LastfmError) || err.code === -2 || err.code === 11 || err.code === 16 || err.code === 29;
      if (!retriable || attempt === 1) break;
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  if (lastErr instanceof LastfmError) throw lastErr;
  throw new LastfmError("Could not reach Last.fm.", -1);
}

export function describeError(err, noun = "that") {
  if (err instanceof LastfmError) {
    if (err.code === 6) return `Couldn't find ${noun} on Last.fm.`;
    if (err.code === 8 || err.code === 11 || err.code === 16 || err.code === -2) {
      return "Last.fm is having issues right now — try again in a bit.";
    }
    if (err.code === 10 || err.code === 26) return "The bot's Last.fm API key is invalid or suspended.";
    if (err.code === 29) return "Last.fm is rate limiting us — try again in a bit.";
    if (err.code > 0) return `Last.fm error: ${err.message}`;
    return err.message;
  }
  return "Couldn't reach Last.fm right now — try again in a bit.";
}

// ── Entity lookups ───────────────────────────────────────────────────────────

export const getUserInfo = (user) =>
  apiCall({ method: "user.getinfo", user });

export const getRecentTracks = (user, limit = 10) =>
  apiCall({ method: "user.getrecenttracks", user, limit, extended: 1 });

export const getTopArtists = (user, period = "overall", limit = 10) =>
  apiCall({ method: "user.gettopartists", user, period, limit });

export const getTopTracks = (user, period = "overall", limit = 10) =>
  apiCall({ method: "user.gettoptracks", user, period, limit });

export const getTopAlbums = (user, period = "overall", limit = 10) =>
  apiCall({ method: "user.gettopalbums", user, period, limit });

export const getArtistInfo = (artist, username = null) =>
  apiCall({ method: "artist.getinfo", artist, autocorrect: 1, ...(username ? { username } : {}) });

export const getTrackInfo = (artist, track, username = null) =>
  apiCall({ method: "track.getinfo", artist, track, autocorrect: 1, ...(username ? { username } : {}) });

export const getAlbumInfo = (artist, album, username = null) =>
  apiCall({ method: "album.getinfo", artist, album, autocorrect: 1, ...(username ? { username } : {}) });

export const searchArtist = async (query) =>
  asArray((await apiCall({ method: "artist.search", artist: query, limit: 1 }))?.results?.artistmatches?.artist)[0] ?? null;

export const searchTrack = async (query) =>
  asArray((await apiCall({ method: "track.search", track: query, limit: 1 }))?.results?.trackmatches?.track)[0] ?? null;

export const searchAlbum = async (query) =>
  asArray((await apiCall({ method: "album.search", album: query, limit: 1 }))?.results?.albummatches?.album)[0] ?? null;

// ── Response shape helpers ───────────────────────────────────────────────────

export function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

export function pickImage(images, preferred = ["extralarge", "large", "medium", "mega"]) {
  const list = asArray(images);
  for (const size of preferred) {
    const url = list.find((i) => i?.size === size)?.["#text"];
    if (url) return url;
  }
  return list.map((i) => i?.["#text"]).find(Boolean) ?? null;
}

export function entityName(entity) {
  if (entity == null) return "";
  if (typeof entity === "string") return entity;
  return entity.name ?? entity["#text"] ?? "";
}

export function mdEscape(value) {
  return String(value ?? "").replace(/([\\*_`|[\]~])/g, "\\$1");
}

export function link(name, url) {
  const text = `**${mdEscape(name)}**`;
  return url ? `[${text}](${url})` : text;
}

export function fmtPlays(count) {
  const n = Number(count) || 0;
  return `**${n.toLocaleString()}** play${n === 1 ? "" : "s"}`;
}

export function tagLine(tags, limit = 5) {
  const list = asArray(tags).slice(0, limit).map((t) => mdEscape(t?.name)).filter(Boolean);
  return list.length ? `*${list.join(", ")}*` : null;
}

/** Splits "Artist - Title" (or "Artist | Title") into { artist, title }. */
export function splitArtistTitle(input) {
  const text = String(input ?? "").trim();
  const match = text.match(/^(.+?)\s[-–—|]\s(.+)$/);
  if (match) return { artist: match[1].trim(), title: match[2].trim() };
  return { artist: null, title: text };
}

// ── Concurrency pool (whoknows) ──────────────────────────────────────────────

export async function mapPool(items, worker, concurrency = 4) {
  const results = new Array(items.length).fill(null);
  let index = 0;
  const lanes = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const i = index++;
      results[i] = await worker(items[i], i).catch(() => null);
    }
  });
  await Promise.all(lanes);
  return results;
}

// ── Target resolution ────────────────────────────────────────────────────────

async function linkedLookup(discordUser, self) {
  const link = await LastfmUser.get(discordUser.id);
  if (!link) {
    return {
      error: self
        ? "You haven't linked a Last.fm account yet — use `/lastfm set` or `fm set <username>`."
        : `**${mdEscape(discordUser.username)}** hasn't linked a Last.fm account yet.`,
    };
  }
  return { username: link.username, discordUser, self };
}

/**
 * Resolves who to fetch Last.fm data for.
 * Returns { username, discordUser, self } or { error }.
 * `args` is the remaining prefix-arg array (after any subcommand token).
 */
export async function resolveFmTarget(ctx, args, { optionName = "user", argIndex = 0 } = {}) {
  if (ctx.isInteraction) {
    const u = ctx.source?.options?.getUser?.(optionName) ?? ctx.user;
    return linkedLookup(u, u.id === ctx.user.id);
  }

  const raw = args?.[argIndex];
  if (raw) {
    const mention = String(raw).match(/^<@!?(\d+)>$/);
    const id = mention?.[1] ?? (/^\d{17,20}$/.test(raw) ? raw : null);
    if (id) {
      const u = await ctx.client.users.fetch(id).catch(() => null);
      if (!u) return { error: "Could not find that Discord user." };
      return linkedLookup(u, u.id === ctx.user.id);
    }
    return { username: String(raw), discordUser: null, self: false };
  }

  if (ctx.reference?.messageId) {
    const ref = await ctx.channel.messages.fetch(ctx.reference.messageId).catch(() => null);
    if (ref?.author) return linkedLookup(ref.author, ref.author.id === ctx.user.id);
  }

  return linkedLookup(ctx.user, true);
}

/** All linked Last.fm users that are members of this guild (capped). */
export async function resolveGuildLinked(ctx, cap = 30) {
  const links = await LastfmUser.getAll();
  const members = await mapPool(links, async (link) => {
    const member = ctx.guild.members.cache.get(link.userId)
      ?? await ctx.guild.members.fetch(link.userId).catch(() => null);
    return member ? { member, username: link.username } : null;
  }, 5);
  return members.filter(Boolean).slice(0, cap);
}
