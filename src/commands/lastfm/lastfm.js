import { SlashCommandBuilder } from "discord.js";
import { cv2 } from "../../helpers/cv2.js";
import { embErr, embWrn } from "../../helpers/embeds.js";
import { getPrefix, DEFAULT_PREFIX } from "../../utils/prefixManager.js";
import { get_dominant_color } from "../../utils/color_utils.js";
import * as LastfmUser from "../../models/LastfmUser.js";
import * as fm from "../../utils/lastfm.js";

const PROFILE_URL = (u) => `https://www.last.fm/user/${encodeURIComponent(u)}`;
const ARTIST_URL = (a) => `https://www.last.fm/music/${encodeURIComponent(a)}`;

const SUB_ALIASES = new Map([
  ["set", "set"], ["login", "set"],
  ["unset", "unset"], ["remove", "unset"], ["logout", "unset"],
  ["np", "nowplaying"], ["nowplaying", "nowplaying"], ["now", "nowplaying"], ["playing", "nowplaying"],
  ["recent", "recent"], ["recenttracks", "recent"], ["rt", "recent"],
  ["profile", "profile"], ["me", "profile"], ["stats", "profile"], ["userinfo", "profile"],
  ["topartists", "topartists"], ["ta", "topartists"], ["artists", "topartists"],
  ["toptracks", "toptracks"], ["tt", "toptracks"], ["tracks", "toptracks"],
  ["topalbums", "topalbums"], ["tab", "topalbums"], ["tlb", "topalbums"], ["albums", "topalbums"],
  ["artist", "artist"],
  ["track", "track"], ["song", "track"],
  ["album", "album"],
  ["whoknows", "whoknows"], ["wk", "whoknows"], ["w", "whoknows"],
  ["whoknowstrack", "whoknowstrack"], ["wkt", "whoknowstrack"],
  ["whoknowsalbum", "whoknowsalbum"], ["wka", "whoknowsalbum"],
  ["help", "help"],
]);

const HANDLERS = {
  set: cmdSet,
  unset: cmdUnset,
  nowplaying: cmdNowPlaying,
  recent: cmdRecent,
  profile: cmdProfile,
  topartists: (ctx, args) => cmdTop(ctx, args, "artists"),
  toptracks: (ctx, args) => cmdTop(ctx, args, "tracks"),
  topalbums: (ctx, args) => cmdTop(ctx, args, "albums"),
  artist: cmdArtist,
  track: cmdTrack,
  album: cmdAlbum,
  whoknows: (ctx, args) => cmdWhoknows(ctx, args, "artist"),
  whoknowstrack: (ctx, args) => cmdWhoknows(ctx, args, "track"),
  whoknowsalbum: (ctx, args) => cmdWhoknows(ctx, args, "album"),
  help: cmdHelp,
};

async function runSub(ctx, sub, args) {
  if (!fm.isConfigured()) {
    await ctx.editReply(embErr("Last.fm isn't configured on this bot yet."));
    return;
  }
  const handler = HANDLERS[sub];
  if (!handler) {
    await ctx.editReply(embWrn(usageText(await guildPrefix(ctx))));
    return;
  }
  try {
    await handler(ctx, args);
  } catch (err) {
    if (!(err instanceof fm.LastfmError)) console.error(`[lastfm] ${sub} failed:`, err);
    await ctx.editReply(embErr(fm.describeError(err)));
  }
}

async function dispatchPrefix(ctx) {
  const first = ctx.args?.[0]?.toLowerCase();
  const sub = SUB_ALIASES.get(first);
  if (!sub) return runSub(ctx, "nowplaying", ctx.args ?? []);
  return runSub(ctx, sub, (ctx.args ?? []).slice(1));
}

async function dispatchSlash(ctx) {
  const sub = ctx.source?.options?.getSubcommand?.() ?? "nowplaying";
  return runSub(ctx, sub, []);
}

