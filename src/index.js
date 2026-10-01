import 'dotenv/config';

import makeWASocket, {
  Browsers,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';

import P from 'pino';
import { handleImageDownload } from './commands/download-image.js';
import { handleYouTubeDownload } from './commands/download-youtube.js';
import { handleAudioDownload } from './commands/download-audio.js';
import { DownloadRateLimiter, RoleRateLimiter } from './rate-limit.js';
import { createOwnerController } from './owner-commands.js';
import { notifyRateLimitBreach } from './alerts.js';
import { showLoading } from './ui/loading.js';
import { sendCommandFeedback } from './ui/feedback.js';

const config = {
  name: process.env.BOT_NAME || 'Captain Yami Bot',
  version: process.env.BOT_VERSION || 'Yami Black Clover',
  imageUrl: process.env.BOT_IMAGE_URL || 'https://www.image2url.com/r2/default/images/1790872649903-cd52d983-a7d2-48ef-9892-655395768334.jpg',
  contactNumbers: process.env.CONTACT_NUMBERS || '+263714373922 / +263784970429',
  ownerTelegram: process.env.OWNER_TELEGRAM || '@saintbypass',
  prefix: process.env.COMMAND_PREFIX || '!',
  phoneNumber: (process.env.PAIRING_PHONE_NUMBER || '').replace(/\D/g, ''),
  ownerJid: process.env.OWNER_JID || '263714373922@s.whatsapp.net',
  sudoJids: process.env.SUDO_JIDS || '',
  moderatorJids: process.env.MODERATOR_JIDS || '',
  ownerLogGroupJid: process.env.OWNER_LOG_GROUP_JID || '',
  alertWebhookUrl: process.env.ALERT_WEBHOOK_URL || '',
  successSound: process.env.COMMAND_SUCCESS_SOUND || '',
  failureSound: process.env.COMMAND_FAILURE_SOUND || ''
};

const logger = P({
  level: process.env.LOG_LEVEL || 'info'
});

const downloadLimiter = new DownloadRateLimiter({
  cooldownMs: Number(process.env.DOWNLOAD_COOLDOWN_MS || 60000),
  maxConcurrentPerUser: 1
});

const roleLimiter = new RoleRateLimiter({
  cooldownMs: Number(process.env.ROLE_COMMAND_COOLDOWN_MS || 5000),
  maxPerMinute: Number(process.env.ROLE_COMMAND_MAX_PER_MINUTE || 5)
});

const ownerController = createOwnerController({
  config,
  logger,
  downloadLimiter,
  roleLimiter
});

let activeSocket = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let shuttingDown = false;
let connectionNoticeSent = false;

function getReconnectDelay() {
  const exponentialDelay = Math.min(30000, 1000 * 2 ** reconnectAttempts);
  const jitter = Math.floor(Math.random() * 1000);
  return exponentialDelay + jitter;
}

function scheduleReconnect(reason) {
  if (shuttingDown || reconnectTimer) return;

  const delay = getReconnectDelay();
  reconnectAttempts += 1;

  logger.warn(
    { reason, delay, attempt: reconnectAttempts },
    'Scheduling WhatsApp reconnect'
  );

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    startBot().catch((error) => {
      logger.error(error, 'Reconnect attempt failed');
      scheduleReconnect('reconnect-start-failed');
    });
  }, delay);
}

