# HitoriChan

BocchiChan is a fan-made Bocchi The Rock Discord bot!

A Discord bot (Bocchi-themed) used for moderation, economy, AI chat, and fun interactions.

**Quick start**: create a `.env` file, install deps, then run the bot.

## Table of Contents
- Project Overview
- Prerequisites
- Installation
- Configuration
- Running the bot
- Re-registering application commands
- Commands structure and metadata
- Help command behavior
- Development notes
- Troubleshooting

## Project Overview

This repository implements a Discord bot using `discord.js` and a file-based command structure. Commands live in `src/commands/` and are grouped by category (folders like `economy`, `moderation`, `ai`, `games`, `tools`, `server`). The bot dynamically loads command modules at runtime and registers them as application commands when the client becomes ready.

Data is stored in a local SQLite database (powered by Node.js's built-in `node:sqlite`) in `data/hitorichan.db`.

## Prerequisites

- Node.js 24+ (required for the built-in `node:sqlite` module)
- npm
- A Discord bot token
- A Groq API key for AI features (optional, set `GROQ_API`)

## Installation

1. Clone the repo and cd into it:

```bash
git clone <repo-url>
cd HitoriChan
```

2. Install dependencies:

```bash
npm install
```

3. Create environment variables in `.env`:

```env
TOKEN=your_discord_bot_token
CLIENT_ID=your_application_id
GROQ_API=your_groq_api_key
DB_PATH=optional_path_to_sqlite_database

# Optional: deploy commands to a single guild for instant testing
GUILD_ID=your_test_guild_id

# Optional: skip auto-deploy on startup
SKIP_AUTO_DEPLOY=false
```

## Configuration

Key configuration is read from environment variables. The database path defaults to `data/hitorichan.db` if `DB_PATH` is not set.

## Running the bot

Start the bot:

```bash
node index.js
```

For development:

```bash
npm run dev
```

For production, use a process manager like `pm2`:

```bash
pm2 start index.js --name HitoriChan
pm2 logs HitoriChan
```

## Re-registering application commands (important)

The bot syncs application commands on `ready` (see `src/events/ready.js` and `src/helpers/commands.js`). It only deploys when it detects a difference between local and remote commands.

- Set `GUILD_ID` to deploy to a single guild for instant updates during development.
- Leave `GUILD_ID` unset to deploy globally. Global commands can take up to an hour to propagate.
- Set `SKIP_AUTO_DEPLOY=true` to disable auto-deploy on startup.

Force-deploy all current commands manually:

```bash
node src/scripts/deployCommands.js
```

## Commands structure and metadata

- Commands live under `src/commands/<category>/<command>.js`.
- Each command module exports an object with fields like:
  - `data`: a `SlashCommandBuilder`
  - `prefixName`: optional prefix command name
  - `aliases`: optional array of prefix aliases
  - `syntax`: usage string (`{prefix}` is replaced)
  - `example`: example string
  - `execute(ctx)`: the function that runs when the command is invoked

## Help command behavior

The `/help` command (`src/commands/help.js`) is dynamic and uses dropdowns to browse commands by category.

## Development notes

- When editing command metadata (`options`, `choices`, `category`, `examples`), restart the bot to update Discord's application command registry.
- Keep command exports minimal and consistent.
- Use the helper modules in `src/helpers/` for common logic.

## Troubleshooting

- Choices not appearing in Discord's slash-command UI: restart the bot to re-register commands.
- Command not listed in help or grouped correctly: make sure the file is under a category folder.
- Permission errors when executing a command: confirm the bot has the required permissions in the guild.

## Contributing

Pull requests welcome. Small, focused changes are best.

## License

This project does not include a license file. Add one if you plan to open-source the repository.
