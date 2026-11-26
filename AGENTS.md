# HitoriChan Agent Notes

## Tech stack
- Node.js 24+ (uses built-in `node:sqlite`)
- discord.js 14
- ESM modules (`"type": "module"` in package.json)
- Local SQLite database at `data/hitorichan.db` (override with `DB_PATH`)

## Commands
- Start: `node index.js`
- Build Rust native module: `npm run build:native` (requires a Rust toolchain; produces `native/hitori_native.node`)
- Dev hot-reload: `npm run dev` (requires `nodemon` installed globally or in deps)
- Auto-deploy slash commands: restart the bot (only deploys when local commands differ)
- Force deploy all commands: `node src/scripts/deployCommands.js`
- Web dashboard: `http://0.0.0.0:3000` (starts with the bot; set `WEB_PORT` to change port)

## Project structure
- `index.js` — bot entry point
- `native/` — Rust napi-rs crate (`hitori_native`); hot-path compute (quest DSL eval, dominant color, formatting)
- `src/native/index.js` — loads `native/hitori_native.node`; every consumer falls back to the JS implementation when absent, so the bot works without building. `NATIVE_DISABLE=1` forces JS fallbacks.
- `src/database/db.js` — SQLite connection, schema, migrations
- `src/models/` — SQLite repository modules (replace Mongoose models)
- `src/commands/<category>/<command>.js` — slash + prefix commands
- `src/handlers/` — command/event/chat/streak loading
- `src/helpers/` — shared helper utilities
- `src/utils/` — older shared utilities (still used)
- `native/src/gif/` — Rust GIF engine (imagequant palettes, diff-optimized GIF89a, in-engine LRU cache); napi exports `gifEncode`, `gifCacheStats`, `gifCacheClear`
- `src/utils/gifEngine.js` — engine wrapper: uses the Rust module when loaded, pure-JS GIF89a/LZW fallback otherwise
- `src/utils/gifRenderer.js` — server-side scene→frames renderer (`@napi-rs/canvas` + `safeFetch` for asset URLs)
- `src/web/public/gifscene.js` — shared scene model, keyframe sampler, canvas renderer (browser + Node)
- `src/web/public/gifmaker.{css,js}` — GIF maker dashboard section (`#gifmaker`); renders via `POST /api/gifmaker/render`, permission `gifmaker`

## Environment variables
- `TOKEN` — Discord bot token (required)
- `GROQ_API` — Groq API key (required for AI)
- `LASTFM_API` — Last.fm API key (required for `fm`/`lastfm` commands; read-only, secret not needed)
- `CLIENT_ID` — Discord application ID (used for command deployment)
- `GUILD_ID` — optional test guild ID for instant guild command updates
- `GROQ_MODEL` — optional Groq model override
- `DB_PATH` — optional SQLite database path
- `WEB_PORT` — optional dashboard port (default `3000`)
- `WEB_HOST` — optional dashboard bind address (default `0.0.0.0`)
- `PUBLIC_URL` — optional public URL (e.g. `https://hitori.wispbyte.org`) used for the console message
- `DASHBOARD_PASSWORD` — optional persistent admin password (otherwise one is generated each boot and printed to console)
- `DASHBOARD_ORIGINS` — optional comma-separated extra allowed origins for dashboard API mutations
- `DISCORD_CLIENT_SECRET` — optional OAuth2 client secret; enables "Sign in with Discord" on the login page
- `OAUTH_REDIRECT_URI` — optional override for the OAuth callback (defaults to `PUBLIC_URL` or request host + `/auth/discord/callback`); must be registered in the Discord developer portal
- `DEV_USER_IDS` — optional comma-separated Discord user IDs with developer access to every guild (built-in default: `1017830522677891163`)
- `MAIN_GUILD_ID` — developer's primary guild, preselected in the dashboard (default `1376236720030486670`)
- `TLS_KEY_PATH` / `TLS_CERT_PATH` — optional; serve the dashboard over HTTPS
- `SKIP_AUTO_DEPLOY` — set to `true` to disable auto-deploy on startup

## Dashboard security notes
- Auth uses opaque, server-side sessions in `dashboard_sessions` (SHA-256 hashed tokens, sliding 24 h expiry, revocable). No JWT — logging out or editing a user invalidates sessions immediately.
- Sign-in is Discord OAuth2 (`/auth/discord` → `/auth/discord/callback` → `/servers` picker → `/dashboard?guild=<id>`, `src/web/oauth.js`). Access = guilds the user **owns or manages** (Manage Server / Administrator bits) that contain the bot, snapshotted into `session.guilds` as `{ id, role }` entries at login (NULL = unrestricted; plain string ids in pre-existing sessions are still accepted). Discord usernames are namespaced `discord:<id>` so they can't collide with local accounts.
- Local account sign-in (bootstrap `Admin` + dashboard users) lives at `/admin`; `/` is Discord-only and redirects already-signed-in users (`/servers` for Discord sessions, `/dashboard` for local).
- Per-guild ACL: `requireAuth` checks `req.params.guildId` via `canAccessGuild`; `/api/guilds`, `/api/stats`, `/api/overview`, `/api/vitals` are scoped the same way. `DEV_USER_IDS` + `MAIN_GUILD_ID` give developer access everywhere.
- `/api` mutations are protected by an Origin/`Sec-Fetch-Site` CSRF guard; API responses are `Cache-Control: no-store`.
- CSP forbids inline scripts: never add `onclick=` or `<script>` blocks in HTML — use `data-action` + the delegated handler map in `dashboard.js` and external `.js` files.
- User-supplied image URLs are fetched through `src/utils/safeFetch.js` (SSRF guard).
- Security-sensitive activity is recorded in `audit_logs` (90-day retention).
- Protected pages live in `src/web/pages/` (not the static root). `src/web/public/` is public — never put authenticated content there.
- `npm test` runs `src/scripts/smokeWeb.js`, which boots the dashboard with a stub client + temp DB and exercises the auth surface.

## Dashboard design system
- `src/web/public/tokens.css` — design tokens (phosphor `#00ff1e` on black, light variant via `html[data-theme="light"]`, `--accent`/`--ui-scale` knobs). Always use tokens — no hardcoded colors.
- `src/web/public/fonts.css` — self-hosted Geist / Geist Mono / Instrument Serif (`assets/fonts/*.woff2` from `@fontsource/*`); CSP requires `font-src 'self'`.
- Theme engine (`setTheme`, `hc-theme-v1` localStorage) and command palette (Ctrl K) live at the top of `dashboard.js`.
- Section nav is grouped (`data-group`); permission names map 1:1 to section IDs — keep them aligned.
- Deep links: `#<section-id>` loads that section; `showSection` keeps `location.hash` in sync.

## Preview tooling (no bot token needed)
- `node scripts/dev-dashboard.mjs` — dev dashboard on `http://127.0.0.1:3198` with a stub Discord client; login `Admin` / `preview-admin`.
- `node scripts/browser.mjs shot|eval|errors <url> [out.png] [--w --h --mobile --wait --login user:pass --eval expr]` — zero-dep headless-Chrome CDP driver for screenshots, in-page JS, and console/network error sweeps. Set `CHROME_PATH` if Edge/Chrome isn't in a standard location.

## Notes
- The bot auto-migrates the SQLite schema on startup.
- The `data/` directory is ignored by git.
- AI behavior can be customized per server with `/aiconfig prompt`.
- The dashboard admin login is `Admin` at `/admin` with a password printed to console on startup (or `DASHBOARD_PASSWORD`).
- Put a `login-bg.webp` (or `.jpg`/`.png`) image in `src/web/public/assets/` to customize the login background.