async function guildPrefix(ctx) {
  return ctx.guild ? getPrefix(ctx.guild.id) : DEFAULT_PREFIX;
}

function usageText(prefix) {
  return [
    `Usage: \`${prefix}fm <subcommand> [args]\``,
    `\`${prefix}fm [@user]\` — now playing`,
    `\`${prefix}fm set <username>\` / \`${prefix}fm unset\` — link your account`,
    `\`${prefix}fm np\`, \`${prefix}fm recent\`, \`${prefix}fm profile\``,
    `\`${prefix}fm ta|tt|tab [@user] [period]\` — top artists / tracks / albums`,
    `\`${prefix}fm artist|track|album <name>\` — info lookups`,
    `\`${prefix}fm wk|wkt|wka [name]\` — who in this server knows it`,
    "Periods: `overall`, `7d`, `1m`, `3m`, `6m`, `12m`",
  ].join("\n");
}

async function cmdHelp(ctx) {
  await ctx.editReply(cv2({
    color: fm.LASTFM_COLOR,
    title: "Last.fm commands",
    description: usageText(await guildPrefix(ctx)),
  }));
}

// ── Account linking ──────────────────────────────────────────────────────────

async function cmdSet(ctx, args) {
  const username = ctx.isInteraction ? ctx.source.options.getString("username") : args[0];
  if (!username) return ctx.editReply(embWrn("Usage: `fm set <last.fm username>`"));
  if (!fm.USERNAME_PATTERN.test(username)) {
    return ctx.editReply(embErr("That doesn't look like a valid Last.fm username."));
  }

  let info;
  try {
    info = await fm.getUserInfo(username);
  } catch (err) {
    return ctx.editReply(embErr(fm.describeError(err, "that Last.fm user")));
  }

  const name = info.user?.name ?? username;
  await LastfmUser.set(ctx.user.id, name);
  const scrobbles = Number(info.user?.playcount ?? 0).toLocaleString();
  return ctx.editReply(cv2({
    color: fm.LASTFM_COLOR,
    description: `Linked your account to ${fm.link(name, info.user?.url)} — **${scrobbles}** scrobbles.`,
  }));
}

async function cmdUnset(ctx) {
  const existing = await LastfmUser.get(ctx.user.id);
  if (!existing) return ctx.editReply(embWrn("You don't have a Last.fm account linked."));
  await LastfmUser.remove(ctx.user.id);
  return ctx.editReply(cv2({ color: fm.LASTFM_COLOR, description: "Your Last.fm account has been unlinked." }));
}

// ── Now playing / recent / profile ───────────────────────────────────────────

