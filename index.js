import "dotenv/config";
import { Client, GatewayIntentBits, Partials, Options } from "discord.js";
import { closeDatabase } from "./src/database/db.js";
import { loadCommands, registerCommandListeners } from "./src/handlers/commandHandler.js";
import { loadEvents } from "./src/handlers/eventHandler.js";
import { startWebServer } from "./src/web/server.js";
import { logCrash } from "./src/utils/crashLogger.js";
import config from "./bot.config.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Message, Partials.Channel],
  // Bound every cache the bot doesn't need unbounded — unbounded message/user/
  // member caches are the dominant idle-RAM cost on large guilds.
  makeCache: Options.cacheWithLimits({
    MessageManager: 0,
    ThreadManager: 0,
    GuildForumThreadManager: 0,
    GuildTextThreadManager: 0,
    ThreadMemberManager: 0,
    ReactionManager: 0,
    ReactionUserManager: 0,
    PresenceManager: 0,
    GuildScheduledEventManager: 0,
    GuildStickerManager: 0,
    StageInstanceManager: 0,
    GuildBanManager: 0,
    GuildInviteManager: 0,
    UserManager: { maxSize: config.cache.users, keepOverLimit: (u) => u.id === u.client.user.id },
    GuildMemberManager: { maxSize: config.cache.members, keepOverLimit: (m) => m.id === m.client.user.id },
    VoiceStateManager: { maxSize: config.cache.voiceStates },
  }),
  sweepers: {
    ...Options.defaultSweeperSettings,
    messages: { interval: 60, lifetime: config.cache.messageSweepLifetimeMs },
    users: {
      interval: config.cache.userSweepIntervalMs,
      filter: () => (user) => user.id !== user.client.user.id,
    },
    guildMembers: {
      interval: config.cache.memberSweepIntervalMs,
      filter: () => (member) => member.id !== member.client.user.id,
    },
  },
});

let webServer = null;

async function main() {
  console.log("Connected to SQLite database");

  await loadCommands(client);
  await loadEvents(client);
  registerCommandListeners(client);

  await client.login(process.env.TOKEN);
  webServer = await startWebServer(client);
}

function shutdown(code) {
  webServer?.close();
  closeDatabase();
  client.destroy();
  process.exit(code);
}

process.on("uncaughtException", (error) => {
  logCrash(error, "uncaughtException");
  shutdown(1);
});

process.on("unhandledRejection", (reason) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  logCrash(error, "unhandledRejection");
});

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

client.on("error", (error) => logCrash(error, "clientError"));
client.on("warn", (info) => console.warn("[Discord warning]", info));

main().catch((error) => {
  logCrash(error, "main");
  closeDatabase();
  process.exit(1);
});
