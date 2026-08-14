# HitoriChan Agent Notes

## Tech stack
- Node.js 24+ (uses built-in `node:sqlite`)
- discord.js 14
- ESM modules (`"type": "module"` in package.json)
- Local SQLite database at `data/hitorichan.db` (override with `DB_PATH`)

## Commands
- Start: `node index.js`
- Dev hot-reload: `npm run dev` (requires `nodemon` installed globally or in deps)
- Auto-deploy slash commands: restart the bot (only deploys when local commands differ)
- Force deploy all commands: `node src/scripts/deployCommands.js`
- Web dashboard: `http://0.0.0.0:3000` (starts with the bot; set `WEB_PORT` to change port)

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
- `CLIENT_ID` — Discord application ID (used for command deployment)
- `GUILD_ID` — optional test guild ID for instant guild command updates
- `GROQ_MODEL` — optional Groq model override
- `DB_PATH` — optional SQLite database path
- `WEB_PORT` — optional dashboard port (default `3000`)
- `PUBLIC_URL` — optional public URL (e.g. `https://hitori.wispbyte.org`) used for the console message
- `JWT_SECRET` — optional secret for dashboard session tokens
- `SKIP_AUTO_DEPLOY` — set to `true` to disable auto-deploy on startup

## Notes
- The bot auto-migrates the SQLite schema on startup.
- The `data/` directory is ignored by git.
- AI behavior can be customized per server with `/aiconfig prompt`.
- The dashboard initial login is `Admin` with a 6-digit password printed to console on startup.
- Put a `login-bg.webp` (or `.jpg`/`.png`) image in `src/web/public/assets/` to customize the login background.
