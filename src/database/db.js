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
  {
    version: 2,
    sql: `
      CREATE TABLE IF NOT EXISTS command_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT,
        channel_id TEXT,
        user_id TEXT NOT NULL,
        user_name TEXT,
        command_name TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'prefix',
        input TEXT,
        success INTEGER NOT NULL DEFAULT 1,
        error_message TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_command_logs_guild_created ON command_logs(guild_id, created_at);

      CREATE TABLE IF NOT EXISTS message_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        user_name TEXT,
        content TEXT,
        attachments TEXT DEFAULT '[]',
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_message_logs_guild_created ON message_logs(guild_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_message_logs_message_id ON message_logs(message_id);

      CREATE TABLE IF NOT EXISTS triggers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        keyword TEXT NOT NULL,
        command_name TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
        UNIQUE(guild_id, keyword)
      );
      CREATE INDEX IF NOT EXISTS idx_triggers_guild ON triggers(guild_id);
    `,
  },
  {
    version: 3,
    sql: `
      CREATE TABLE IF NOT EXISTS voice_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        joined_at INTEGER NOT NULL,
        left_at INTEGER,
        duration_seconds INTEGER,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_voice_sessions_lookup ON voice_sessions(guild_id, user_id, left_at);
      CREATE INDEX IF NOT EXISTS idx_voice_sessions_guild_created ON voice_sessions(guild_id, joined_at);
    `,
  },
  {
    version: 4,
    sql: `
      ALTER TABLE guild_settings ADD COLUMN primary_currency_emoji TEXT;
      ALTER TABLE guild_settings ADD COLUMN secondary_currency_emoji TEXT;
      ALTER TABLE guild_settings ADD COLUMN daily_min INTEGER DEFAULT 100;
      ALTER TABLE guild_settings ADD COLUMN daily_max INTEGER DEFAULT 500;
    `,
  },
  {
    version: 5,
    sql: `
      CREATE TABLE IF NOT EXISTS ticket_panels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'embed',
        title TEXT,
        description TEXT,
        color INTEGER,
        image_url TEXT,
        thumbnail_url TEXT,
        attachment_url TEXT,
        use_dominant_color INTEGER NOT NULL DEFAULT 0,
        button_label TEXT NOT NULL DEFAULT 'Create Ticket',
        button_color TEXT NOT NULL DEFAULT 'green',
        category_id TEXT,
        staff_role_id TEXT,
        transcript_channel_id TEXT,
        welcome_message TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
        UNIQUE(guild_id, name)
      );
      CREATE INDEX IF NOT EXISTS idx_ticket_panels_guild ON ticket_panels(guild_id);

      CREATE TABLE IF NOT EXISTS tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        panel_id INTEGER NOT NULL,
        channel_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
        closed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_tickets_guild_user ON tickets(guild_id, user_id, status);
      CREATE INDEX IF NOT EXISTS idx_tickets_panel ON tickets(panel_id);
    `,
  },
  {
    version: 6,
    sql: `
      ALTER TABLE ticket_panels ADD COLUMN fields TEXT;
      ALTER TABLE ticket_panels ADD COLUMN components TEXT;
      ALTER TABLE ticket_panels ADD COLUMN prefix TEXT;
    `,
  },
  {
    version: 7,
    sql: `
      CREATE TABLE IF NOT EXISTS shop_categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
        UNIQUE(guild_id, name)
      );
      CREATE INDEX IF NOT EXISTS idx_shop_categories_guild ON shop_categories(guild_id);

      CREATE TABLE IF NOT EXISTS shop_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        category_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        price INTEGER NOT NULL DEFAULT 0,
        price_secondary INTEGER,
        role_id TEXT,
        multiplier_type TEXT,
        multiplier_value REAL,
        special_commands TEXT DEFAULT '[]',
        stock INTEGER,
        max_purchases INTEGER,
        requires_role_id TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_shop_items_guild_category ON shop_items(guild_id, category_id);

      CREATE TABLE IF NOT EXISTS shop_purchases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        item_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_shop_purchases_guild_user ON shop_purchases(guild_id, user_id);

      ALTER TABLE economy_accounts ADD COLUMN earnings_multiplier REAL DEFAULT 1.0;
      ALTER TABLE economy_accounts ADD COLUMN level INTEGER DEFAULT 1;
      ALTER TABLE economy_accounts ADD COLUMN shop_item_ids TEXT DEFAULT '[]';
    `,
  },
  {
    version: 8,
    sql: `
      ALTER TABLE guild_settings ADD COLUMN shop_channel_id TEXT;
      ALTER TABLE guild_settings ADD COLUMN shop_message_id TEXT;
      ALTER TABLE guild_settings ADD COLUMN shop_interface_enabled INTEGER NOT NULL DEFAULT 1;
    `,
  },
  {
    version: 9,
    sql: `
      ALTER TABLE economy_accounts ADD COLUMN unlocked_commands TEXT DEFAULT '[]';

      CREATE TABLE IF NOT EXISTS boost_settings (
        guild_id TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 0,
        reward_primary INTEGER NOT NULL DEFAULT 0,
        reward_secondary INTEGER NOT NULL DEFAULT 0,
        role_id TEXT,
        earnings_multiplier REAL DEFAULT 0,
        level INTEGER DEFAULT 0,
        special_commands TEXT DEFAULT '[]',
        message_channel_id TEXT,
        thank_message TEXT,
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
      );
    `,
  },
  {
    version: 10,
    sql: `
      ALTER TABLE guild_settings ADD COLUMN shop_interface_components TEXT DEFAULT '[]';
    `,
  },
  {
    version: 11,
    sql: `
      ALTER TABLE guild_settings ADD COLUMN shop_interface_color INTEGER DEFAULT 16766720;
      ALTER TABLE guild_settings ADD COLUMN shop_interface_use_dominant_color INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    version: 12,
    sql: `
      ALTER TABLE tickets ADD COLUMN claimer_id TEXT;
      ALTER TABLE tickets ADD COLUMN archived_at INTEGER;
    `,
  },
  {
    version: 13,
    sql: `
      ALTER TABLE ticket_panels ADD COLUMN categories TEXT DEFAULT '[]';
      ALTER TABLE tickets ADD COLUMN category TEXT;
    `,
  },
  {
    version: 14,
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        permissions TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    `,
  },
  {
    version: 15,
    sql: `
      CREATE TABLE IF NOT EXISTS quests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        schedule TEXT NOT NULL DEFAULT 'once',
        dsl TEXT NOT NULL DEFAULT '',
        variables TEXT NOT NULL DEFAULT '{}',
        tasks TEXT NOT NULL DEFAULT '[]',
        reward_type TEXT,
        reward_value TEXT,
        reward_amount INTEGER,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_quests_guild ON quests(guild_id);
      CREATE TABLE IF NOT EXISTS quest_progress (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        quest_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        counters TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'in_progress',
        completed_at INTEGER,
        claimed_at INTEGER,
        last_reset_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
        FOREIGN KEY (quest_id) REFERENCES quests(id) ON DELETE CASCADE,
        UNIQUE(quest_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_quest_progress_quest ON quest_progress(quest_id);
      CREATE INDEX IF NOT EXISTS idx_quest_progress_user ON quest_progress(user_id);
    `,
  },
  {
    version: 16,
    sql: `
      ALTER TABLE quests ADD COLUMN condition TEXT DEFAULT '[]';
    `,
  },
  {
    version: 17,
    sql: `
      ALTER TABLE quests ADD COLUMN completion_message TEXT DEFAULT '{}';
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