async function startBot() {
  if (shuttingDown || activeSocket) return;

  const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    browser: Browsers.ubuntu(config.name),
    logger,
    printQRInTerminal: !config.phoneNumber,
    markOnlineOnConnect: false,
    syncFullHistory: false
  });

  activeSocket = sock;

  sock.ev.on('creds.update', saveCreds);

  if (!state.creds.registered && config.phoneNumber) {
    // WhatsApp generates this code; it cannot be customized.
    const pairingCode = await sock.requestPairingCode(config.phoneNumber);
    logger.info(`Pairing code: ${pairingCode}`);
    logger.info(
      'On your phone: WhatsApp > Linked devices > Link a device > Link with phone number'
    );
  }

  sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
    if (connection === 'open') {
      reconnectAttempts = 0;
      logger.info(`${config.name} connected successfully.`);

      if (!connectionNoticeSent && ownerController.ownerJid) {
        connectionNoticeSent = true;
        await sendConnectionNotice(sock);
      }
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;

      if (activeSocket === sock) activeSocket = null;

      if (
        statusCode === DisconnectReason.loggedOut ||
        statusCode === DisconnectReason.connectionReplaced ||
        statusCode === DisconnectReason.multideviceMismatch ||
        statusCode === DisconnectReason.forbidden
      ) {
        logger.error(
          { statusCode },
          'WhatsApp session ended and needs manual attention'
        );
        logger.error('For logout, delete auth_info and run the bot again to relink.');
        process.exit(1);
      }

      // 515 (restart required), 408 (timeout), 503 (unavailable),
      // and 440 (temporary conflict) are normally safe to reconnect.
      scheduleReconnect(`connection-closed-${statusCode || 'unknown'}`);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const message of messages) {
      if (!message.message || message.key.fromMe) continue;

      const jid = message.key.remoteJid;
      if (!jid || jid === 'status@broadcast') continue;

      const text = getMessageText(message);
      const selectedId = getSelectedMenuId(message);
      const incomingText = text || selectedId;

      ownerController.recordMessage(incomingText);

      if (ownerController.isBlocked(jid) && !ownerController.isAuthorized(jid)) {
        continue;
      }

      if (ownerController.isAuthorized(jid) && incomingText) {
        try {
          const result = await ownerController.handle(sock, jid, incomingText, message);
          const handled = result === true || result?.handled;
          if (handled) {
            await sendCommandFeedback({
              sock,
              jid,
              messageKey: message.key,
              success: result?.success !== false,
              kind: getFeedbackKind(incomingText, config.prefix),
              successSound: config.successSound,
              failureSound: config.failureSound
            });
            continue;
          }
        } catch (error) {
          logger.error(error, 'Owner command failed');
          await sendCommandFeedback({
            sock,
            jid,
            messageKey: message.key,
            success: false,
            kind: 'owner',
            successSound: config.successSound,
            failureSound: config.failureSound
          });
          await sock.sendMessage(jid, {
            text: 'Command failed. Check the bot log for details.'
          });
          continue;
        }
      }

      if (ownerController.isMaintenance() && !ownerController.isAuthorized(jid)) {
        await sock.sendMessage(jid, {
          text: 'The bot is currently in maintenance mode. Please try again later.'
        });
        await sendCommandFeedback({
          sock,
          jid,
          messageKey: message.key,
          success: false,
          failureSound: config.failureSound
        });
        continue;
      }

      if (text || selectedId) {
        try {
          const result = await handleMessage(sock, jid, incomingText);
          await sendCommandFeedback({
            sock,
            jid,
            messageKey: message.key,
            success: result !== false,
            kind: getFeedbackKind(incomingText, config.prefix),
            successSound: config.successSound,
            failureSound: config.failureSound
          });
        } catch (error) {
          logger.error(error, 'Command failed');
          await sendCommandFeedback({
            sock,
            jid,
            messageKey: message.key,
            success: false,
            failureSound: config.failureSound
          });
          await sock.sendMessage(jid, {
            text: 'Command failed. Please try again later.'
          });
        }
      }
    }
  });
}

function getMessageText(message) {
  const content = message.message;

  return (
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    ''
  ).trim();
}

function getSelectedMenuId(message) {
  const content = message.message;

  return (
    content.listResponseMessage?.singleSelectReply?.selectedRowId ||
    content.buttonsResponseMessage?.selectedButtonId ||
    content.templateButtonReplyMessage?.selectedId ||
    ''
  ).trim();
}

function getFeedbackKind(text = '', prefix = '!') {
  const command = text.trim().toLowerCase().split(/\s+/)[0];
  const normalizedPrefix = prefix.toLowerCase();
  if ([`${normalizedPrefix}yt`, `${normalizedPrefix}youtube`, `${normalizedPrefix}mp3`, `${normalizedPrefix}audio`, `${normalizedPrefix}download`].includes(command)) return 'download';
  if (command.includes('role') || [`${normalizedPrefix}addsudo`, `${normalizedPrefix}removesudo`, `${normalizedPrefix}addmoderator`, `${normalizedPrefix}removemoderator`].includes(command)) return 'role';
  if (command.includes('menu')) return 'menu';
  if (command.startsWith(`${normalizedPrefix}owner`) || command.includes('maintenance')) return 'owner';
  return 'command';
}