async function cmdNowPlaying(ctx, args) {
  const r = await fm.resolveFmTarget(ctx, args);
  if (r.error) return ctx.editReply(embErr(r.error));

  const [recent, info] = await Promise.all([
    fm.getRecentTracks(r.username, 1),
    fm.getUserInfo(r.username).catch(() => null),
  ]);
  const track = fm.asArray(recent?.recenttracks?.track)[0];
  if (!track) {
    return ctx.editReply(embWrn(`**${fm.mdEscape(r.username)}** hasn't scrobbled anything yet.`));
  }

  const artist = fm.entityName(track.artist);
  const album = fm.entityName(track.album);
  const nowPlaying = track["@attr"]?.nowplaying === "true";
  const uts = Number(track.date?.uts) || null;

  const trackInfo = await fm.getTrackInfo(artist, track.name, r.username).catch(() => null);
  const artistName = fm.entityName(trackInfo?.artist) || artist;
  const albumName = fm.entityName(trackInfo?.album) || album;
  const image = fm.pickImage(track.image) ?? fm.pickImage(trackInfo?.album?.image);

  const status = nowPlaying
    ? "🎧 *Now playing*"
    : uts ? `Last scrobbled <t:${uts}:R>` : "Last scrobbled";

  const lines = [`**[${fm.mdEscape(track.name)}](${track.url ?? "#"})**`, `by ${fm.link(artistName, trackInfo?.artist?.url ?? ARTIST_URL(artistName))}`];
  if (albumName) lines.push(`on ${fm.link(albumName, trackInfo?.album?.url ?? `${ARTIST_URL(artistName)}/${encodeURIComponent(albumName)}`)}`);

  const fields = [];
  const userPlays = Number(trackInfo?.userplaycount);
  if (Number.isFinite(userPlays) && userPlays > 0) fields.push({ name: "Your plays", value: userPlays.toLocaleString(), inline: true });
  if (track.loved === "1" || trackInfo?.loved === "1") fields.push({ name: "Loved", value: "❤️", inline: true });
  const listeners = Number(trackInfo?.listeners);
  if (Number.isFinite(listeners) && listeners > 0) fields.push({ name: "Listeners", value: listeners.toLocaleString(), inline: true });

  const totalScrobbles = Number(info?.user?.playcount ?? 0);

  let color = fm.LASTFM_COLOR;
  if (image) color = await get_dominant_color(image).catch(() => fm.LASTFM_COLOR);

  return ctx.editReply(cv2({
    color,
    title: `${r.discordUser?.displayName ?? r.username} — last.fm/${r.username}`,
    url: PROFILE_URL(r.username),
    thumbnail: r.discordUser?.displayAvatarURL?.({ size: 64 }) ?? null,
    description: `${status}\n${lines.join("\n")}`,
    fields,
    image,
    footer: totalScrobbles ? { text: `${totalScrobbles.toLocaleString()} total scrobbles` } : null,
  }));
}

async function cmdRecent(ctx, args) {
  const r = await fm.resolveFmTarget(ctx, args);
  if (r.error) return ctx.editReply(embErr(r.error));

  const data = await fm.getRecentTracks(r.username, 10);
  const tracks = fm.asArray(data?.recenttracks?.track);
  if (!tracks.length) {
    return ctx.editReply(embWrn(`**${fm.mdEscape(r.username)}** hasn't scrobbled anything yet.`));
  }

  const lines = tracks.map((t, i) => {
    const np = t["@attr"]?.nowplaying === "true";
    const when = np ? "🎧 *now*" : t.date?.uts ? `<t:${t.date.uts}:R>` : "";
    const artist = fm.entityName(t.artist);
    return `${i + 1}. **[${fm.mdEscape(t.name)}](${t.url ?? "#"})** — ${fm.mdEscape(artist)} ${when}`;
  });

  return ctx.editReply(cv2({
    color: fm.LASTFM_COLOR,
    title: `${r.username} — recent tracks`,
    url: `${PROFILE_URL(r.username)}/library`,
    description: lines.join("\n"),
    footer: { text: `${data?.recenttracks?.["@attr"]?.total ?? "?"} total scrobbles` },
  }));
}

async function cmdProfile(ctx, args) {
  const r = await fm.resolveFmTarget(ctx, args);
  if (r.error) return ctx.editReply(embErr(r.error));

  let info;
  try {
    info = await fm.getUserInfo(r.username);
  } catch (err) {
    return ctx.editReply(embErr(fm.describeError(err, "that Last.fm user")));
  }
  const u = info.user ?? {};

  const fields = [
    { name: "Scrobbles", value: Number(u.playcount ?? 0).toLocaleString(), inline: true },
    { name: "Artists", value: Number(u.artist_count ?? 0).toLocaleString(), inline: true },
    { name: "Albums", value: Number(u.album_count ?? 0).toLocaleString(), inline: true },
    { name: "Tracks", value: Number(u.track_count ?? 0).toLocaleString(), inline: true },
    { name: "Registered", value: u.registered?.unixtime ? `<t:${u.registered.unixtime}:D>` : "Unknown", inline: true },
  ];
  if (u.country) fields.push({ name: "Country", value: u.country, inline: true });

  return ctx.editReply(cv2({
    color: fm.LASTFM_COLOR,
    title: u.name ?? r.username,
    url: u.url ?? PROFILE_URL(r.username),
    description: u.realname ? `*${fm.mdEscape(u.realname)}*` : null,
    thumbnail: fm.pickImage(u.image),
    fields,
    footer: { text: `last.fm/user/${r.username}` },
  }));
}

