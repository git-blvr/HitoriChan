import { db } from "../database/db.js";

const DEFAULTS = {
  guildId: null,
  prefix: "_",
  primaryCurrency: { name: "Starry Coins", symbol: "coins " },
  secondaryCurrency: { name: "FOLTs", symbol: "folts " },
};

const getStmt = db.prepare("SELECT * FROM guild_settings WHERE guild_id = ?");

const upsertStmt = db.prepare(`
  INSERT INTO guild_settings (
    guild_id, prefix,
    primary_currency_name, primary_currency_symbol,
    secondary_currency_name, secondary_currency_symbol
  ) VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(guild_id) DO UPDATE SET
    prefix = excluded.prefix,
    primary_currency_name = excluded.primary_currency_name,
    primary_currency_symbol = excluded.primary_currency_symbol,
    secondary_currency_name = excluded.secondary_currency_name,
    secondary_currency_symbol = excluded.secondary_currency_symbol
`);

function fromRow(row) {
  if (!row) return null;
  return {
    guildId: row.guild_id,
    prefix: row.prefix,
    primaryCurrency: {
      name: row.primary_currency_name,
      symbol: row.primary_currency_symbol,
    },
    secondaryCurrency: {
      name: row.secondary_currency_name,
      symbol: row.secondary_currency_symbol,
    },
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
    DEFAULTS.secondaryCurrency.name,
    DEFAULTS.secondaryCurrency.symbol
  );
  return fromRow(getStmt.get(guildId));
}

export async function setPrefix(guildId, prefix) {
  const current = await getOrCreate(guildId);
  upsertStmt.run(
    guildId,
    prefix,
    current.primaryCurrency.name,
    current.primaryCurrency.symbol,
    current.secondaryCurrency.name,
    current.secondaryCurrency.symbol
  );
  return fromRow(getStmt.get(guildId));
}

export async function setCurrencies(guildId, values) {
  const current = await getOrCreate(guildId);
  const primaryName = values.primaryName ?? current.primaryCurrency.name;
  const primarySymbol = values.primarySymbol ?? current.primaryCurrency.symbol;
  const secondaryName = values.secondaryName ?? current.secondaryCurrency.name;
  const secondarySymbol = values.secondarySymbol ?? current.secondaryCurrency.symbol;

  upsertStmt.run(guildId, current.prefix, primaryName, primarySymbol, secondaryName, secondarySymbol);
  return fromRow(getStmt.get(guildId));
}

export default { get, getOrCreate, setPrefix, setCurrencies };
