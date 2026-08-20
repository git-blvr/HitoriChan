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
};

const getStmt = db.prepare("SELECT * FROM guild_settings WHERE guild_id = ?");

const upsertStmt = db.prepare(`
  INSERT INTO guild_settings (
    guild_id, prefix,
    primary_currency_name, primary_currency_symbol, primary_currency_emoji,
    secondary_currency_name, secondary_currency_symbol, secondary_currency_emoji,
    daily_min, daily_max, shop_channel_id, shop_message_id, shop_interface_enabled
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    shop_interface_enabled = excluded.shop_interface_enabled
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
    DEFAULTS.shopInterfaceEnabled ? 1 : 0
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
    values.shopInterfaceEnabled !== undefined ? (values.shopInterfaceEnabled ? 1 : 0) : (current.shopInterfaceEnabled ? 1 : 0)
  );
  return fromRow(getStmt.get(guildId));
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
  });
}

export default { get, getOrCreate, save, setPrefix, setCurrencies, setEconomy, setShop };