// ── Top charts ───────────────────────────────────────────────────────────────

async function cmdTop(ctx, args, kind) {
  let period = "overall";
  let rawUser = null;

  if (ctx.isInteraction) {
    period = ctx.source.options.getString("period") ?? "overall";
  } else {
    for (const arg of args) {
      const p = fm.parsePeriod(arg);
      if (p) period = p;
      else if (!rawUser) rawUser = arg;
    }
  }

  const r = await fm.resolveFmTarget(ctx, rawUser ? [rawUser] : []);
  if (r.error) return ctx.editReply(embErr(r.error));

  const fetcher = kind === "artists" ? fm.getTopArtists : kind === "tracks" ? fm.getTopTracks : fm.getTopAlbums;
  const data = await fetcher(r.username, period, 10);
  const singular = kind.slice(0, -1); // artist / track / album
  const items = fm.asArray(data?.[`top${kind}`]?.[singular]);

  if (!items.length) {
    return ctx.editReply(embWrn(`No ${kind} found for **${fm.mdEscape(r.username)}** in that period.`));
  }

  const lines = items.map((item, i) => {
    const sub = singular !== "artist" ? ` — ${fm.mdEscape(fm.entityName(item.artist))}` : "";
    return `${i + 1}. **[${fm.mdEscape(item.name)}](${item.url ?? "#"})**${sub} — ${fm.fmtPlays(item.playcount)}`;
  });

  return ctx.editReply(cv2({
    color: fm.LASTFM_COLOR,
    title: `${r.username} — top ${kind}`,
    url: `${PROFILE_URL(r.username)}/library/${kind}`,
    description: lines.join("\n"),
    footer: { text: fm.periodLabel(period) },
  }));
}

// ── Entity info ──────────────────────────────────────────────────────────────

async function callerLink(ctx) {
  return (await LastfmUser.get(ctx.user.id))?.username ?? null;
}

async function cmdArtist(ctx, args) {
  const name = ctx.isInteraction ? ctx.source.options.getString("name") : args.join(" ");
  if (!name) return ctx.editReply(embWrn("Usage: `fm artist <name>`"));

  const info = await fm.getArtistInfo(name, await callerLink(ctx));
  const a = info.artist ?? {};
  const stats = a.stats ?? {};

  const fields = [
    { name: "Listeners", value: Number(stats.listeners ?? 0).toLocaleString(), inline: true },
    { name: "Global plays", value: Number(stats.playcount ?? 0).toLocaleString(), inline: true },
  ];
  const yourPlays = Number(stats.userplaycount);
  if (Number.isFinite(yourPlays) && yourPlays > 0) fields.push({ name: "Your plays", value: yourPlays.toLocaleString(), inline: true });

  const tags = fm.tagLine(a.tags?.tag);
  const similar = fm.asArray(a.similar?.artist).slice(0, 5).map((s) => fm.link(s.name, s.url)).join(", ");

  return ctx.editReply(cv2({
    color: fm.LASTFM_COLOR,
    title: a.name ?? name,
    url: a.url ?? ARTIST_URL(name),
    description: [tags, similar ? `Similar: ${similar}` : null].filter(Boolean).join("\n") || null,
    fields,
    image: fm.pickImage(a.image),
  }));
}

