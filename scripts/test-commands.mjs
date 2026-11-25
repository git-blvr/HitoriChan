// Command smoke-test harness.
// Loads every command module under src/commands, then executes each command
// against a mocked Discord context — once per slash variant (including every
// subcommand, with synthesized option values) and several prefix arg profiles.
// Uses a throwaway SQLite DB so the real data/hitorichan.db is untouched.
//
// Usage: node scripts/test-commands.mjs [--verbose]

import { tmpdir } from "node:os";
import { join, dirname, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { unlinkSync, existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// Must be set before any src/ module is imported (db.js reads it at import time).
process.env.DB_PATH = join(tmpdir(), `hc-cmdtest-${process.pid}.db`);
for (const suffix of ["", "-wal", "-shm"]) {
  try { unlinkSync(process.env.DB_PATH + suffix); } catch {}
}
process.env.TOKEN ||= "test-token";
process.env.NATIVE_DISABLE ||= "1"; // deterministic: exercise the JS fallbacks

const VERBOSE = process.argv.includes("--verbose");

const { Collection } = await import("discord.js");
const { walkDirectory } = await import("../src/utils/fileWalker.js");
const { createCtx } = await import("../src/utils/ctx.js");

// ── IDs ─────────────────────────────────────────────────────────────────────
const GUILD_ID = "666666666666666666";
const CHANNEL_ID = "444444444444444444";
const ROLE_ID = "555555555555555555";
const AUTHOR_ID = "200000000000000001";
const TARGET_ID = "222222222222222222";
const BOT_ID = "333333333333333333";
const OWNER_ID = "111111111111111111";

// ── Errors collection ───────────────────────────────────────────────────────
const errors = [];
let currentLabel = "startup";
let replyCount = 0;

function recordError(kind, err) {
  errors.push({ label: currentLabel, kind, name: err?.name ?? "Error", message: String(err?.message ?? err), stack: String(err?.stack ?? "") });
}

process.on("unhandledRejection", (err) => recordError("unhandledRejection", err));
process.on("uncaughtException", (err) => recordError("uncaughtException", err));

// ── Mock factories ──────────────────────────────────────────────────────────

function makeRole(id, name, position) {
  const role = {
    id, name, color: 0x3498db, position, mentionable: true, managed: false, hoisted: false,
    icon: null, unicodeEmoji: null, tags: {}, createdTimestamp: 0,
    permissions: { has: () => true, toArray: () => ["Administrator"], missing: () => [] },
    members: new Collection(),
    editable: true,
    guild: null,
    iconURL: () => null,
    comparePositionTo: (other) => position - (other?.position ?? 0),
    edit: async () => role,
    delete: async () => role,
    setName: async () => role,
    toString: () => `<@&${id}>`,
    fetch: async () => role,
  };
  return role;
}

function makeUser(id, username, bot = false) {
  const user = {
    id, username, bot, tag: `${username}#0000`, discriminator: "0",
    globalName: username, displayName: username, system: false,
    avatar: null, banner: null, accentColor: null, flags: null,
    createdTimestamp: 0,
    displayAvatarURL: () => "https://cdn.discordapp.com/embed/avatars/0.png",
    avatarURL: () => "https://cdn.discordapp.com/embed/avatars/0.png",
    bannerURL: () => null,
    send: async () => makeMsg(dmChannel, user),
    createDM: async () => dmChannel,
    deleteDM: async () => dmChannel,
    fetch: async () => user,
    toString: () => `<@${id}>`,
  };
  return user;
}

function makeMember(user, guild, rolePosition = 1) {
  const role = makeRole(`${ROLE_ID}${user.id.slice(-2)}`, "MemberRole", rolePosition);
  role.guild = guild;
  const member = {
    id: user.id, user, guild,
    nickname: null, displayName: user.username, displayAvatarURL: user.displayAvatarURL,
    avatar: null, pending: false, joinedTimestamp: 0, premiumSinceTimestamp: null,
    communicationDisabledUntilTimestamp: null,
    roles: {
      cache: new Collection([[role.id, role]]),
      highest: role, hoist: role, icon: null, color: role,
      premiumSubscriberRole: null, botRole: null,
      add: async () => member, remove: async () => member, set: async () => member,
    },
    permissions: { has: () => true, toArray: () => ["Administrator"], missing: () => [], serialize: () => ({ Administrator: true }) },
    voice: { channel: null, channelId: null, mute: false, deaf: false, selfMute: false, selfDeaf: false, serverMute: false, serverDeaf: false, streaming: false, selfVideo: false, setMute: async () => member, setDeaf: async () => member, disconnect: async () => member, setChannel: async () => member },
    presence: null,
    bannable: true, kickable: true, manageable: true, moderatable: true,
    kick: async () => member,
    ban: async () => member,
    timeout: async () => member,
    edit: async () => member,
    setNickname: async () => member,
    disableCommunicationUntil: async () => member,
    send: async (p) => user.send(p),
    fetch: async () => member,
    toString: () => `<@${user.id}>`,
    isCommunicationDisabled: () => false,
  };
  return member;
}

function makeMsg(channel, author) {
  const msg = {
    id: String(Math.floor(Math.random() * 1e17) + 1e17),
    channel, channelId: channel.id, author, member: author?.member ?? null,
    guild: channel.guild, guildId: channel.guild?.id,
    content: "", embeds: [], components: [], attachments: new Collection(),
    mentions: makeMentions(),
    reactions: { cache: new Collection(), removeAll: async () => msg },
    stickers: new Collection(), pinned: false, tts: false, system: false,
    createdTimestamp: Date.now(), editedTimestamp: null,
    url: `https://discord.com/channels/${channel.guild?.id ?? "@me"}/${channel.id}/1`,
    reference: null, type: 0, flags: { has: () => false },
    reply: async () => msg,
    edit: async () => msg,
    delete: async () => msg,
    fetch: async () => msg,
    react: async () => ({}),
    pin: async () => msg,
    unpin: async () => msg,
    startThread: async () => makeThread(channel),
    awaitMessageComponent: async () => makeComponentInteraction(msg),
    createMessageComponentCollector: () => makeCollector(msg),
    createReactionCollector: () => makeCollector(msg),
    awaitReactions: async () => new Collection(),
    toString: () => msg.content,
    crosspost: async () => msg,
    forward: async () => msg,
    suppressEmbeds: async () => msg,
    removeAttachments: async () => msg,
    resolveComponent: () => null,
  };
  return msg;
}

function makeMentions() {
  return {
    users: new Collection(), members: new Collection(), roles: new Collection(),
    channels: new Collection(), parsedUsers: new Collection(), crosspostedChannels: new Collection(),
    everyone: false, repliedUser: null, has: () => false,
  };
}

function makeCollector(message) {
  const listeners = {};
  const collector = {
    message, collected: new Collection(), ended: false, filter: () => true, options: {},
    on: (ev, fn) => { (listeners[ev] ??= []).push(fn); return collector; },
    once: (ev, fn) => { (listeners[ev] ??= []).push(fn); return collector; },
    off: () => collector, removeListener: () => collector,
    stop: () => { collector.ended = true; },
    end: () => { collector.ended = true; },
    dispose: () => {}, checkEnd: () => false,
    handleCollect: async () => {}, handleDispose: async () => {},
    emit: async (ev, ...a) => { for (const fn of listeners[ev] ?? []) await fn(...a); },
    // Fire one collect + end so component handlers get exercised.
    fire: async () => {
      const ci = makeComponentInteraction(message);
      for (const fn of listeners.collect ?? []) await fn(ci);
      for (const fn of listeners.end ?? []) await fn(new Collection(), "time");
    },
  };
  setTimeout(() => collector.fire().catch((e) => recordError("collector-handler", e)), 10);
  return collector;
}

function makeComponentInteraction(message) {
  const ci = {
    id: "900000000000000001", customId: "test_component", values: ["test_value"],
    componentType: 2, type: 3,
    user: world.authorUser, member: world.authorMember, guild: world.guild,
    channel: world.channel, channelId: CHANNEL_ID, guildId: GUILD_ID,
    message, client: world.client, deferred: false, replied: false, ephemeral: false,
    token: "t", applicationId: BOT_ID, createdTimestamp: Date.now(),
    locale: "en-US", guildLocale: "en-US",
    isButton: () => true, isStringSelectMenu: () => true, isSelectMenu: () => true,
    isModalSubmit: () => false, isChatInputCommand: () => false, isMessageComponent: () => true,
    reply: async (p) => { ci.replied = true; replyCount++; return message; },
    deferReply: async () => { ci.deferred = true; return message; },
    editReply: async () => { replyCount++; return message; },
    followUp: async () => { replyCount++; return message; },
    deferUpdate: async () => message,
    update: async () => { replyCount++; return message; },
    fetchReply: async () => message,
    deleteReply: async () => {},
    showModal: async () => {},
    awaitModalSubmit: async () => makeModalInteraction(),
    followUpRaw: async () => message,
    toString: () => "<component>",
  };
  return ci;
}

function makeModalInteraction() {
  return {
    customId: "test_modal", user: world.authorUser, member: world.authorMember,
    guild: world.guild, channel: world.channel, client: world.client,
    deferred: false, replied: false,
    fields: {
      getTextInputValue: () => "test input",
      getField: () => ({ value: "test input", type: 4 }),
      fields: new Collection(),
    },
    reply: async () => makeMsg(world.channel, world.authorUser),
    deferReply: async () => {},
    editReply: async () => makeMsg(world.channel, world.authorUser),
    followUp: async () => makeMsg(world.channel, world.authorUser),
    deferUpdate: async () => {},
    update: async () => makeMsg(world.channel, world.authorUser),
    isModalSubmit: () => true,
  };
}

function makeThread(parent) {
  const t = makeChannel(parent.guild, "777777777777777777");
  t.type = 11; t.parent = parent; t.parentId = parent.id;
  return t;
}

function makeChannel(guild, id = CHANNEL_ID) {
  const channel = {
    id, name: "test-channel", type: 0, guild, guildId: guild?.id,
    parentId: null, parent: null, topic: null, nsfw: false, position: 0,
    rateLimitPerUser: 0, lastMessageId: null, createdTimestamp: 0,
    viewable: true, manageable: true, deletable: true,
    send: async () => { replyCount++; return makeMsg(channel, world.botUser); },
    sendTyping: async () => {},
    bulkDelete: async () => new Collection(),
    messages: {
      cache: new Collection(),
      fetch: async (arg) => {
        if (typeof arg === "string") return makeMsg(channel, world.authorUser);
        // fetch({ limit }) / fetch() -> Collection of recent messages
        const msgs = new Collection();
        for (let i = 0; i < Math.min(arg?.limit ?? 5, 5); i++) {
          const m = makeMsg(channel, i % 2 ? world.authorUser : world.targetUser);
          m.createdTimestamp = Date.now() - i * 1000;
          msgs.set(m.id, m);
        }
        return msgs;
      },
      fetchPinned: async () => new Collection(),
    },
    permissionOverwrites: {
      cache: new Collection(),
      create: async () => ({}), edit: async () => ({}), delete: async () => {},
      set: async () => channel, resolve: () => null, resolveId: () => null,
    },
    permissionsFor: () => ({ has: () => true, missing: () => [], toArray: () => ["ViewChannel"] }),
    isTextBased: () => true, isThread: () => false, isVoiceBased: () => false,
    isDMBased: () => false, isSendable: () => true, isThreadOnly: () => false,
    delete: async () => channel, edit: async () => channel, setName: async () => channel,
    setTopic: async () => channel, setParent: async () => channel,
    fetch: async () => channel,
    createMessageComponentCollector: () => makeCollector(makeMsg(channel, world.botUser)),
    awaitMessageComponent: async () => makeComponentInteraction(makeMsg(channel, world.botUser)),
    createWebhook: async () => makeWebhook(channel), fetchWebhooks: async () => new Collection(),
    invites: { create: async () => ({ code: "abc123", url: "https://discord.gg/abc123" }), fetch: async () => new Collection(), cache: new Collection() },
    threads: { cache: new Collection(), create: async () => makeThread(channel), fetch: async () => makeThread(channel) },
    pins: { fetch: async () => new Collection() },
    typing: false, typingCount: 0,
    clone: async () => channel,
    toString: () => `<#${id}>`,
  };
  return channel;
}

function makeWebhook(channel) {
  return { id: "1", name: "hook", channelId: channel.id, channel, send: async () => makeMsg(channel, world.botUser), edit: async () => ({}), delete: async () => {}, avatarURL: () => null };
}

const dmChannel = {
  id: "888888888888888888", type: 1, guild: null, guildId: null,
  send: async (p) => makeMsg(dmChannel, world.botUser),
  sendTyping: async () => {},
  isTextBased: () => true, isDMBased: () => true, isSendable: () => true,
  messages: { fetch: async () => makeMsg(dmChannel, world.authorUser) },
  createMessageComponentCollector: () => makeCollector(makeMsg(dmChannel, world.botUser)),
  awaitMessageComponent: async () => makeComponentInteraction(makeMsg(dmChannel, world.botUser)),
  toString: () => "<dm>",
};

// ── World (shared guild/users/channels) ─────────────────────────────────────

const world = {};
{
  const botUser = makeUser(BOT_ID, "hitorichan", true);
  const authorUser = makeUser(AUTHOR_ID, "tester");
  const targetUser = makeUser(TARGET_ID, "target");
  const ownerUser = makeUser(OWNER_ID, "owner");
  const everyone = makeRole(GUILD_ID, "@everyone", 0);
  const botRole = makeRole("555555555555555599", "BotRole", 100);
  const testRole = makeRole(ROLE_ID, "TestRole", 2);

  const guild = {
    id: GUILD_ID, name: "Test Guild", ownerId: OWNER_ID,
    memberCount: 42, preferredLocale: "en-US", description: null,
    createdTimestamp: 0, premiumTier: 0, premiumSubscriptionCount: 0,
    verificationLevel: 0, explicitContentFilter: 0, mfaLevel: 0, nsfwLevel: 0,
    features: [], available: true, large: false, maximumMembers: 100,
    icon: null, banner: null, splash: null, vanityURLCode: null,
    rulesChannelId: null, systemChannelId: CHANNEL_ID, afkChannelId: null,
    iconURL: () => "https://cdn.discordapp.com/embed/avatars/0.png",
    bannerURL: () => null, splashURL: () => null,
    joinedTimestamp: 0,
  };
  everyone.guild = guild; botRole.guild = guild; testRole.guild = guild;

  const botMember = makeMember(botUser, guild, 100);
  botMember.roles.highest = botRole;
  const authorMember = makeMember(authorUser, guild, 50);
  const targetMember = makeMember(targetUser, guild, 1);
  const ownerMember = makeMember(ownerUser, guild, 99);

  const channel = makeChannel(guild);

  const membersCache = new Collection([
    [authorUser.id, authorMember], [targetUser.id, targetMember],
    [botUser.id, botMember], [ownerUser.id, ownerMember],
  ]);
  const rolesCache = new Collection([[everyone.id, everyone], [testRole.id, testRole], [botRole.id, botRole]]);
  const channelsCache = new Collection([[channel.id, channel]]);

  guild.members = {
    me: botMember, cache: membersCache,
    fetch: async (arg) => {
      if (typeof arg === "string") return membersCache.get(arg) ?? makeMember(makeUser(arg, `user${arg.slice(-4)}`), guild);
      if (arg?.user) return membersCache.get(arg.user) ?? membersCache.first();
      return membersCache;
    },
    add: async () => targetMember,
    ban: async () => ({}), unban: async () => targetUser,
    kick: async () => targetMember, edit: async () => targetMember,
    list: async () => membersCache, search: async () => membersCache,
    fetchMe: async () => botMember, prune: async () => 0,
  };
  guild.channels = {
    cache: channelsCache,
    fetch: async (arg) => (typeof arg === "string" ? channel : channelsCache),
    create: async (o) => { const c = makeChannel(guild, "444444444444444499"); c.name = o?.name ?? "new"; return c; },
    edit: async () => channel, setPosition: async () => guild,
  };
  guild.roles = {
    cache: rolesCache, everyone, highest: botRole, premiumSubscriberRole: null,
    fetch: async (arg) => (typeof arg === "string" ? testRole : rolesCache),
    create: async (o) => makeRole("555555555555555588", o?.name ?? "role", 1),
    edit: async () => testRole, botRoleFor: () => botRole,
  };
  guild.bans = { cache: new Collection(), fetch: async () => ({ user: targetUser, reason: "x" }), create: async () => ({}), remove: async () => targetUser };
  guild.emojis = { cache: new Collection(), fetch: async () => new Collection(), create: async () => ({}) };
  guild.stickers = { cache: new Collection(), fetch: async () => new Collection(), create: async () => ({}) };
  guild.invites = { cache: new Collection(), fetch: async () => new Collection(), create: async () => ({ code: "abc" }), fetchVanityData: async () => ({}) };
  guild.webhooks = { fetch: async () => new Collection(), create: async () => makeWebhook(channel) };
  guild.voiceStates = { cache: new Collection(), fetch: async () => null };
  guild.presences = { cache: new Collection() };
  guild.scheduledEvents = { cache: new Collection(), fetch: async () => new Collection(), create: async () => ({}), edit: async () => ({}) };
  guild.autoModerationRules = { cache: new Collection(), fetch: async () => new Collection(), create: async () => ({}) };
  guild.auditLogs = { fetch: async () => ({ entries: new Collection() }) };
  guild.fetch = async () => guild;
  guild.edit = async () => guild;
  guild.leave = async () => guild;
  guild.delete = async () => guild;
  guild.membersMe = botMember;
  guild.systemChannel = channel;
  guild.rulesChannel = null; guild.publicUpdatesChannel = null; guild.safetyAlertsChannel = null;
  guild.afkChannel = null; guild.widgetChannel = null;
  guild.fetchOwner = async () => ownerMember;
  guild.shard = { ping: 5, id: 0 };
  guild.shardId = 0;
  guild.voiceAdapterCreator = null;
  guild.preferredLocaleRaw = "en-US";
  guild.toString = () => guild.name;
  guild.members.me = botMember;

  const client = {
    user: botUser, ws: { ping: 5, status: 0 },
    commands: new Collection(), prefixCommands: new Collection(),
    users: { cache: new Collection([[authorUser.id, authorUser], [targetUser.id, targetUser]]), fetch: async (id) => new Collection([[authorUser.id, authorUser], [targetUser.id, targetUser]]).get(id) ?? makeUser(id, `user${String(id).slice(-4)}`), resolve: () => authorUser },
    guilds: { cache: new Collection([[guild.id, guild]]), fetch: async () => guild, resolve: () => guild, create: async () => guild },
    channels: { cache: channelsCache, fetch: async () => channel, resolve: () => channel },
    emojis: { cache: new Collection() },
    application: { id: BOT_ID, owner: ownerUser, commands: { set: async () => {}, fetch: async () => new Collection() }, fetch: async () => ({}) },
    token: "t", readyTimestamp: Date.now(), uptime: 1000,
    isReady: () => true,
    on: () => client, once: () => client, off: () => client, emit: () => true, removeListener: () => client,
    options: { intents: [] }, rest: { get: async () => ({}), post: async () => ({}), put: async () => ({}), delete: async () => ({}), patch: async () => ({}) },
    sweepers: {}, presence: { client: null },
    destroy: async () => {}, login: async () => "t",
    shard: null, voice: { adapters: new Map() },
    generateInvite: () => "https://discord.com/oauth2/authorize?client_id=1",
    toString: () => "<client>",
    fetchInvite: async () => ({ code: "abc", guild, channel }),
    fetchWebhook: async () => makeWebhook(channel),
    fetchPremiumStickerPacks: async () => new Collection(),
    sweepText: (s) => s,
  };

  Object.assign(world, {
    guild, channel, client,
    botUser, authorUser, targetUser, ownerUser,
    botMember, authorMember, targetMember, ownerMember,
    everyone, botRole, testRole,
  });
}

// ── Option synthesis ────────────────────────────────────────────────────────

const ATTACHMENT = {
  id: "999999999999999999", name: "test.png", url: "https://cdn.discordapp.com/embed/avatars/0.png",
  proxyURL: "https://media.discordapp.net/embed/avatars/0.png",
  contentType: "image/png", size: 1024, height: 128, width: 128, ephemeral: false,
};

function sampleString(name) {
  const n = String(name).toLowerCase();
  if (/url|image|avatar|banner|icon|gif/.test(n)) return "https://cdn.discordapp.com/embed/avatars/0.png";
  if (/prefix/.test(n)) return "!";
  if (/color/.test(n)) return "#00ff1e";
  if (/duration|time/.test(n)) return "10m";
  if (/amount|count|limit|quantity|level/.test(n)) return "10";
  if (/date/.test(n)) return "2026-01-01";
  return "test";
}

function clampNum(min, max, fallback) {
  if (min != null && fallback < min) return min;
  if (max != null && fallback > max) return max;
  return fallback;
}

function buildEntries(optionDefs) {
  return (optionDefs ?? []).map((o) => {
    const e = { name: o.name, type: o.type, value: undefined };
    switch (o.type) {
      case 3: e.value = o.choices?.[0]?.value ?? sampleString(o.name); break;
      case 4: e.value = o.choices?.[0]?.value ?? clampNum(o.min_value, o.max_value, 10); break;
      case 5: e.value = true; break;
      case 6: e.value = TARGET_ID; e.user = world.targetUser; e.member = world.targetMember; break;
      case 7: e.value = CHANNEL_ID; e.channel = world.channel; break;
      case 8: e.value = ROLE_ID; e.role = world.testRole; break;
      case 9: e.value = TARGET_ID; e.user = world.targetUser; e.member = world.targetMember; break;
      case 10: e.value = o.choices?.[0]?.value ?? clampNum(o.min_value, o.max_value, 2.5); break;
      case 11: e.value = ATTACHMENT.id; e.attachment = ATTACHMENT; break;
    }
    return e;
  });
}

function makeOptionResolver(entries, { sub = null, group = null } = {}) {
  const find = (name) => entries.find((e) => e.name === name) ?? null;
  const getOrThrow = (name) => find(name)?.value ?? null;
  return {
    data: entries.map((e) => {
      const { user, member, channel, role, attachment, ...rest } = e;
      return { ...rest, user, member, channel, role, attachment };
    }),
    get: find,
    getString: (n) => getOrThrow(n),
    getInteger: (n) => { const v = getOrThrow(n); return typeof v === "number" ? Math.trunc(v) : v; },
    getNumber: (n) => getOrThrow(n),
    getBoolean: (n) => getOrThrow(n),
    getUser: (n) => find(n)?.user ?? null,
    getMember: (n) => find(n)?.member ?? null,
    getChannel: (n) => find(n)?.channel ?? null,
    getRole: (n) => find(n)?.role ?? null,
    getMentionable: (n) => { const e = find(n); return e ? (e.member ?? e.role ?? e.user ?? null) : null; },
    getAttachment: (n) => find(n)?.attachment ?? null,
    getSubcommand: () => sub,
    getSubcommandGroup: () => group,
    getFocused: () => null,
    _hoistedOptions: entries,
  };
}

// ── Source builders ─────────────────────────────────────────────────────────

function makeInteraction(command, entries, variant) {
  const interaction = {
    id: String(Math.floor(Math.random() * 1e17) + 1e17),
    type: 2, commandType: 1, commandName: command.data.name,
    commandGuildId: GUILD_ID, commandId: "1",
    user: world.authorUser, member: world.authorMember, memberPermissions: { has: () => true, toArray: () => ["Administrator"] },
    guild: world.guild, guildId: GUILD_ID,
    channel: world.channel, channelId: CHANNEL_ID,
    client: world.client, appPermissions: { has: () => true },
    deferred: false, replied: false, ephemeral: null,
    token: "t", applicationId: BOT_ID, createdTimestamp: Date.now(),
    locale: "en-US", guildLocale: "en-US", entitlements: new Collection(),
    options: makeOptionResolver(entries, variant),
    isChatInputCommand: () => true, isCommand: () => true, isContextMenuCommand: () => false,
    isButton: () => false, isAutocomplete: () => false, isModalSubmit: () => false,
    isMessageComponent: () => false, isRepliable: () => true,
    inGuild: () => true, inCachedGuild: () => true, inRawGuild: () => false,
    reply: async (p) => { interaction.replied = true; replyCount++; return makeMsg(world.channel, world.botUser); },
    deferReply: async () => { interaction.deferred = true; return makeMsg(world.channel, world.botUser); },
    editReply: async () => { replyCount++; return makeMsg(world.channel, world.botUser); },
    followUp: async () => { replyCount++; return makeMsg(world.channel, world.botUser); },
    fetchReply: async () => makeMsg(world.channel, world.botUser),
    deleteReply: async () => {},
    showModal: async () => {},
    awaitModalSubmit: async () => makeModalInteraction(),
    respond: async () => {},
    toString: () => `</${command.data.name}:1>`,
  };
  return interaction;
}

function makeMessage(args) {
  const msg = makeMsg(world.channel, world.authorUser);
  msg.author = world.authorUser;
  msg.member = world.authorMember;
  msg.client = world.client;
  msg.content = `_cmd ${args.join(" ")}`;
  msg.mentions = makeMentions();
  msg.mentions.users.set(TARGET_ID, world.targetUser);
  msg.mentions.members.set(TARGET_ID, world.targetMember);
  return msg;
}

// ── Variant enumeration ─────────────────────────────────────────────────────

function commandJson(command) {
  if (typeof command.data?.toJSON === "function") return command.data.toJSON();
  return command.data ?? {};
}

function slashVariants(command) {
  const opts = commandJson(command).options ?? [];
  const leaf = opts.filter((o) => o.type !== 1 && o.type !== 2);
  const subs = opts.filter((o) => o.type === 1);
  const groups = opts.filter((o) => o.type === 2);
  const variants = [];
  if (!subs.length && !groups.length) {
    variants.push({ label: "slash", optionDefs: leaf });
  } else {
    for (const s of subs) {
      variants.push({ label: `slash:${s.name}`, sub: s.name, optionDefs: s.options ?? [] });
    }
    for (const g of groups) {
      for (const s of g.options ?? []) {
        variants.push({ label: `slash:${g.name} ${s.name}`, group: g.name, sub: s.name, optionDefs: s.options ?? [] });
      }
    }
    if (leaf.length) variants.push({ label: "slash:root", optionDefs: leaf });
  }
  return variants;
}

const PREFIX_PROFILES = [
  { label: "prefix:mention", args: ["<@222222222222222222>", "test", "10", "extra"] },
  { label: "prefix:number", args: ["10", "heads", "test", "extra"] },
  { label: "prefix:text", args: ["test", "10", "test2"] },
];

// ── Runner ──────────────────────────────────────────────────────────────────

const TIMEOUT_MS = 12_000;

function timeout(label) {
  return new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT after ${TIMEOUT_MS}ms`)), TIMEOUT_MS));
}

async function runOne(label, fn) {
  currentLabel = label;
  try {
    await Promise.race([fn(), timeout(label)]);
    if (VERBOSE) console.log(`  ok   ${label}`);
  } catch (err) {
    recordError("execute", err);
    console.log(`  ERR  ${label}\n       ${err?.name}: ${err?.message}`);
  }
}

async function main() {
  const commandsPath = join(ROOT, "src", "commands");
  const files = walkDirectory(commandsPath);
  const registry = [];
  const loadFailures = [];

  for (const file of files) {
    const category = relative(commandsPath, file).split(sep)[0] ?? "misc";
    try {
      const imported = await import(pathToFileURL(file).href);
      const root = imported.default;
      if (!root) continue;
      const commands = root.commands || (root.data?.name ? [root] : []);
      for (const command of commands) {
        if (!command?.data?.name) continue;
        command.category = category;
        command.__file = relative(ROOT, file);
        registry.push(command);
      }
    } catch (err) {
      loadFailures.push({ file: relative(ROOT, file), err });
      console.log(`LOAD-FAIL ${relative(ROOT, file)}: ${err?.name}: ${err?.message}`);
    }
  }

  for (const cmd of registry) {
    world.client.commands.set(cmd.data.name, cmd);
    if (cmd.prefixName ?? cmd.data?.name) world.client.prefixCommands.set(cmd.prefixName ?? cmd.data.name, cmd);
  }

  console.log(`\nLoaded ${registry.length} commands from ${files.length} files (${loadFailures.length} load failures)\n`);

  for (const command of registry) {
    if (typeof command.execute !== "function") {
      recordError("no-execute", new Error("command has no execute()"));
      console.log(`  ERR  ${command.data.name}: no execute()`);
      continue;
    }

    for (const variant of slashVariants(command)) {
      const entries = buildEntries(variant.optionDefs);
      const label = `/${command.data.name}${variant.sub ? ` ${variant.group ? variant.group + " " : ""}${variant.sub}` : ""}`;
      await runOne(label, async () => {
        const interaction = makeInteraction(command, entries, { sub: variant.sub, group: variant.group });
        const ctx = createCtx(interaction);
        await command.execute(ctx);
      });
    }

    for (const profile of PREFIX_PROFILES) {
      const label = `${command.prefixName ?? command.data.name} ${profile.label}`;
      await runOne(label, async () => {
        const message = makeMessage(profile.args);
        const ctx = createCtx(message, profile.args);
        await command.execute(ctx);
      });
    }
  }

  await new Promise((r) => setTimeout(r, 300)); // let queued collector errors land

  // ── Report ────────────────────────────────────────────────────────────────
  console.log("\n══════════════ RESULTS ══════════════\n");
  console.log(`Commands executed: ${registry.length}   Replies sent by mocks: ${replyCount}   Errors: ${errors.length}`);

  if (loadFailures.length) {
    console.log("\n-- LOAD FAILURES --");
    for (const f of loadFailures) console.log(`  ${f.file}: ${f.err?.name}: ${f.err?.message}`);
  }

  if (errors.length) {
    const seen = new Map();
    for (const e of errors) {
      const frame = e.stack.split("\n").map((l) => l.trim()).find((l) => l.startsWith("at ") && !l.includes("node_modules") && !l.includes("test-commands.mjs")) ?? "";
      const key = `${e.name}|${e.message}|${frame}`;
      if (!seen.has(key)) seen.set(key, { ...e, frame, labels: [] });
      seen.get(key).labels.push(e.label);
    }
    console.log("\n-- UNIQUE ERRORS --");
    let i = 0;
    for (const e of seen.values()) {
      i++;
      console.log(`\n#${i} [${e.kind}] ${e.name}: ${e.message}`);
      console.log(`   at: ${e.frame}`);
      console.log(`   hit by (${e.labels.length}): ${[...new Set(e.labels)].slice(0, 12).join(", ")}${e.labels.length > 12 ? " …" : ""}`);
      if (VERBOSE) console.log(`   stack: ${e.stack.split("\n").slice(0, 6).join("\n          ")}`);
    }
  } else {
    console.log("\nNo errors. 🎉");
  }

  try { unlinkSync(process.env.DB_PATH); } catch {}
  process.exit(errors.length || loadFailures.length ? 1 : 0);
}

await main();
