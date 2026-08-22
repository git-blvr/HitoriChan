import { db } from "../database/db.js";

const DEFAULTS = {
  guildId: null,
  prefix: "_",
  primaryCurrency: { name: "Starry Coins", symbol: "coins ", emoji: null },
  secondaryCurrency: { name: "FOLTs", symbol: "folts ", emoji: null },
  dailyMin: 100,
  dailyMax: 500,
  shopChannelId: null,
  shopMessageId: null,
  shopInterfaceEnabled: true,
  shopInterfaceComponents: [],
  shopInterfaceColor: 0xffd700,
  shopInterfaceUseDominantColor: false,
  welcomeEnabled: false,
  welcomeChannelId: null,
  welcomeTitle: "Welcome!",
  welcomeDescription: "Welcome to the server, {user}!",
  welcomeColor: 0x8b5cf6,
  welcomeUseDominantColor: false,
  goodbyeEnabled: false,
  goodbyeChannelId: null,
  goodbyeTitle: "Goodbye!",
  goodbyeDescription: "Goodbye, {user}. We will miss you.",
  goodbyeColor: 0x8b5cf6,
  goodbyeUseDominantColor: false,
};

function parseJson(json) {
  if (!json) return [];
  try {
    return JSON.parse(json);
  } catch {
    return [];
  }
}

const getStmt = db.prepare("SELECT * FROM guild_settings WHERE guild_id = ?");

const upsertStmt = db.prepare(`
  INSERT INTO guild_settings (
    guild_id, prefix,
    primary_currency_name, primary_currency_symbol, primary_currency_emoji,
    secondary_currency_name, secondary_currency_symbol, secondary_currency_emoji,
    daily_min, daily_max, shop_channel_id, shop_message_id, shop_interface_enabled, shop_interface_components,
    shop_interface_color, shop_interface_use_dominant_color,
    welcome_enabled, welcome_channel_id, welcome_title, welcome_description, welcome_color, welcome_use_dominant_color,
    goodbye_enabled, goodbye_channel_id, goodbye_title, goodbye_description, goodbye_color, goodbye_use_dominant_color
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(guild_id) DO UPDATE SET
    prefix = excluded.prefix,
    primary_currency_name = excluded.primary_currency_name,
    primary_currency_symbol = excluded.primary_currency_symbol,
    primary_currency_emoji = excluded.primary_currency_emoji,
    secondary_currency_name = excluded.secondary_currency_name,
    secondary_currency_symbol = excluded.secondary_currency_symbol,
    secondary_currency_emoji = excluded.secondary_currency_emoji,
    daily_min = excluded.daily_min,
    daily_max = excluded.daily_max,
    shop_channel_id = excluded.shop_channel_id,
    shop_message_id = excluded.shop_message_id,
    shop_interface_enabled = excluded.shop_interface_enabled,
    shop_interface_components = excluded.shop_interface_components,
    shop_interface_color = excluded.shop_interface_color,
    shop_interface_use_dominant_color = excluded.shop_interface_use_dominant_color,
    welcome_enabled = excluded.welcome_enabled,
    welcome_channel_id = excluded.welcome_channel_id,
    welcome_title = excluded.welcome_title,
    welcome_description = excluded.welcome_description,
    welcome_color = excluded.welcome_color,
    welcome_use_dominant_color = excluded.welcome_use_dominant_color,
    goodbye_enabled = excluded.goodbye_enabled,
    goodbye_channel_id = excluded.goodbye_channel_id,
    goodbye_title = excluded.goodbye_title,
    goodbye_description = excluded.goodbye_description,
    goodbye_color = excluded.goodbye_color,
    goodbye_use_dominant_color = excluded.goodbye_use_dominant_color
`);

