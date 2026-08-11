# HitoriChan Agent Notes

## Tech stack
- Node.js 24+ (uses built-in `node:sqlite`)
- discord.js 14
- ESM modules (`"type": "module"` in package.json)
- Local SQLite database at `data/hitorichan.db` (override with `DB_PATH`)

## Commands
- Start: `node index.js`
- Dev hot-reload: `npm run dev` (requires `nodemon` installed globally or in deps)
- Deploy/re-register slash commands: restart the bot (handled in `src/events/ready.js`)

## Project structure
- `index.js` — bot entry point
- `src/database/db.js` — SQLite connection, schema, migrations
- `src/models/` — SQLite repository modules (replace Mongoose models)
- `src/commands/<category>/<command>.js` — slash + prefix commands
- `src/handlers/` — command/event/chat/streak loading
- `src/helpers/` — shared helper utilities
- `src/utils/` — older shared utilities (still used)

## Environment variables
- `TOKEN` — Discord bot token (required)
- `GROQ_API` — Groq API key (required for AI)
- `GROQ_MODEL` — optional Groq model override
- `DB_PATH` — optional SQLite database path

## Notes
- The bot auto-migrates the SQLite schema on startup.
- The `data/` directory is ignored by git.
- AI behavior can be customized per server with `/aiconfig prompt`.
