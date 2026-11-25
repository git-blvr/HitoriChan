// Dev dashboard harness — boots the real Express app with a stub Discord
// client so the dashboard can be browsed without a bot token.
// Run: node scripts/dev-dashboard.mjs   →  http://127.0.0.1:3198
// Login: Admin / preview-admin   (or use the printed HC_SESSION cookie)

import { mkdtempSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = join(process.cwd(), "data");
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
process.env.DB_PATH = join(dir, "dev-dashboard.db");
process.env.DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || "preview-admin";
process.env.WEB_PORT = "3198";

const { startWebServer } = await import("../src/web/server.js");
const { createSession } = await import("../src/web/auth.js");

const textChannel = (id, name, parentId = null, position = 0) => ({
  id, name, type: 0, parentId, position,
  isTextBased: () => true, isVoiceBased: () => false,
});
const voiceChannel = (id, name, members = 0, parentId = null, position = 0) => ({
  id, name, type: 2, parentId, position,
  isTextBased: () => false, isVoiceBased: () => true,
  members: new Map(Array.from({ length: members }, (_, i) => [`vm-${id}-${i}`, {}])),
});
const category = (id, name, position = 0) => ({
  id, name, type: 4, position,
  isTextBased: () => false, isVoiceBased: () => false,
});
const role = (id, name, color, position, managed = false) => ({ id, name, color, position, managed });
const collection = (entries = []) => {
  const m = new Map(entries);
  m.map = (fn) => Array.from(m.values()).map(fn);
  m.filter = (fn) => new Map(Array.from(m.entries()).filter(([k, v]) => fn(v, k)));
  return m;
};

const member = (id, name, timedOut = false) => ({
  id,
  displayName: name,
  user: { id, username: name.toLowerCase().replace(/\s+/g, ""), bot: false, displayAvatarURL: () => null },
  roles: { cache: collection() },
  communicationDisabledUntilTimestamp: timedOut ? Date.now() + 3_600_000 : null,
});

const afk = voiceChannel("vc-afk", "AFK", 3, "cat-voice", 6);

const channels = new Map([
  ["cat-general", category("cat-general", "General", 0)],
  ["ch-general", textChannel("ch-general", "general", "cat-general", 1)],
  ["ch-rules", textChannel("ch-rules", "rules", "cat-general", 2)],
  ["ch-media", textChannel("ch-media", "media", "cat-general", 3)],
  ["cat-voice", category("cat-voice", "Voice", 4)],
  ["vc-lounge", voiceChannel("vc-lounge", "Lounge", 7, "cat-voice", 5)],
  ["vc-afk", afk],
  ["cat-staff", category("cat-staff", "Staff", 7)],
  ["ch-mod-log", textChannel("ch-mod-log", "mod-log", "cat-staff", 8)],
  ["ch-tickets", textChannel("ch-tickets", "tickets", "cat-staff", 9)],
]);

const roles = new Map([
  ["role-staff", role("role-staff", "Staff", 0x57f287, 10)],
  ["role-mod", role("role-mod", "Moderator", 0xed4245, 9)],
  ["role-booster", role("role-booster", "Server Booster", 0xf47fff, 8)],
  ["role-member", role("role-member", "Member", 0x9ca3af, 1)],
  ["role-bot", role("role-bot", "Bots", 0x5865f2, 11, true)],
]);

const members = collection([
  ["u-1", member("u-1", "Snya")],
  ["u-2", member("u-2", "KessokuFan")],
  ["u-3", member("u-3", "Bocchi", true)],
  ["u-4", member("u-4", "Nijika")],
  ["u-5", member("u-5", "Ryo", true)],
  ["u-6", member("u-6", "Kita")],
  ["u-7", member("u-7", "PA-san")],
]);

const guild = {
  id: "112233445566778899",
  name: "Seneya.",
  memberCount: 15334,
  premiumSubscriptionCount: 14,
  premiumTier: 2,
  afkChannelId: afk.id,
  afkChannel: afk,
  iconURL: () => "https://cdn.discordapp.com/embed/avatars/2.png",
  channels: { cache: channels },
  roles: { cache: roles },
  emojis: { cache: new Map() },
  members: {
    cache: members,
    fetch: async () => members,
  },
};

// Channels need guildId so the dashboard's same-guild checks pass.
for (const ch of channels.values()) ch.guildId = guild.id;

const fakeCommand = (name, cat) => ({
  data: { name },
  category: cat,
  prefixName: name,
  aliases: [],
});

const stubClient = {
  guilds: { cache: new Map([[guild.id, guild]]) },
  users: { cache: new Map() },
  channels: { cache: channels },
  commands: new Map(
    [
      ["ping", "utility"], ["help", "utility"], ["profile", "economy"], ["daily", "economy"],
      ["work", "economy"], ["shop", "economy"], ["balance", "economy"], ["level", "leveling"],
      ["rank", "leveling"], ["ban", "moderation"], ["kick", "moderation"], ["timeout", "moderation"],
      ["ticket", "tickets"], ["kiss", "interactions"], ["hug", "interactions"], ["marry", "marriage"],
      ["quest", "quests"], ["ai", "ai"], ["roll", "games"], ["slots", "games"],
    ].map(([name, cat]) => [name, fakeCommand(name, cat)])
  ),
  user: {
    tag: "Hitori Chan#6606",
    status: "online",
    displayAvatarURL: () => "https://cdn.discordapp.com/embed/avatars/1.png",
  },
  ws: { ping: 103 },
};

const server = await startWebServer(stubClient, 3198);

const { token } = createSession(
  { username: "Admin", isAdmin: true, permissions: ["*"] },
  { ip: "127.0.0.1", userAgent: "dev-harness" }
);

console.log("\nDev dashboard:  http://127.0.0.1:3198");
console.log("Login:          Admin / preview-admin");
console.log(`Session token:  ${token}`);
console.log("\nCtrl+C to stop.\n");

process.on("SIGINT", () => { server.close(); process.exit(0); });
