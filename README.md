# Priv Bot — Discord Protection / Moderation Bot

Production-oriented Discord bot built with **Node.js 20, TypeScript, discord.js v14, MongoDB (Mongoose), Express + EJS**.
Protection (roles, channels, server, permissions, webhooks, bots), Anti-Nuke, Anti-Raid, Anti-Spam, whitelist,
moderation, giveaways, audit-log based analysis, web dashboard with Discord OAuth2, license check, health
endpoints, graceful shutdown and PM2 recovery.

> Status line and every embed footer: **S1morg Bu Sunucuyu İzliyor** (`config.tagline` in `src/config/index.ts`).

## Requirements

- Node.js **20+**
- MongoDB 5+ (local or Atlas)
- A Discord application with a bot user
- PM2 for production (`npm i -g pm2`)

## Installation

```bash
npm install
cp .env.example .env      # Windows: copy .env.example .env
# fill in .env (see below)
npm run build
npm start
```

## Discord Developer Portal

1. <https://discord.com/developers/applications> → **New Application**.
2. **Bot** tab → reset/copy the token → `DISCORD_TOKEN`.
3. Enable these **Privileged Gateway Intents**:
   - **Server Members Intent** (join detection, member lookups)
   - **Message Content Intent** (anti-spam, prefix commands)
   - **Presence Intent** (`.spo` Spotify command)
4. **OAuth2** tab → copy Client ID / Client Secret. Add the redirect URL
   (must equal `DISCORD_CALLBACK_URL`, e.g. `http://localhost:3000/auth/callback`).
5. Invite the bot with Administrator (or at minimum: View Audit Log, Manage Roles/Channels/Webhooks/Server,
   Ban/Kick/Moderate Members, Manage Messages, Manage Nicknames, Send Messages, Embed Links,
   Use External Emojis). **Move the bot's role as high as possible** — Discord does not let a bot act on
   members or roles above its own role.

## Environment

| Variable | Description |
| --- | --- |
| `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_CALLBACK_URL` | Discord credentials |
| `MONGODB_URI` | MongoDB connection string |
| `DASHBOARD_PORT`, `DASHBOARD_URL` | Dashboard port and public URL (https → secure cookies + HSTS) |
| `SESSION_SECRET` | ≥ 32 random chars (`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`) |
| `LICENSE_KEY` | `SK-XXXX-XXXX-XXXX` |
| `LICENSE_SECRET` | Secret used by the local license verifier |
| `LICENSE_API_URL` | Optional: remote license API (takes precedence over the local verifier) |
| `BOT_OWNER_IDS` | Optional: comma separated user IDs of the bot owners. They can open `/license`, manage **every server the bot is in** from the dashboard (even without owning it or being an admin) and are treated as trusted by the protection system |
| `TRUST_PROXY` | `1` behind nginx / Cloudflare |

The process refuses to start when required variables are missing or invalid.


## Development / Build

```bash
npm run dev      # tsx watch
npm run build    # tsc -> dist/
npm start        # node dist/index.js
npm run lint
npm run format
```

## PM2 / Production Deployment

```bash
npm run build
pm2 start ecosystem.config.js --env production   # or: npm run pm2
pm2 save && pm2 startup
pm2 install pm2-logrotate                          # rotate PM2's out.log / error.log
```

- One instance in fork mode (a Discord gateway session must not be duplicated).
- `autorestart`, `restart_delay`, `max_restarts`, `min_uptime`, `max_memory_restart: 800M`, `watch: false`.
- Application logs also rotate by themselves (`logs/app-*.log`, `logs/error-*.log`, 14/30 days, 20 MB).
- Crash handling: `uncaughtException` → clean shutdown with exit code 1 (PM2 restarts). A burst of
  `unhandledRejection`s does the same. A watchdog restarts the process if Discord is down for 5 min or MongoDB
  for 2 min. Errors inside Discord event handlers are caught and logged and never stop the bot.
- Graceful shutdown (`SIGINT`, `SIGTERM`, PM2 `shutdown` message): dashboard → timers → MongoDB → Discord client.
- Put nginx / Caddy in front of the dashboard for TLS and set `TRUST_PROXY=1`, `DASHBOARD_URL=https://…`.

After a restart everything is rebuilt from MongoDB: guild records, protection configs, raid lockdowns and
giveaways (giveaways use a DB-driven 5 s tick, not `setTimeout`, so overdue ones end immediately on boot).


## Running on a VDS (access from other IPs)

The dashboard listens on `DASHBOARD_HOST=0.0.0.0` by default, so it is reachable from any IP once the port is open.

1. Install Node.js 20, MongoDB (or use Atlas) and PM2 on the VDS, copy the project, `npm install`, `npm run build`.
2. `.env` on the VDS: set `DASHBOARD_URL=http://YOUR_VDS_IP:3000` and
   `DISCORD_CALLBACK_URL=http://YOUR_VDS_IP:3000/auth/callback` (both must use the same host you open in the browser).