function fromRow(row) {
  if (!row) return null;
  return {
    guildId: row.guild_id,
    prefix: row.prefix,
    primaryCurrency: {
      name: row.primary_currency_name,
      symbol: row.primary_currency_symbol,
      emoji: row.primary_currency_emoji,
    },
    secondaryCurrency: {
      name: row.secondary_currency_name,
      symbol: row.secondary_currency_symbol,
      emoji: row.secondary_currency_emoji,
    },
    dailyMin: row.daily_min ?? DEFAULTS.dailyMin,
    dailyMax: row.daily_max ?? DEFAULTS.dailyMax,
    shopChannelId: row.shop_channel_id ?? DEFAULTS.shopChannelId,
    shopMessageId: row.shop_message_id ?? DEFAULTS.shopMessageId,
    shopInterfaceEnabled: row.shop_interface_enabled === undefined ? DEFAULTS.shopInterfaceEnabled : Boolean(row.shop_interface_enabled),
    shopInterfaceComponents: parseJson(row.shop_interface_components),
    shopInterfaceColor: row.shop_interface_color ?? DEFAULTS.shopInterfaceColor,
    shopInterfaceUseDominantColor: row.shop_interface_use_dominant_color === undefined ? DEFAULTS.shopInterfaceUseDominantColor : Boolean(row.shop_interface_use_dominant_color),
    welcomeEnabled: row.welcome_enabled === undefined ? DEFAULTS.welcomeEnabled : Boolean(row.welcome_enabled),
    welcomeChannelId: row.welcome_channel_id ?? DEFAULTS.welcomeChannelId,
    welcomeTitle: row.welcome_title ?? DEFAULTS.welcomeTitle,
    welcomeDescription: row.welcome_description ?? DEFAULTS.welcomeDescription,
    welcomeColor: row.welcome_color ?? DEFAULTS.welcomeColor,
    welcomeUseDominantColor: row.welcome_use_dominant_color === undefined ? DEFAULTS.welcomeUseDominantColor : Boolean(row.welcome_use_dominant_color),
    goodbyeEnabled: row.goodbye_enabled === undefined ? DEFAULTS.goodbyeEnabled : Boolean(row.goodbye_enabled),
    goodbyeChannelId: row.goodbye_channel_id ?? DEFAULTS.goodbyeChannelId,
    goodbyeTitle: row.goodbye_title ?? DEFAULTS.goodbyeTitle,
    goodbyeDescription: row.goodbye_description ?? DEFAULTS.goodbyeDescription,
    goodbyeColor: row.goodbye_color ?? DEFAULTS.goodbyeColor,
    goodbyeUseDominantColor: row.goodbye_use_dominant_color === undefined ? DEFAULTS.goodbyeUseDominantColor : Boolean(row.goodbye_use_dominant_color),
  };
}

export async function get(guildId) {
  return fromRow(getStmt.get(guildId));
}

export async function getOrCreate(guildId) {
  const existing = getStmt.get(guildId);
  if (existing) return fromRow(existing);

  upsertStmt.run(
    guildId,
    DEFAULTS.prefix,
    DEFAULTS.primaryCurrency.name,
    DEFAULTS.primaryCurrency.symbol,
    DEFAULTS.primaryCurrency.emoji,
    DEFAULTS.secondaryCurrency.name,
    DEFAULTS.secondaryCurrency.symbol,
    DEFAULTS.secondaryCurrency.emoji,
    DEFAULTS.dailyMin,
    DEFAULTS.dailyMax,
    DEFAULTS.shopChannelId,
    DEFAULTS.shopMessageId,
    DEFAULTS.shopInterfaceEnabled ? 1 : 0,
    JSON.stringify(DEFAULTS.shopInterfaceComponents),
    DEFAULTS.shopInterfaceColor,
    DEFAULTS.shopInterfaceUseDominantColor ? 1 : 0,
    DEFAULTS.welcomeEnabled ? 1 : 0,
    DEFAULTS.welcomeChannelId,
    DEFAULTS.welcomeTitle,
    DEFAULTS.welcomeDescription,
    DEFAULTS.welcomeColor,
    DEFAULTS.welcomeUseDominantColor ? 1 : 0,
    DEFAULTS.goodbyeEnabled ? 1 : 0,
    DEFAULTS.goodbyeChannelId,
    DEFAULTS.goodbyeTitle,
    DEFAULTS.goodbyeDescription,
    DEFAULTS.goodbyeColor,
    DEFAULTS.goodbyeUseDominantColor ? 1 : 0
  );
  return fromRow(getStmt.get(guildId));
}