async function handleMessage(sock, jid, text) {
  const command = text.toLowerCase();
  const prefix = config.prefix.toLowerCase();
  const parts = text.trim().split(/\s+/);
  const commandName = parts.shift()?.toLowerCase();
  const argument = parts.join(' ').trim();

  // !menu - open the interactive menu.
  if (command === `${prefix}menu` || command === 'menu') {
    return sendMainMenu(sock, jid);
  }

  // !ping - test whether the bot is online.
  if (command === `${prefix}ping`) {
    return sock.sendMessage(jid, {
      text: 'pong'
    });
  }

  // !download https://example.com/image.jpg - download a direct image URL.
  if (commandName === `${prefix}download`) {
    if (!argument) {
      return sock.sendMessage(jid, {
        text: `Usage: ${config.prefix}download https://example.com/image.jpg`
      });
    }

    return runLimitedDownload({
      sock,
      jid,
      argument,
      handler: handleImageDownload
    });
  }

  // !yt https://www.youtube.com/watch?v=... - download a YouTube video.
  if (commandName === `${prefix}yt` || commandName === `${prefix}youtube`) {
    if (!argument) {
      return sock.sendMessage(jid, {
        text: `Usage: ${config.prefix}yt https://www.youtube.com/watch?v=...`
      });
    }

    return runLimitedDownload({
      sock,
      jid,
      argument,
      handler: handleYouTubeDownload
    });
  }

  // !mp3 or !audio https://www.youtube.com/watch?v=... - extract MP3 audio.
  if (commandName === `${prefix}mp3` || commandName === `${prefix}audio`) {
    if (!argument) {
      return sock.sendMessage(jid, {
        text: `Usage: ${config.prefix}mp3 https://www.youtube.com/watch?v=...`
      });
    }

    return runLimitedDownload({
      sock,
      jid,
      argument,
      handler: handleAudioDownload
    });
  }

  // !about - describe the bot.
  if (command === `${prefix}about`) {
    return showLoading(sock, jid, {
      title: 'BOT PROFILE',
      steps: ['READING PROFILE', 'CHECKING STATUS', 'BUILDING CARD'],
      finalText: `${config.name}\nVersion: ${config.version}\nOwner Telegram: ${config.ownerTelegram}`
    });
  }

  // !services - example business/service section.
  if (command === `${prefix}services`) {
    return showLoading(sock, jid, {
      title: 'SERVICE CATALOG',
      steps: ['OPENING CATALOG', 'LOADING SERVICES', 'PREPARING DISPLAY'],
      finalText: 'Services are ready. Send !contact for support details.'
    });
  }

  // !contact - replace this with your real contact information.
  if (command === `${prefix}contact`) {
    return showLoading(sock, jid, {
      title: 'SUPPORT CHANNEL',
      steps: ['OPENING SUPPORT', 'CHECKING CONTACTS', 'PREPARING RESPONSE'],
      finalText: `WhatsApp: ${config.contactNumbers}\nTelegram: ${config.ownerTelegram}`
    });
  }

  // !image - media placeholder.
  if (command === `${prefix}image`) {
    return showLoading(sock, jid, {
      title: 'MEDIA VAULT',
      steps: ['SCANNING REQUEST', 'PREPARING MEDIA', 'STAGING DELIVERY'],
      finalText: 'Media action ready. Add your image handler in src/index.js.'
    });
  }

  // !help - list all commands.
  if (command === `${prefix}help`) {
    return sock.sendMessage(jid, {
      text: [
        'Available commands',
        '',
        `${config.prefix}menu - open the interactive menu`,
        `${config.prefix}ping - test whether the bot is online`,
        `${config.prefix}about - learn about the bot`,
        `${config.prefix}services - view available services`,
        `${config.prefix}contact - contact and support details`,
        `${config.prefix}download <image-url> - download an image`,
        `${config.prefix}yt <youtube-url> - download a video`,
        `${config.prefix}mp3 <youtube-url> - extract MP3 audio`,
        `${config.prefix}image - image/media placeholder`,
        `${config.prefix}help - show this help`
      ].join('\n')
    });
  }

  // Add more custom commands here.
}

