🔥☠️ 𝐂𝐀𝐏𝐓𝐀𝐈𝐍 𝐘𝐀𝐌𝐈 𝐁𝐎𝐓 ☠️🔥

🩸 𝒀𝑨𝑴𝑰 𝑩𝑳𝑨𝑪𝑲 𝑪𝑳𝑶𝑽𝑬𝑹 — 𝑻𝑯𝑬 𝑫𝑬𝑽𝑰𝑳 𝑮𝑨𝑻𝑬 🩸

<p align="center">
  <img src="https://img.shields.io/badge/DEVIL%20MODE-ACTIVATED-red?style=for-the-badge&logo=github" />
  <img src="https://img.shields.io/badge/WHATSAPP-BAILEYS-black?style=for-the-badge&logo=whatsapp" />
  <img src="https://img.shields.io/badge/NODE.JS-20%2B-green?style=for-the-badge&logo=node.js" />
</p><p align="center">
  <b>☠️━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━☠️</b><br>
  <i>“Power is not given to the weak. Break your limits and claim it.”</i><br>
  <b>— THE DEVIL OF THE BLACK CLOVER</b><br>
  <b>☠️━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━☠️</b>
</p>🩸 𝟎𝟏. 𝐀𝐁𝐎𝐔𝐓 𝐓𝐇𝐄 𝐃𝐄𝐕𝐈𝐋

