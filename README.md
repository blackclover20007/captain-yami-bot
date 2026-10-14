# Simple WhatsApp Baileys Bot

Minimal WhatsApp bot using [Baileys](https://github.com/WhiskeySockets/Baileys).

### Panel deployment note

The root `index.js` is a panel-compatible launcher. On WispyByte, either set the startup command to `npm start` or use `node index.js`. Use Node.js **20 or newer**; Node.js 19 is not supported. The launcher installs missing npm dependencies automatically, but the panel must run commands from the extracted project directory containing `package.json`.

The current branding is **Captain Yami Bot**, version **Yami Black Clover**. The configured image is shown once to the owner when the bot connects and again whenever a user opens `!menu`. Contact numbers are `+263714373922 / +263784970429`, and the owner Telegram handle is `@saintbypass`.

## Setup

```bash
cd /home/ubuntu/whatsapp-baileys-bot
npm install
cp .env.example .env
```

The bot no longer asks for a phone number in the console. First run the browser-based **Captain Yami Devil Gate** session site:

```bash
npm run session-site
```

Open the Replit web URL, enter the WhatsApp number in international format, follow the on-screen linking instructions, and copy the generated `YAMI_SESSION_V1...` value. Put it in Replit **Secrets** as `SESSION_ID`, then start the bot with `npm start`. The bot restores that session and refuses to start without valid credentials.

For a public Replit deployment, set `PAIRING_SITE_KEY` in Secrets and enter the same key in the site. Never commit `SESSION_ID`, `PAIRING_SITE_KEY`, or `auth_info/`.

### Render pairing site

The included `render.yaml` creates a Node web service named `captain-yami-session-site`. Deploy the repository as a Render Blueprint, let Render generate `PAIRING_SITE_KEY`, open the service URL, and enter that generated key in the Devil Gate form. Copy the resulting session ID into the bot host's `SESSION_ID` secret. The pairing service must keep its `auth_info/` directory on a persistent disk or be used for one pairing session at a time; the session ID is the portable backup.

### Replit pairing site

Import the repository into Replit, keep the included `.replit`, and run `npm run session-site`. Replit exposes port 3000 automatically. Add `PAIRING_SITE_KEY` as a Secret, enter it in the form, and copy the generated session ID into the bot deployment. Do not run the pairing site and bot in the same Replit process; they are separate workloads.

Set `OWNER_JID` in `.env` to your WhatsApp JID before using owner commands:

```env
OWNER_JID=15551234567@s.whatsapp.net
SUDO_JIDS=15550000001@s.whatsapp.net,15550000002@s.whatsapp.net
MODERATOR_JIDS=15550000003@s.whatsapp.net
```

Owner commands are in `src/owner-commands.js` and use three access tiers:

- **Owner**: full access, including restart, shutdown, prefix/name changes, and all sudoer/moderator commands.
- **Sudoer**: operational access such as maintenance mode, cooldown changes, cleanup, tools, direct messaging, and moderation.
- **Moderator**: status, statistics, user lookup, blocking, announcements, and the owner menu.

Send `!ownerhelp` from an authorized account to see the command list. Unauthorized owner-command attempts are rejected and recorded in the audit log.

### Dynamic role management

The owner can manage roles directly from chat:

```text
!addsudo 15550000001
!removesudo 15550000001
!addmoderator 15550000002
!removemoderator 15550000002
!roles
!roles 15550000001
```

For a visual interface, send:

```text
!rolemenu
```

Select **ADD SUDOER**, **ADD MODERATOR**, **REMOVE SUDOER**, or **REMOVE MODERATOR**, then send the target phone number or JID in the next message. Send `!cancel` to cancel a pending action.

Changes are saved in `data/access-control.json` and survive restarts. A user has one effective non-owner role at a time: promoting someone to sudoer removes their moderator role, and promoting them to moderator removes their sudoer role. The owner cannot be demoted.

Role mutations are rate-limited independently from downloads: by default, an admin must wait 5 seconds between changes and can make at most 5 changes per rolling minute. Configure this with `ROLE_COMMAND_COOLDOWN_MS` and `ROLE_COMMAND_MAX_PER_MINUTE` in `.env`. Opening the role menu does not consume a mutation slot; the limit applies when the target JID is submitted.

### Rate-limit alerts

You can send real-time alerts to a private WhatsApp log group and/or an HTTPS webhook:

```env
OWNER_LOG_GROUP_JID=120363000000000000@g.us
ALERT_WEBHOOK_URL=https://your-domain.example/hooks/whatsapp-bot
```

Add the bot to the private group and use that group’s JID. Every breached download or role-action limit sends an alert containing the timestamp, actor JID, event, reason, and retry time. The webhook receives the same data as JSON. Alert delivery is best-effort and never takes the bot offline if the group or webhook is unavailable.

Keep `OWNER_JID` private and never leave it blank in a production deployment.

Every owner command is appended to `data/owner-audit.jsonl` with an ISO timestamp, sender JID, command name, and outcome. The log intentionally does not record command arguments or message contents. It is ignored by Git and should be backed up or rotated according to your retention policy.

The Devil Gate site uses a standard `Ubuntu/Chrome` browser identity, requests one WhatsApp-generated code, shows its Captain Yami black-and-crimson loading UI, and exports the saved auth files as a compressed portable session ID. WhatsApp may not show a push notification; manually open **Linked devices → Link a device → Link with phone number**.

## Commands

- `!ping` replies `pong`
- `!help` shows help
- `!mp3 <youtube-url>` extracts YouTube audio as an MP3 file
- `!tiktok <url>` downloads a public TikTok video
- `!instagram <url>` downloads a public Instagram Reel

### Group management

In a WhatsApp group, members can use:

```text
!groupinfo
!admins
```

Group admins can use:

```text
!tagall
!welcome on
!welcome off
!goodbye on
!goodbye off
!antilink on
!antilink off
```

Welcome and goodbye messages listen to WhatsApp participant events. When `antilink` is enabled, links from non-admins are deleted and the sender is notified. Settings are stored per group in `data/group-settings.json`, which is ignored by Git. New groups start with welcome, goodbye, and antilink disabled.

Commands such as `!about`, `!services`, `!contact`, and `!image` show a decorated live loading card before the final response. The reusable helper is in `src/ui/loading.js`; use `showLoading(sock, jid, { title, steps, finalText })` in any new command.

Owner and role-management responses use the same helper with a fast `OWNER CONTROL` animation. This covers successful commands, permission denials, role prompts, and the visual role/owner menus. The shorter timing keeps administrative commands responsive while still giving users visible feedback.

Commands also react to the original WhatsApp message: successful commands use category-specific reactions such as `✅`, `📥`, `🛡️`, or `👑`; failures use `❌`. Optional audio feedback can be enabled with local files:

```env
COMMAND_SUCCESS_SOUND=./media/success.ogg
COMMAND_FAILURE_SOUND=./media/failure.ogg
```

The sound files are only sent when they exist. The reusable feedback helper is `src/ui/feedback.js`.

## Download rate limiting

The `!download`, `!yt`, and `!youtube` commands are limited per WhatsApp user:

- One active download per user
- One new download every 60 seconds per user

Change the cooldown in `.env` with `DOWNLOAD_COOLDOWN_MS`, for example:

```env
DOWNLOAD_COOLDOWN_MS=120000
```

The limiter is in `src/rate-limit.js`. For multiple bot instances, use a shared store such as Redis instead of the in-memory limiter.

The `!mp3` and `!audio` commands use `yt-dlp` and `ffmpeg` to extract 128K MP3 audio. MP3 files are limited to 32 MB before being sent to WhatsApp.

TikTok and Instagram Reels use the same `yt-dlp` tool, progress cards, cleanup, 64 MB limit, rate limiter, and download reactions. They support public URLs only; private, login-required, age-restricted, or unavailable posts are rejected rather than bypassed.

### Temporary social-media cache

TikTok and Instagram files are temporarily stored in `.cache/media/` before sending. The cache key is derived from the platform and URL, so a repeated request can send a valid cached file immediately instead of downloading it again. Cached files expire after 15 minutes by default and the cache is capped at 512 MB. Configure `MEDIA_CACHE_TTL_MS` and `MEDIA_CACHE_MAX_BYTES` in `.env`. Expired and oldest files are removed automatically, and failed downloads are deleted immediately.

## Automatic tool installation

`npm start` automatically runs `scripts/ensure-tools.js` before starting the bot. It:

- Installs `yt-dlp` into the project-local `.tools/yt-dlp-venv/` environment if missing.
- Installs system `ffmpeg` with passwordless `sudo` and `apt-get` if missing.
- Runs only when the required tool is not already available.

## Crash recovery

`npm start` runs `scripts/run-bot.js`, which supervises the Captain Yami process. Unexpected exits are logged to `data/crash-recovery.jsonl` with timestamps, exit code or signal, child uptime, restart attempt, and backoff delay. The supervisor restarts the bot with exponential backoff up to 30 seconds and forwards `SIGINT`/`SIGTERM` for clean shutdown.

The owner command `!ownerrestart` exits with a supervisor restart code, while `!ownershutdown` exits cleanly and stays stopped.

If automatic `ffmpeg` installation is not permitted on your server, install it manually with:

```bash
sudo apt-get update && sudo apt-get install -y ffmpeg
```

Edit `src/index.js`, especially `handleMessage()`, to add your own behavior. Login state is stored in `auth_info/` and reused on later starts.

> `1234-sant` cannot be used as a custom WhatsApp login code; WhatsApp generates the pairing code. Treat the exported session ID and `auth_info/` as passwords: never share them or place them in public logs.