export async function save(guildId, values) {
  const current = await getOrCreate(guildId);
  upsertStmt.run(
    guildId,
    values.prefix ?? current.prefix,
    values.primaryName ?? current.primaryCurrency.name,
    values.primarySymbol ?? current.primaryCurrency.symbol,
    values.primaryEmoji !== undefined ? values.primaryEmoji : current.primaryCurrency.emoji,
    values.secondaryName ?? current.secondaryCurrency.name,
    values.secondarySymbol ?? current.secondaryCurrency.symbol,
    values.secondaryEmoji !== undefined ? values.secondaryEmoji : current.secondaryCurrency.emoji,
    values.dailyMin !== undefined ? values.dailyMin : current.dailyMin,
    values.dailyMax !== undefined ? values.dailyMax : current.dailyMax,
    values.shopChannelId !== undefined ? values.shopChannelId : current.shopChannelId,
    values.shopMessageId !== undefined ? values.shopMessageId : current.shopMessageId,
    values.shopInterfaceEnabled !== undefined ? (values.shopInterfaceEnabled ? 1 : 0) : (current.shopInterfaceEnabled ? 1 : 0),
    JSON.stringify(values.shopInterfaceComponents !== undefined ? values.shopInterfaceComponents : current.shopInterfaceComponents),
    values.shopInterfaceColor !== undefined ? (values.shopInterfaceColor ?? DEFAULTS.shopInterfaceColor) : current.shopInterfaceColor,
    values.shopInterfaceUseDominantColor !== undefined ? (values.shopInterfaceUseDominantColor ? 1 : 0) : (current.shopInterfaceUseDominantColor ? 1 : 0),
    values.welcomeEnabled !== undefined ? (values.welcomeEnabled ? 1 : 0) : (current.welcomeEnabled ? 1 : 0),
    values.welcomeChannelId !== undefined ? (values.welcomeChannelId || null) : current.welcomeChannelId,
    values.welcomeTitle !== undefined ? (values.welcomeTitle ?? DEFAULTS.welcomeTitle) : current.welcomeTitle,
    values.welcomeDescription !== undefined ? (values.welcomeDescription ?? DEFAULTS.welcomeDescription) : current.welcomeDescription,
    values.welcomeColor !== undefined ? (values.welcomeColor ?? DEFAULTS.welcomeColor) : current.welcomeColor,
    values.welcomeUseDominantColor !== undefined ? (values.welcomeUseDominantColor ? 1 : 0) : (current.welcomeUseDominantColor ? 1 : 0),
    values.goodbyeEnabled !== undefined ? (values.goodbyeEnabled ? 1 : 0) : (current.goodbyeEnabled ? 1 : 0),
    values.goodbyeChannelId !== undefined ? (values.goodbyeChannelId || null) : current.goodbyeChannelId,
    values.goodbyeTitle !== undefined ? (values.goodbyeTitle ?? DEFAULTS.goodbyeTitle) : current.goodbyeTitle,
    values.goodbyeDescription !== undefined ? (values.goodbyeDescription ?? DEFAULTS.goodbyeDescription) : current.goodbyeDescription,
    values.goodbyeColor !== undefined ? (values.goodbyeColor ?? DEFAULTS.goodbyeColor) : current.goodbyeColor,
    values.goodbyeUseDominantColor !== undefined ? (values.goodbyeUseDominantColor ? 1 : 0) : (current.goodbyeUseDominantColor ? 1 : 0)
  );
  return fromRow(getStmt.get(guildId));
}

export async function setWelcomeGoodbye(guildId, values) {
  return save(guildId, values);
}

export async function setPrefix(guildId, prefix) {
  return save(guildId, { prefix });
}

export async function setCurrencies(guildId, values) {
  return save(guildId, {
    primaryName: values.primaryName,
    primarySymbol: values.primarySymbol,
    secondaryName: values.secondaryName,
    secondarySymbol: values.secondarySymbol,
  });
}

export async function setEconomy(guildId, values) {
  return save(guildId, values);
}

export async function setShop(guildId, values) {
  return save(guildId, {
    shopChannelId: values.shopChannelId,
    shopMessageId: values.shopMessageId,
    shopInterfaceEnabled: values.shopInterfaceEnabled,
    shopInterfaceComponents: values.shopInterfaceComponents,
    shopInterfaceColor: values.shopInterfaceColor,
    shopInterfaceUseDominantColor: values.shopInterfaceUseDominantColor,
  });
}

export default { get, getOrCreate, save, setPrefix, setCurrencies, setEconomy, setShop, setWelcomeGoodbye };
