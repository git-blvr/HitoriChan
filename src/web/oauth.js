import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { ALL_PERMISSIONS } from "../models/User.js";

const DISCORD_API = "https://discord.com/api/v10";
const TOKEN_TIMEOUT_MS = 10_000;

export const OAUTH_STATE_COOKIE = "hc_oauth_state";
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

// Developer accounts get owner-level access to every guild the bot is in.
// MAIN_GUILD_ID is the developer's primary guild — preselected in the UI.
export const MAIN_GUILD_ID = process.env.MAIN_GUILD_ID || "1376236720030486670";
export const DEVELOPER_IDS = new Set(
  ["1017830522677891163", ...(process.env.DEV_USER_IDS || "").split(",")]
    .map((s) => s.trim())
    .filter(Boolean)
);

// Discord sign-in users manage the guilds they own or administer — all bot
// features except dashboard account administration, which stays with local
// dashboard users.
export const GUILD_OWNER_PERMISSIONS = ALL_PERMISSIONS.filter((p) => p !== "users" && p !== "security");

// Discord permission bits that qualify a guild member as a "manager" — the
// same level of trust as Manage Server in the client.
const PERM_ADMINISTRATOR = 0x8n;
const PERM_MANAGE_GUILD = 0x20n;

// Maps an OAuth guild object to the dashboard role it grants, or null when
// the user has no management access there.
export function guildAccessRole(g) {
  if (!g) return null;
  if (g.owner === true) return "owner";
  let bits = 0n;
  try {
    bits = BigInt(g.permissions ?? g.permissions_new ?? "0");
  } catch {
    return null;
  }
  return (bits & (PERM_ADMINISTRATOR | PERM_MANAGE_GUILD)) !== 0n ? "manager" : null;
}

export function isDeveloperId(id) {
  return id != null && DEVELOPER_IDS.has(String(id));
}

export function oauthEnabled() {
  return Boolean(process.env.CLIENT_ID && process.env.DISCORD_CLIENT_SECRET);
}

export function redirectUri(req) {
  if (process.env.OAUTH_REDIRECT_URI) return process.env.OAUTH_REDIRECT_URI;
  const base = process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`;
  return `${base.replace(/\/+$/, "")}/auth/discord/callback`;
}

export function newState() {
  return randomBytes(16).toString("base64url");
}

export function stateMatches(queryState, cookieState) {
  if (typeof queryState !== "string" || typeof cookieState !== "string" || !queryState || !cookieState) {
    return false;
  }
  const a = createHash("sha256").update(queryState).digest();
  const b = createHash("sha256").update(cookieState).digest();
  return timingSafeEqual(a, b);
}

export function buildAuthorizeUrl(req, state) {
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", process.env.CLIENT_ID);
  url.searchParams.set("scope", "identify guilds");
  url.searchParams.set("state", state);
  url.searchParams.set("redirect_uri", redirectUri(req));
  return url.toString();
}

async function discordFetch(path, options = {}) {
  const res = await fetch(`${DISCORD_API}${path}`, {
    signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    ...options,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Discord API ${res.status} ${path} ${text.slice(0, 160)}`.trim());
  }
  return res.json();
}

async function exchangeCode(code, uri) {
  return discordFetch("/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.CLIENT_ID,
      client_secret: process.env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: uri,
    }),
  });
}

// Runs the code exchange and fetches the identity + guild list.
// The access token is used once and discarded — guild membership is
// snapshotted into the session at login time.
export async function completeOAuth(req, code) {
  const tokens = await exchangeCode(code, redirectUri(req));
  const headers = { authorization: `Bearer ${tokens.access_token}` };
  const [me, guilds] = await Promise.all([
    discordFetch("/users/@me", { headers }),
    discordFetch("/users/@me/guilds", { headers }),
  ]);
  if (!me?.id) throw new Error("Discord returned no user identity");
  return { me, guilds: Array.isArray(guilds) ? guilds : [] };
}

function avatarUrl(me) {
  if (me.avatar) {
    const ext = me.avatar.startsWith("a_") ? "gif" : "png";
    return `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.${ext}?size=64`;
  }
  const index = Number((BigInt(me.id) >> 22n) % 6n);
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

// Maps a Discord identity + their guild list to dashboard access.
// guilds = null means unrestricted (developer); otherwise a list of
// { id, role } entries for guilds the user owns or manages and the bot is in.
export function computeDiscordAccess(me, oauthGuilds, client) {
  const isDeveloper = isDeveloperId(me.id);
  const seen = new Set();
  const guilds = isDeveloper
    ? null
    : oauthGuilds
        .map((g) => ({ id: g?.id, role: guildAccessRole(g) }))
        .filter((g) => {
          if (!g.id || !g.role || !client.guilds.cache.has(g.id) || seen.has(g.id)) return false;
          seen.add(g.id);
          return true;
        });
  return {
    isDeveloper,
    guilds,
    permissions: isDeveloper ? ALL_PERMISSIONS : GUILD_OWNER_PERMISSIONS,
    identity: {
      // Namespaced so a Discord name can never collide with a local account.
      username: `discord:${me.id}`,
      displayName: me.global_name || me.username || me.id,
      avatar: avatarUrl(me),
      discordId: me.id,
      authType: "discord",
    },
  };
}