Welcome to Captain Yami Bot, a dark-themed WhatsApp automation project powered by "Baileys" (https://github.com/WhiskeySockets/Baileys).

Born in darkness. Forged through battle. Designed for control.

This bot features media downloads, group management, animated command responses, owner controls, role management, rate limiting, audit logs, and automatic crash recovery.

«🔥 PROJECT IDENTITY

- ☠️ Bot Name: Captain Yami Bot
- 🩸 Version: Yami Black Clover
- 🍀 Theme: Dark / Crimson / Devil Gate
- ⚡ Runtime: Node.js 20+
- 👑 Owner: Saint
- 🕷️ Developer Telegram: "@saintbypass" (https://t.me/saintbypass)»

---

🔥 𝟎𝟐. 𝐃𝐄𝐕𝐈𝐋 𝐆𝐀𝐓𝐄 — 𝐅𝐄𝐀𝐓𝐔𝐑𝐄𝐒

☠️ Feature| 🩸 Description
⚡ Fast Commands| Responsive WhatsApp command handling
🎬 Media Downloads| MP3, TikTok and Instagram Reels
👑 Owner Control| Advanced owner command system
🛡️ Role Management| Manage sudoers and moderators
🌑 Group Protection| Anti-link, welcome and goodbye
🔥 Loading Cards| Decorated command progress messages
🧾 Audit System| Records owner command outcomes
♻️ Crash Recovery| Automatic restarts with backoff
🔔 Rate Alerts| Optional group and webhook notifications
🎭 Message Reactions| Success and failure reactions

---

🩸 𝟎𝟑. 𝐒𝐔𝐌𝐌𝐎𝐍 𝐓𝐇𝐄 𝐃𝐄𝐕𝐈𝐋

Requirements

- Node.js 20 or newer
- npm
- A compatible hosting panel or Linux server
- A valid WhatsApp-linked session

Installation

cd /home/ubuntu/whatsapp-baileys-bot
npm install
cp .env.example .env

Configure the environment variables in ".env" before starting the bot.

⚡ Activate the bot

npm start

Alternatively, use the panel startup command:

node index.js

The root "index.js" acts as the panel-compatible launcher. Run commands from the extracted project directory containing "package.json".

---

🔐 𝟎𝟒. 𝐋𝐈𝐍𝐊 𝐘𝐎𝐔𝐑 𝐒𝐄𝐒𝐒𝐈𝐎𝐍

Generate a session using the official project session site:

"☠️ CAPTAIN YAMI SESSION SITE" (https://github.com/blackclover20007/captain-yami-session-site)

1. Open the session site.
2. Follow its WhatsApp linking instructions.
3. Generate your session ID.
4. Add the generated "YAMI_SESSION_V1..." value to your hosting environment as "SESSION_ID".
5. Start the bot using "npm start".

The bot restores the saved session and refuses to start if valid credentials are missing.

«⚠️ WhatsApp generates the pairing code. You cannot choose an arbitrary login code such as "1234-sant".»

Never share your session ID or authentication files. They can grant access to your WhatsApp account.

---

👑 𝟎𝟓. 𝐎𝐖𝐍𝐄𝐑 𝐀𝐍𝐃 𝐒𝐔𝐃𝐎 𝐂𝐎𝐍𝐓𝐑𝐎𝐋

Configure your authorized WhatsApp JIDs in ".env":

OWNER_JID=15551234567@s.whatsapp.net
SUDO_JIDS=15550000001@s.whatsapp.net,15550000002@s.whatsapp.net
MODERATOR_JIDS=15550000003@s.whatsapp.net

Replace these example JIDs with your own authorized accounts.

🔥 Access levels

- 👑 Owner: Full control, including restart, shutdown, and configuration changes.
- 🩸 Sudoer: Operational tools, maintenance, cleanup, and moderation.
- 🛡️ Moderator: Status, statistics, user lookup, blocking, announcements, and owner menu access.

View the available owner commands:

!ownerhelp

Unauthorized owner-command attempts are rejected and recorded in the audit log.

---

🕷️ 𝟎𝟔. 𝐃𝐘𝐍𝐀𝐌𝐈𝐂 𝐑𝐎𝐋𝐄 𝐌𝐀𝐆𝐈𝐂

Manage authorized users directly from WhatsApp.

!addsudo 15550000001
!removesudo 15550000001
!addmoderator 15550000002
!removemoderator 15550000002
!roles
!roles 15550000001
!rolemenu

☠️ Visual role menu

Send:

!rolemenu

Choose the required action, then submit the target phone number or JID.

Cancel a pending action:

!cancel

Role changes are stored in "data/access-control.json" and persist across restarts.

Default protection:

- 5-second cooldown between role changes.
- Maximum 5 changes per rolling minute.
- The owner cannot be demoted.
- Each user has one effective non-owner role.

Configure the limits using "ROLE_COMMAND_COOLDOWN_MS" and "ROLE_COMMAND_MAX_PER_MINUTE".

---

⚔️ 𝟎𝟕. 𝐂𝐎𝐌𝐌𝐀𝐍𝐃 𝐆𝐑𝐈𝐌𝐎𝐈𝐑𝐄

⚡ Basic commands

Command| Ability
"!ping"| Test the bot's response
"!help"| Display help
"!about"| Show bot information
"!services"| Display available services
"!contact"| Show contact information
"!image"| Display the configured image
"!ownerhelp"| View authorized owner commands
"!rolemenu"| Open role management

🎬 Media abilities

Command| Ability
"!mp3 <youtube-url>"| Extract YouTube audio as MP3
"!audio <youtube-url>"| Extract audio
"!tiktok <url>"| Download a public TikTok video
"!instagram <url>"| Download a public Instagram Reel
"!download <url>"| Use the supported download handler
"!yt <youtube-url>"| YouTube download alias
"!youtube <youtube-url>"| YouTube download alias

Media commands depend on the handlers implemented in your project.

Only public, accessible social-media posts are supported. Private, login-required, age-restricted, or unavailable posts are rejected.

---

🛡️ 𝟎𝟖. 𝐆𝐑𝐎𝐔𝐏 𝐃𝐎𝐌𝐈𝐍𝐀𝐓𝐈𝐎𝐍

👥 Member commands

!groupinfo
!admins

👑 Group administrator commands

!tagall
!welcome on
!welcome off
!goodbye on
!goodbye off
!antilink on
!antilink off

🩸 Protection system

- Welcome new participants.
- Send goodbye messages when participants leave.
- Delete links sent by non-admins when anti-link is enabled.
- Notify users when their links are removed.
- Store settings separately for each group.

Group settings are saved in:

data/group-settings.json

New groups start with welcome, goodbye, and anti-link disabled.

---

🔥 𝟎𝟗. 𝐃𝐄𝐕𝐈𝐋 𝐋𝐎𝐀𝐃𝐈𝐍𝐆 𝐒𝐘𝐒𝐓𝐄𝐌

Commands such as "!about", "!services", "!contact", and "!image" can show decorated loading cards before the final response.

Reusable helper:

showLoading(sock, jid, {
  title,
  steps,
  finalText
});

Location:

src/ui/loading.js

Owner controls and role-management responses use the same visual system with a faster "OWNER CONTROL" animation.

⚡ Reactions and sound effects

Successful commands can react with category-specific emojis:

- ✅ Success
- 📥 Downloads
- 🛡️ Protection
- 👑 Owner actions
- ❌ Failure

Optional sound configuration:

COMMAND_SUCCESS_SOUND=./media/success.ogg
COMMAND_FAILURE_SOUND=./media/failure.ogg

Sounds are sent only when the configured files exist.

---

⏳ 𝟏𝟎. 𝐑𝐀𝐓𝐄 𝐋𝐈𝐌𝐈𝐓𝐒 & 𝐃𝐄𝐕𝐈𝐋 𝐀𝐋𝐄𝐑𝐓𝐒

Download protection

- One active download per user.
- One new download every 60 seconds per user.
- MP3 size limit: 32 MB.
- TikTok and Instagram file limit: 64 MB.

Change the download cooldown:

DOWNLOAD_COOLDOWN_MS=120000

This example sets the cooldown to 120 seconds.

Temporary media cache

.cache/media/

Default cache settings:

- Expiration: 15 minutes.
- Maximum cache size: 512 MB.
- Expired and oldest files are cleaned automatically.
- Failed downloads are removed.

Optional alert destinations

OWNER_LOG_GROUP_JID=120363000000000000@g.us
ALERT_WEBHOOK_URL=https://your-domain.example/hooks/whatsapp-bot

Configure only destinations you control. Alert delivery is best-effort and does not intentionally take the bot offline when a destination is unavailable.

---

🔧 𝟏𝟏. 𝐀𝐔𝐓𝐎𝐌𝐀𝐓𝐈𝐂 𝐓𝐎𝐎𝐋 𝐒𝐘𝐒𝐓𝐄𝐌

The startup process runs:

scripts/ensure-tools.js

It checks for required tools and can install missing components:

- "yt-dlp" in a project-local Python environment.
- "ffmpeg" using system package management where permitted.

For Ubuntu or Debian servers, install FFmpeg manually if necessary:

sudo apt-get update
sudo apt-get install -y ffmpeg

Some hosting panels do not provide passwordless "sudo" or system package installation. In that case, install the required tools through your hosting provider or configure compatible binaries.

---

♻️ 𝟏𝟐. 𝐂𝐑𝐀𝐒𝐇 𝐑𝐄𝐂𝐎𝐕𝐄𝐑𝐘

The supervisor runs:

scripts/run-bot.js

Features include:

- Automatic recovery after unexpected exits.
- Exponential restart backoff up to 30 seconds.
- Clean shutdown signal forwarding.
- Crash records in "data/crash-recovery.jsonl".

Owner controls:

!ownerrestart
!ownershutdown

The restart command requests a supervised restart. The shutdown command exits cleanly and leaves the process stopped.

---

📂 𝟏𝟑. 𝐏𝐑𝐎𝐉𝐄𝐂𝐓 𝐆𝐑𝐈𝐌𝐎𝐈𝐑𝐄

whatsapp-baileys-bot/
├── index.js
├── package.json
├── .env.example
├── src/
│   ├── index.js
│   ├── owner-commands.js
│   ├── rate-limit.js
│   └── ui/
│       ├── loading.js
│       └── feedback.js
├── scripts/
│   ├── ensure-tools.js
│   └── run-bot.js
├── data/
│   ├── access-control.json
│   ├── group-settings.json
│   └── owner-audit.jsonl
├── auth_info/
└── .cache/
    └── media/

This is a representative structure; some generated files and folders appear only after the bot runs.

Customize command behavior in "src/index.js", especially "handleMessage()".

---

🔐 𝟏𝟒. 𝐒𝐄𝐂𝐔𝐑𝐈𝐓𝐘 𝐖𝐀𝐑𝐍𝐈𝐍𝐆

«☠️ YOUR SESSION IS YOUR KINGDOM. PROTECT IT.»

Never commit or publicly share:

- "SESSION_ID"
- "PAIRING_SITE_KEY"
- "auth_info/"
- ".env"
- Private webhook secrets

The project should ignore credentials, session data, caches, and private logs in Git.

Owner commands are recorded in:

data/owner-audit.jsonl

The audit log stores timestamps, sender JIDs, command names, and outcomes without intentionally recording command arguments or message contents.

---

🩸 𝟏𝟓. 𝐂𝐎𝐍𝐓𝐀𝐂𝐓 𝐓𝐇𝐄 𝐃𝐄𝐕𝐈𝐋

- 👑 Developer: Saint
- 📱 WhatsApp: +263714373922 / +263784970429
- 🕷️ Telegram: "@saintbypass" (https://t.me/saintbypass)
- ⚔️ GitHub: "blackclover20007" (https://github.com/blackclover20007)
- 🔑 Session Site: "Captain Yami Session Site" (https://github.com/blackclover20007/captain-yami-session-site)

---

<p align="center">
  <b>☠️━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━☠️</b><br>
  🔥 <b>CAPTAIN YAMI BOT</b> 🔥<br>
  <i>THE DEVIL GATE IS OPEN</i><br><br>
  <b>🍀 POWER • CONTROL • FREEDOM 🍀</b><br>
  <b>“BREAK YOUR LIMITS.”</b><br>
  <b>☠️━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━☠️</b>
</p>