async function runLimitedDownload({ sock, jid, argument, handler }) {
  const result = downloadLimiter.tryAcquire(jid);

  if (!result.allowed) {
    if (result.reason === 'active') {
      await notifyRateLimitBreach({
        sock,
        groupJid: config.ownerLogGroupJid,
        webhookUrl: config.alertWebhookUrl,
        actorJid: jid,
        command: 'download',
        event: 'download_rate_limit',
        reason: result.reason,
        retryAfterMs: 0
      });
      return sock.sendMessage(jid, {
        text: 'A download is already running for you. Please wait for it to finish.'
      }).then(() => false);
    }

    const seconds = Math.ceil(result.retryAfterMs / 1000);
    await notifyRateLimitBreach({
      sock,
      groupJid: config.ownerLogGroupJid,
      webhookUrl: config.alertWebhookUrl,
      actorJid: jid,
      command: 'download',
      event: 'download_rate_limit',
      reason: result.reason,
      retryAfterMs: result.retryAfterMs
    });
    return sock.sendMessage(jid, {
      text: `Download limit reached. Please wait ${seconds} seconds before trying again.`
    }).then(() => false);
  }

  try {
    ownerController.recordDownload();
    return await handler({ sock, jid, argument, logger });
  } finally {
    downloadLimiter.release(jid);
  }
}

async function sendConnectionNotice(sock) {
  try {
    await sock.sendMessage(ownerController.ownerJid, {
      image: { url: config.imageUrl },
      caption: [
        `CONNECTED: ${config.name}`,
        `VERSION: ${config.version}`,
        `OWNER: ${config.ownerTelegram}`,
        'Status: online'
      ].join('\n')
    });
  } catch (error) {
    logger.warn({ error: error.message }, 'Could not send connection notice');
  }
}

async function sendMainMenu(sock, jid) {
  await sock.sendMessage(jid, {
    image: { url: config.imageUrl },
    caption: [
      config.name,
      config.version,
      '',
      `Owner: ${config.ownerTelegram}`,
      `WhatsApp: ${config.contactNumbers}`
    ].join('\n')
  });

  return sock.sendMessage(jid, {
    text: [
      '━━━━━━━━━━━━━━━━━━━━',
      `      ${config.name.toUpperCase()}`,
      '━━━━━━━━━━━━━━━━━━━━',
      '',
      `MIDNIGHT CONTROL MENU · ${config.version.toUpperCase()}`,
      '',
      'Select an option below.',
      `Type ${config.prefix}help for commands.`,
      '',
      '━━━━━━━━━━━━━━━━━━━━'
    ].join('\n'),
    title: 'MIDNIGHT MENU',
    footer: 'Dark mode interface',
    buttonText: 'ENTER MENU',
    sections: [
      {
        title: 'INFORMATION',
        rows: [
          {
            title: 'ABOUT',
            description: 'Learn about this bot',
            rowId: `${config.prefix}about`
          },
          {
            title: 'SERVICES',
            description: 'View available services',
            rowId: `${config.prefix}services`
          },
          {
            title: 'CONTACT',
            description: 'Open support information',
            rowId: `${config.prefix}contact`
          }
        ]
      },
      {
        title: 'SYSTEM TOOLS',
        rows: [
          {
            title: 'PING',
            description: 'Check system status',
            rowId: `${config.prefix}ping`
          },
          {
            title: 'HELP',
            description: 'View command reference',
            rowId: `${config.prefix}help`
          }
        ]
      },
      {
        title: 'MEDIA VAULT',
        rows: [
          {
            title: 'IMAGE',
            description: 'Open image delivery action',
            rowId: `${config.prefix}image`
          },
          {
            title: 'MP3 AUDIO',
            description: 'Extract YouTube audio as MP3',
            rowId: `${config.prefix}mp3`
          }
        ]
      }
    ]
  });
}

function shutdown(signal) {
  shuttingDown = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  logger.info({ signal }, 'Shutting down bot');
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

startBot().catch((error) => {
  logger.error(error, 'Bot failed to start');
  scheduleReconnect('initial-start-failed');
});