/** Returns { artist, title } for track/album lookups, searching when artist missing. */
async function resolveEntity(ctx, type, rawName, rawArtist) {
  let artist = rawArtist;
  let title = rawName;
  if (!artist) {
    const split = fm.splitArtistTitle(rawName);
    artist = split.artist;
    title = split.title;
  }
  if (!title) return {};
  if (!artist) {
    const hit = type === "track" ? await fm.searchTrack(title) : await fm.searchAlbum(title);
    if (!hit) return { artist: null, title };
    artist = fm.entityName(hit.artist);
    title = hit.name ?? title;
  }
  return { artist, title };
}

async function cmdTrack(ctx, args) {
  const rawName = ctx.isInteraction ? ctx.source.options.getString("name") : args.join(" ");
  const rawArtist = ctx.isInteraction ? ctx.source.options.getString("artist") : null;
  const { artist, title } = await resolveEntity(ctx, "track", rawName, rawArtist);
  if (!title) return ctx.editReply(embWrn("Usage: `fm track <artist - title>`"));
  if (!artist) return ctx.editReply(embErr("Couldn't find that track on Last.fm — try `artist - title`."));

  const info = await fm.getTrackInfo(artist, title, await callerLink(ctx));
  const t = info.track ?? {};

  const duration = Number(t.duration);
  const fields = [
    { name: "Artist", value: fm.link(fm.entityName(t.artist) || artist, t.artist?.url), inline: true },
    t.album?.title ? { name: "Album", value: fm.link(t.album.title, t.album.url), inline: true } : null,
    Number.isFinite(duration) && duration > 0 ? { name: "Duration", value: `${Math.floor(duration / 60000)}:${String(Math.floor(duration / 1000) % 60).padStart(2, "0")}`, inline: true } : null,
    { name: "Listeners", value: Number(t.listeners ?? 0).toLocaleString(), inline: true },
    { name: "Global plays", value: Number(t.playcount ?? 0).toLocaleString(), inline: true },
  ].filter(Boolean);
  const yourPlays = Number(t.userplaycount);
  if (Number.isFinite(yourPlays) && yourPlays > 0) fields.push({ name: "Your plays", value: yourPlays.toLocaleString(), inline: true });
  if (t.loved === "1") fields.push({ name: "Loved", value: "❤️", inline: true });

  return ctx.editReply(cv2({
    color: fm.LASTFM_COLOR,
    title: t.name ?? title,
    url: t.url,
    description: fm.tagLine(t.toptags?.tag ?? t.tags?.tag),
    fields,
    image: fm.pickImage(t.album?.image),
  }));
}

async function cmdAlbum(ctx, args) {
  const rawName = ctx.isInteraction ? ctx.source.options.getString("name") : args.join(" ");
  const rawArtist = ctx.isInteraction ? ctx.source.options.getString("artist") : null;
  const { artist, title } = await resolveEntity(ctx, "album", rawName, rawArtist);
  if (!title) return ctx.editReply(embWrn("Usage: `fm album <artist - title>`"));
  if (!artist) return ctx.editReply(embErr("Couldn't find that album on Last.fm — try `artist - title`."));

  const info = await fm.getAlbumInfo(artist, title, await callerLink(ctx));
  const a = info.album ?? {};

  const trackCount = fm.asArray(a.tracks?.track).length;
  const fields = [
    { name: "Artist", value: fm.link(fm.entityName(a.artist) || artist, ARTIST_URL(fm.entityName(a.artist) || artist)), inline: true },
    { name: "Listeners", value: Number(a.listeners ?? 0).toLocaleString(), inline: true },
    { name: "Global plays", value: Number(a.playcount ?? 0).toLocaleString(), inline: true },
    trackCount ? { name: "Tracks", value: String(trackCount), inline: true } : null,
  ].filter(Boolean);
  const yourPlays = Number(a.userplaycount);
  if (Number.isFinite(yourPlays) && yourPlays > 0) fields.push({ name: "Your plays", value: yourPlays.toLocaleString(), inline: true });

  return ctx.editReply(cv2({
    color: fm.LASTFM_COLOR,
    title: a.name ?? title,
    url: a.url,
    description: fm.tagLine(a.tags?.tag),
    fields,
    image: fm.pickImage(a.image),
  }));
}

