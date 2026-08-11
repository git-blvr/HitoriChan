import { DatabaseSync } from "node:sqlite";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync, mkdirSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB_PATH = join(__dirname, "..", "..", "data", "hitorichan.db");

const dbPath = process.env.DB_PATH || DEFAULT_DB_PATH;
const dataDir = dirname(dbPath);

if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}

export const db = new DatabaseSync(dbPath);

db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");
db.exec("PRAGMA busy_timeout = 5000;");

const MIGRATIONS = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS guild_settings (
        guild_id TEXT PRIMARY KEY,
        prefix TEXT NOT NULL DEFAULT '_',
        primary_currency_name TEXT NOT NULL DEFAULT 'Starry Coins',
        primary_currency_symbol TEXT NOT NULL DEFAULT 'coins ',
        secondary_currency_name TEXT NOT NULL DEFAULT 'FOLTs',
        secondary_currency_symbol TEXT NOT NULL DEFAULT 'folts '
      );

      CREATE TABLE IF NOT EXISTS ai_settings (
        guild_id TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 0,
        mode TEXT NOT NULL DEFAULT 'everywhere',
        channel_id TEXT,
        custom_prompt TEXT
      );

      CREATE TABLE IF NOT EXISTS message_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        messages TEXT NOT NULL DEFAULT '[]',
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
        UNIQUE(user_id, guild_id, channel_id)
      );
      CREATE INDEX IF NOT EXISTS idx_message_history_lookup ON message_history(user_id, guild_id, channel_id);

      CREATE TABLE IF NOT EXISTS economy_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        primary_balance INTEGER NOT NULL DEFAULT 0,
        secondary_balance INTEGER NOT NULL DEFAULT 0,
        last_daily INTEGER,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
        UNIQUE(guild_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_economy_accounts_guild_user ON economy_accounts(guild_id, user_id);

      CREATE TABLE IF NOT EXISTS streak_settings (
        guild_id TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 0,
        track_channel_id TEXT,
        notify_channel_id TEXT
      );

      CREATE TABLE IF NOT EXISTS streak_profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        current_streak INTEGER NOT NULL DEFAULT 0,
        longest_streak INTEGER NOT NULL DEFAULT 0,
        last_streak_date INTEGER,
        total_days INTEGER NOT NULL DEFAULT 0,
        daily_message_count INTEGER NOT NULL DEFAULT 0,
        daily_message_date TEXT,
        UNIQUE(user_id, guild_id)
      );
      CREATE INDEX IF NOT EXISTS idx_streak_profiles_lookup ON streak_profiles(user_id, guild_id);

      CREATE TABLE IF NOT EXISTS moderation_settings (
        guild_id TEXT PRIMARY KEY,
        log_channel_id TEXT,
        mod_role_id TEXT
      );

      CREATE TABLE IF NOT EXISTS moderation_cases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        case_id TEXT NOT NULL UNIQUE,
        guild_id TEXT NOT NULL,
        action TEXT NOT NULL,
        moderator_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        reason TEXT NOT NULL DEFAULT 'No reason provided',
        attachment TEXT,
        duration INTEGER,
        active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_moderation_cases_lookup ON moderation_cases(guild_id, target_id, active);
    `,
  },
];

export function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
    );
  `);

  const getVersion = db.prepare("SELECT 1 FROM schema_migrations WHERE version = ?");
  const setVersion = db.prepare("INSERT INTO schema_migrations (version) VALUES (?)");

  for (const { version, sql } of MIGRATIONS) {
    const exists = getVersion.get(version);
    if (!exists) {
      db.exec(sql);
      setVersion.run(version);
      console.log(`Applied database migration v${version}`);
    }
  }
}

export function closeDatabase() {
  db.close();
}

migrate();
