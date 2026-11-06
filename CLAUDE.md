# GFX References — notes for Claude sessions

Discord bot + website for the GFX References Discord server (Geometry Dash thumbnail / GFX reference library).
Live site: https://gfxref.duckdns.org. Working branch (also the repo default): `claude/epic-brown-m5w6fk`.
README.md describes the features for users; this file is the working context for Claude.

## Working with the owner (always)

- The owner is Korean and not a developer. Reply in Korean 존댓말 with short, precise steps.
- Never commit secrets (`.env`). Never ask the owner to paste the bot token, Client Secret or API keys into chat —
  tell them exactly which line to put in which `.env` file and let them do it.
- After changing code, explain what you changed and why. Commit / push only after the owner agrees.
- Deploying to the live server needs the owner's explicit OK every time.
- Never run the bot on another machine while the server runs (same token → every command answered twice).
  For local checks run with `BOT_ENABLED=false ARCHIVE_DRIVER=local HQ_BACKFILL=false` and a temporary `DATA_DIR`.

## Stack and layout

Node 24 + TypeScript, Hono (HTTP), discord.js v14, PGlite (embedded Postgres, single process), sharp, vitest.
The website is plain ES modules with no build step.

- `server/src/api/app.ts` — every HTTP route (`requireUser` / `requireMember` / `requireAdmin` guards)
- `server/src/bot/runtime.ts` — Discord commands, buttons, autocomplete; `bot/commands/definitions.ts` — slash command shapes
- `server/src/services/*` — logic; `server/src/repos/*` — SQL; `server/src/repos/scores.ts` — the scoring CTE
- `server/src/db/migrations.ts` — numbered, append-only migrations (never edit an applied one)
- `server/src/config.ts` — env schema; `server/.env.example` documents the variables
- `web/index.html`, `web/assets/js/main.js` (router), `views/*.js`, `i18n.js` (ko / en), `styles.css`

Checks before any commit: `cd server && npx tsc --noEmit -p . && npx vitest run` (all tests must pass).

## Features in short

- References: categories `gm_thumbnail`, `gm_artwork` (tag group `gd`) and `non_gm` (tag group `nongd`, own tab `#/nongd`).
  Tags belong to a group (`tags.grp`); the same name can exist in both groups.
- Originals live in a Discord archive channel. The site serves a 720px preview plus a 1920px q90 "HQ" preview
  (created on upload, backfilled slowly on startup). The detail view links to the archive message.
- Assets / Plugins / Texture packs tabs (`resources` table, own tags per kind, files stored in Discord).
- Showcase tab: YouTube videos only (title and channel from YouTube). A playlist import needs admin approval
  (buttons in the admin channel or on the site) and `YOUTUBE_API_KEY`.
- Points: uploads, weighted reactions, accepted edits, resources, speedart videos, showcase videos, admin adjustments.
  Relative tiers with Discord roles (top 5 Diamond, then 20/40/60/80% Titanium/Platinum/Gold/Silver, rest Bronze).
- Reports go to `REPORT_CHANNEL_ID`; members can import old chat posts (`#/import`); edit proposals; personal boards.

## Hosting and deploy (only from the owner's PC — the SSH key is not in this repo)

Oracle Cloud VM (E2.1.Micro, 1GB RAM + 2GB swap, Ubuntu 24.04), code in `/opt/gfx`, systemd service `gfx`,
Caddy reverse proxy to 127.0.0.1:3000, `LOW_MEMORY=true`.

1. `ssh -i ~/.ssh/gfx_oracle ubuntu@gfxref.duckdns.org`
2. `sudo systemctl stop gfx`
3. `cp -a /opt/gfx/server/data /home/ubuntu/gfx-backups/data-<timestamp>` — stop if this fails
4. `cd /opt/gfx && git pull && cd server && NODE_OPTIONS=--max-old-space-size=700 npm run build` (`npm ci` if dependencies changed)
5. `sudo systemctl start gfx`, then check `journalctl -u gfx` (migrations, bot login)

A cloud or remote session cannot deploy. Push the branch and ask the owner to deploy from a session on their PC.
If GitHub rejects pushes ("fatal error in commit_refs"), it is on GitHub's side; retrying later has worked.

## Open items

- Pinterest board import is on hold (the public RSS feed only shows the latest ~25 pins; the official API needs app review).
  Instead `chrome-extension/` (MV3) saves single pictures into a local box and uploads them with a source URL (`refs.source_url`).
  Its `lib/core.js` is a copy of `photoshop-plugin/gfx-ref/core.js`; a server test checks they match.
- `YOUTUBE_API_KEY` is not set on the server yet, so the showcase playlist import is off until the owner adds it.
- The owner wants an A1 (ARM, 2 OCPU / 12GB) instance eventually; it was out of capacity.