// ── Who knows ────────────────────────────────────────────────────────────────

async function cmdWhoknows(ctx, args, type) {
  if (!ctx.guild) return ctx.editReply(embErr("This command only works in a server."));

  let name = ctx.isInteraction ? ctx.source.options.getString("name") : null;
  let artist = null;

  if (!ctx.isInteraction) {
    const joined = args.join(" ").trim();
    if (joined) {
      if (type === "artist") name = joined;
      else ({ artist, title: name } = fm.splitArtistTitle(joined));
    }
  }

  if (!name) {
    const link = await LastfmUser.get(ctx.user.id);
    if (!link) return ctx.editReply(embWrn("Link your account first (`fm set <username>`) or provide a name."));
    const recent = await fm.getRecentTracks(link.username, 1);
    const t = fm.asArray(recent?.recenttracks?.track)[0];
    if (!t) return ctx.editReply(embWrn("You haven't scrobbled anything yet."));
    if (type === "artist") name = fm.entityName(t.artist);
    else {
      artist = fm.entityName(t.artist);
      name = type === "track" ? t.name : fm.entityName(t.album);
      if (!name) return ctx.editReply(embWrn(`Your current track has no ${type} tag — provide a name.`));
    }
  }

  // Fill in a missing artist for track/album lookups via search.
  if (type !== "artist" && !artist) {
    const hit = type === "track" ? await fm.searchTrack(name) : await fm.searchAlbum(name);
    if (!hit) return ctx.editReply(embErr(`Couldn't find that ${type} on Last.fm.`));
    artist = fm.entityName(hit.artist);
    name = hit.name ?? name;
  }

  const fetchPlaycount = async (username) => {
    if (type === "artist") return fm.getArtistInfo(name, username);
    if (type === "track") return fm.getTrackInfo(artist, name, username);
    return fm.getAlbumInfo(artist, name, username);
  };

  const members = await fm.resolveGuildLinked(ctx);
  if (!members.length) {
    return ctx.editReply(embWrn("Nobody in this server has linked Last.fm yet — `fm set <username>`."));
  }

  const results = await fm.mapPool(members, async ({ member, username }) => {
    const info = await fetchPlaycount(username);
    const entity = info?.artist ?? info?.track ?? info?.album ?? {};
    const plays = Number(entity?.stats?.userplaycount ?? entity?.userplaycount ?? 0) || 0;
    return { member, username, plays, entity };
  }, 4);

  const found = results.filter((r) => r?.entity && Object.keys(r.entity).length);
  const canon = found[0]?.entity;
  const displayName = fm.entityName(canon) || name;
  const canonArtist = type === "artist" ? null : fm.entityName(canon?.artist) || artist;

  const ranked = results.filter((r) => r && r.plays > 0).sort((a, b) => b.plays - a.plays);

  const heading = canonArtist ? `${fm.mdEscape(displayName)} by ${fm.mdEscape(canonArtist)}` : fm.mdEscape(displayName);
  if (!ranked.length) {
    return ctx.editReply(cv2({
      color: fm.LASTFM_COLOR,
      title: `Who knows ${heading}`,
      description: `Nobody in this server has scrobbled ${heading} yet.`,
      footer: { text: `${members.length} linked member${members.length === 1 ? "" : "s"}` },
    }));
  }

  const lines = ranked.slice(0, 10).map((r, i) => {
    const display = r.member?.displayName ?? r.member?.user?.username ?? r.username;
    const crown = i === 0 ? "👑 " : "";
    return `${crown}${i + 1}. **${fm.mdEscape(display)}** — ${fm.fmtPlays(r.plays)}`;
  });

  return ctx.editReply(cv2({
    color: fm.LASTFM_COLOR,
    title: `Who knows ${heading}`,
    description: lines.join("\n"),
    footer: { text: `${ranked.length}/${members.length} linked members have scrobbled it` },
  }));
}

