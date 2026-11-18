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
- `WEB_HOST` — optional dashboard bind address (default `0.0.0.0`)
- `PUBLIC_URL` — optional public URL (e.g. `https://hitori.wispbyte.org`) used for the console message
- `DASHBOARD_PASSWORD` — optional persistent admin password (otherwise one is generated each boot and printed to console)
- `DASHBOARD_ORIGINS` — optional comma-separated extra allowed origins for dashboard API mutations
- `TLS_KEY_PATH` / `TLS_CERT_PATH` — optional; serve the dashboard over HTTPS
- `SKIP_AUTO_DEPLOY` — set to `true` to disable auto-deploy on startup

## Dashboard security notes
- Auth uses opaque, server-side sessions in `dashboard_sessions` (SHA-256 hashed tokens, sliding 24 h expiry, revocable). No JWT — logging out or editing a user invalidates sessions immediately.
- `/api` mutations are protected by an Origin/`Sec-Fetch-Site` CSRF guard; API responses are `Cache-Control: no-store`.
- CSP forbids inline scripts: never add `onclick=` or `<script>` blocks in HTML — use `data-action` + the delegated handler map in `dashboard.js` and external `.js` files.
- User-supplied image URLs are fetched through `src/utils/safeFetch.js` (SSRF guard).
- Security-sensitive activity is recorded in `audit_logs` (90-day retention).
- Protected pages live in `src/web/pages/` (not the static root). `src/web/public/` is public — never put authenticated content there.
- `npm test` runs `src/scripts/smokeWeb.js`, which boots the dashboard with a stub client + temp DB and exercises the auth surface.

## Notes
- The bot auto-migrates the SQLite schema on startup.
- The `data/` directory is ignored by git.
- AI behavior can be customized per server with `/aiconfig prompt`.
- The dashboard initial login is `Admin` with a 6-digit password printed to console on startup.
- Put a `login-bg.webp` (or `.jpg`/`.png`) image in `src/web/public/assets/` to customize the login background.