3. Developer Portal → OAuth2 → Redirects: add exactly the same callback URL and save.
4. Open the port in the VDS firewall (e.g. `ufw allow 3000/tcp`) and in the provider's panel if it has its own firewall.
5. `pm2 start ecosystem.config.js --env production`, `pm2 save`, `pm2 startup`.

Recommended: put Caddy or nginx with a domain and HTTPS in front (`DASHBOARD_HOST=127.0.0.1`, `TRUST_PROXY=1`,
`DASHBOARD_URL=https://panel.example.com`, callback `https://panel.example.com/auth/callback`). With `https://` URLs the
session cookie becomes `Secure` and HSTS is enabled automatically. Over plain `http://` the login works but traffic
(including the session cookie) is not encrypted.
## Dashboard

`/login`, `/dashboard`, `/servers`, `/servers/:id`, `/servers/:id/protection|moderation|giveaways|logs`,
`/license`, `/profile`, `/health`, `/api/health`.

Every request goes through: **session → user → live guild membership → live access check**.
Access is limited to the **server owner, whitelisted users / roles and members with the Administrator permission**
(evaluated against the bot's current view of the guild; Manage Server alone is not enough).
Security-critical writes (protection config, whitelist, log channel) additionally require the server owner or a
whitelisted user. Security stack: Helmet + strict CSP, rate limits, CSRF tokens, secure/httpOnly/SameSite cookies,
Mongo-backed sessions, session regeneration on login, Zod validation on every API body, EJS auto-escaping.

REST API: `GET/PATCH /api/guilds/:id/protection`, `GET /api/guilds/:id/logs`,
`GET/POST/DELETE /api/guilds/:id/giveaways`, `GET/POST/DELETE /api/guilds/:id/whitelist`,
`GET /api/guilds`, `GET /api/guilds/:id`, `GET/PATCH /api/guilds/:id/settings`.

## Protection overview

Flow: `event → audit log → executor → trusted? → threshold → action → log`.

- Trusted = this bot, the guild owner, or whitelisted users / bots / roles. Trusted actors are never punished.
- Audit lookups are coalesced per guild (one REST call serves all concurrent events) and retried at
  100 / 250 / 500 ms, never endlessly.
- All corrective API work goes through a per-guild queue (250 ms spacing, bounded) so attacks cannot flood the API;
  identical punishments are applied once per 30 s.
- Punishments: `LOG WARN TIMEOUT KICK BAN REMOVE_ROLES`. The bot checks its own permission and the target's
  role hierarchy first and reports the reason when it cannot act.
- Module defaults are safe: modules **revert + log**; **Anti-Nuke** escalates to `REMOVE_ROLES`.

Discord API limitations (logged, with a safe fallback): vanity URL and Community mode cannot be reverted by a bot,
deleted webhooks cannot be recreated, restored roles are empty (members must be re-assigned), welcome-screen
changes emit no event.

## Commands

**Every slash command also works with the prefix** (default `.`): `.ban @user spam`, `.timeout @user 10m reason`,
`.giveaway start "Nitro" 1h 2 #channel`, `.antinuke set ban_limit:3`. Arguments are read in the order shown by `.help`
(`<required>` / `[optional]`); use "quotes" around values with spaces and `name:value` to set one option directly.
Turkish shortcuts: `.yasakla .at .sustur .uyar .temizle .kilitle .kayit .hosgeldin .cekilis`.
The permission, guard and cooldown rules are identical to the slash versions.

Slash: `/ban /unban /kick /timeout /warn /warns /clear /lock /unlock /slowmode /nick /role`,
`/giveaway start|end|reroll|list`, `/antinuke`, `/antiraid`, `/protection status|reset`,
`/whitelist add|remove|list`, `/setlog`, `/ping`.

**Guard:** `/whitelist`, `/antinuke`, `/antiraid`, `/protection` are guarded — only the server owner and
whitelisted users can run them (`guard: true` on a command enables this for any command).

Prefix (default `.`): `.spo [@user]` (live Spotify card with a moving progress bar), `.snipe [n]`,
`.editsnipe [n]` (deleted / edited messages incl. bot messages, ◀ ▶ navigation, needs Manage Messages).

## Animated emojis

Copy `emojis.example.json` to `emojis.json` and replace values with animated custom emojis
(`<a:name:id>`). They are used in embed titles/descriptions; the bot needs *Use External Emojis*
(and must share a server with the emoji). Without the file, Unicode emojis are used.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `[LICENSE] License key not found.` | Set `LICENSE_KEY` (and `LICENSE_SECRET` for the local verifier) |
| `Used disallowed intents` | Enable the three privileged intents in the Developer Portal |
| Protection logs "Missing View Audit Log" | Give the bot **View Audit Log** |
| "Target has an equal or higher role than the bot" | Move the bot's role higher |
| Dashboard login loop | `DISCORD_CALLBACK_URL` must match the portal redirect exactly; on https set `TRUST_PROXY=1` |
| `.spo` says nothing is playing | Presence Intent must be on and the user's Spotify status must be visible |