// ── Command definitions ──────────────────────────────────────────────────────

const userOption = (o) => o.setName("user").setDescription("Discord user or Last.fm username (defaults to you)").setRequired(false);
const periodOption = (o) => o.setName("period").setDescription("Time period").setRequired(false).addChoices(...fm.PERIOD_CHOICES);
const nameOption = (desc) => (o) => o.setName("name").setDescription(desc).setRequired(true);
const optNameOption = (desc) => (o) => o.setName("name").setDescription(desc).setRequired(false);
const artistOption = (o) => o.setName("artist").setDescription("Artist name (optional)").setRequired(false);

const lastfmCommand = {
  data: new SlashCommandBuilder()
    .setName("lastfm")
    .setDescription("Last.fm scrobble commands")
    .addSubcommand((s) => s.setName("set").setDescription("Link your Last.fm account")
      .addStringOption((o) => o.setName("username").setDescription("Your Last.fm username").setRequired(true)))
    .addSubcommand((s) => s.setName("unset").setDescription("Unlink your Last.fm account"))
    .addSubcommand((s) => s.setName("nowplaying").setDescription("Show the current or most recent track").addUserOption(userOption))
    .addSubcommand((s) => s.setName("recent").setDescription("Show the last 10 scrobbled tracks").addUserOption(userOption))
    .addSubcommand((s) => s.setName("profile").setDescription("Show a Last.fm profile").addUserOption(userOption))
    .addSubcommand((s) => s.setName("topartists").setDescription("Top artists").addUserOption(userOption).addStringOption(periodOption))
    .addSubcommand((s) => s.setName("toptracks").setDescription("Top tracks").addUserOption(userOption).addStringOption(periodOption))
    .addSubcommand((s) => s.setName("topalbums").setDescription("Top albums").addUserOption(userOption).addStringOption(periodOption))
    .addSubcommand((s) => s.setName("artist").setDescription("Look up an artist").addStringOption(nameOption("Artist name")))
    .addSubcommand((s) => s.setName("track").setDescription("Look up a track")
      .addStringOption(nameOption("Track name")).addStringOption(artistOption))
    .addSubcommand((s) => s.setName("album").setDescription("Look up an album")
      .addStringOption(nameOption("Album name")).addStringOption(artistOption))
    .addSubcommand((s) => s.setName("whoknows").setDescription("Who in this server listens to an artist")
      .addStringOption(optNameOption("Artist (defaults to your current track)")))
    .addSubcommand((s) => s.setName("whoknowstrack").setDescription("Who in this server listens to a track")
      .addStringOption(optNameOption("Track or 'artist - track'")))
    .addSubcommand((s) => s.setName("whoknowsalbum").setDescription("Who in this server listens to an album")
      .addStringOption(optNameOption("Album or 'artist - album'"))),
  prefixName: "lastfm",
  aliases: ["lfm"],
  syntax: "{prefix}lastfm <subcommand> [args]",
  example: "{prefix}lastfm toptracks 7d",
  async execute(ctx) {
    if (ctx.isInteraction) {
      await ctx.deferReply();
      return dispatchSlash(ctx);
    }
    return dispatchPrefix(ctx);
  },
};

const fmCommand = {
  data: new SlashCommandBuilder()
    .setName("fm")
    .setDescription("Show what you're listening to right now (Last.fm)")
    .addUserOption((o) => o.setName("user").setDescription("Discord user (defaults to you)").setRequired(false)),
  prefixName: "fm",
  syntax: "{prefix}fm [@user|username|subcommand]",
  example: "{prefix}fm",
  async execute(ctx) {
    if (ctx.isInteraction) {
      await ctx.deferReply();
      return runSub(ctx, "nowplaying", []);
    }
    return dispatchPrefix(ctx);
  },
};

export default { commands: [lastfmCommand, fmCommand] };
