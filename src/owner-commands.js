import fs from 'node:fs/promises';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { notifyRateLimitBreach } from './alerts.js';
import { showLoading } from './ui/loading.js';

const auditLogPath = path.resolve('./data/owner-audit.jsonl');
const accessControlPath = path.resolve('./data/access-control.json');

async function recordOwnerAudit({ jid, role, command, outcome = 'accepted' }) {
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    jid,
    role,
    command,
    outcome
  });

  try {
    await fs.mkdir(path.dirname(auditLogPath), { recursive: true });
    await fs.appendFile(auditLogPath, `${entry}\n`, 'utf8');
  } catch (error) {
    // Auditing must not take the bot offline, but the failure is visible in logs.
    console.error('Owner audit write failed:', error.message);
  }
}

export function normalizeJid(value = '') {
  const input = value.trim();
  if (!input) return '';
  if (input.includes('@')) return input;
  return `${input.replace(/\D/g, '')}@s.whatsapp.net`;
}

function normalizeJidList(value = '') {
  return new Set(
    value
      .split(',')
      .map((item) => normalizeJid(item))
      .filter(Boolean)
  );
}

const commandRoles = {
  ownerhelp: ['owner', 'sudoer', 'moderator'],
  ownerstatus: ['owner', 'sudoer', 'moderator'],
  ownerping: ['owner', 'sudoer', 'moderator'],
  ownerrestart: ['owner'],
  ownershutdown: ['owner'],
  setprefix: ['owner'],
  setname: ['owner'],
  setcooldown: ['owner', 'sudoer'],
  maintenance: ['owner', 'sudoer'],
  maintenanceoff: ['owner', 'sudoer'],
  ownerstats: ['owner', 'sudoer', 'moderator'],
  userinfo: ['owner', 'sudoer', 'moderator'],
  block: ['owner', 'sudoer', 'moderator'],
  unblock: ['owner', 'sudoer', 'moderator'],
  blocked: ['owner', 'sudoer', 'moderator'],
  announce: ['owner', 'sudoer', 'moderator'],
  ownersend: ['owner', 'sudoer'],
  cleardownloads: ['owner', 'sudoer'],
  tools: ['owner', 'sudoer'],
  ownermenu: ['owner', 'sudoer', 'moderator'],
  addsudo: ['owner'],
  removesudo: ['owner'],
  addmoderator: ['owner'],
  removemoderator: ['owner'],
  roles: ['owner', 'sudoer', 'moderator'],
  rolemenu: ['owner'],
  roleui_addsudo: ['owner'],
  roleui_removesudo: ['owner'],
  roleui_addmoderator: ['owner'],
  roleui_removemoderator: ['owner']
};

function loadAccessControl() {
  if (!existsSync(accessControlPath)) return null;

  try {
    return JSON.parse(readFileSync(accessControlPath, 'utf8'));
  } catch (error) {
    console.error('Access-control file could not be read:', error.message);
    return null;
  }
}

function saveAccessControl(sudoerJids, moderatorJids) {
  mkdirSync(path.dirname(accessControlPath), { recursive: true });
  writeFileSync(accessControlPath, JSON.stringify({
    updatedAt: new Date().toISOString(),
    sudoers: [...sudoerJids].sort(),
    moderators: [...moderatorJids].sort()
  }, null, 2));
}

export function createOwnerController({ config, logger, downloadLimiter, roleLimiter = null }) {
  const ownerJid = normalizeJid(config.ownerJid);
  const sudoerJids = normalizeJidList(config.sudoJids);
  const moderatorJids = normalizeJidList(config.moderatorJids);
  const savedAccessControl = loadAccessControl();
  if (savedAccessControl) {
    sudoerJids.clear();
    moderatorJids.clear();
    normalizeJidList((savedAccessControl.sudoers || []).join(',')).forEach((jid) => sudoerJids.add(jid));
    normalizeJidList((savedAccessControl.moderators || []).join(',')).forEach((jid) => moderatorJids.add(jid));
  };
  const blocked = new Set();
  const pendingRoleActions = new Map();
  const startedAt = Date.now();
  const stats = {
    messages: 0,
    commands: 0,
    downloads: 0
  };
  let maintenanceMode = false;

  const controller = {
    ownerJid,
    isOwner: (jid) => Boolean(ownerJid && jid === ownerJid),
    getRole: (jid) => {
      if (jid === ownerJid && ownerJid) return 'owner';
      if (sudoerJids.has(jid)) return 'sudoer';
      if (moderatorJids.has(jid)) return 'moderator';
      return '';
    },
    isAuthorized: (jid) => Boolean(controller.getRole(jid)),
    isBlocked: (jid) => blocked.has(jid),
    isMaintenance: () => maintenanceMode,
    recordMessage: (text) => {
      stats.messages += 1;
      if (text?.startsWith(config.prefix)) stats.commands += 1;
    },
    recordDownload: () => {
      stats.downloads += 1;
    },
    async handle(sock, jid, text, sourceMessage = null) {
      const parts = text.trim().split(/\s+/);
      const command = parts.shift()?.toLowerCase();
      const argument = parts.join(' ').trim();
      const prefix = config.prefix.toLowerCase();
      const role = controller.getRole(jid);
      const reply = (message) => showLoading(sock, jid, {
        title: 'OWNER CONTROL',
        steps: ['AUTHORIZING', 'EXECUTING'],
        finalText: message,
        stepDelayMs: 250,
        completeDelayMs: 150
      });
      const consumeRoleAction = async () => {
        const result = roleLimiter?.tryAcquire(jid) || { allowed: true };
        if (result.allowed) return true;

        const seconds = Math.ceil(result.retryAfterMs / 1000);
        await notifyRateLimitBreach({
          sock,
          groupJid: config.ownerLogGroupJid,
          webhookUrl: config.alertWebhookUrl,
          actorJid: jid,
          command: 'role-management',
          event: 'role_rate_limit',
          reason: result.reason,
          retryAfterMs: result.retryAfterMs
        });
        await reply(
          result.reason === 'window'
            ? `Role-action limit reached. Try again in about ${seconds} seconds.`
            : `Please wait ${seconds} seconds before another role change.`
        );
        return false;
      };

      if (!role) return false;

      if (role === 'owner' && pendingRoleActions.has(jid) && !command?.startsWith(prefix)) {
        const action = pendingRoleActions.get(jid);
        pendingRoleActions.delete(jid);
        if (!(await consumeRoleAction())) return true;
        const target = normalizeJid(text);

        if (!target || target === ownerJid) {
          await reply('Invalid target. The owner cannot be changed.');
          return true;
        }

        if (action === 'addsudo') {
          sudoerJids.add(target);
          moderatorJids.delete(target);
          saveAccessControl(sudoerJids, moderatorJids);
          await reply(`Sudoer role granted to ${target}`);
        } else if (action === 'addmoderator') {
          moderatorJids.add(target);
          sudoerJids.delete(target);
          saveAccessControl(sudoerJids, moderatorJids);
          await reply(`Moderator role granted to ${target}`);
        } else if (action === 'removesudo') {
          sudoerJids.delete(target);
          saveAccessControl(sudoerJids, moderatorJids);
          await reply(`Sudoer role removed from ${target}`);
        } else if (action === 'removemoderator') {
          moderatorJids.delete(target);
          saveAccessControl(sudoerJids, moderatorJids);
          await reply(`Moderator role removed from ${target}`);
        }
        return true;
      }

      if (role === 'owner' && command === `${prefix}cancel` && pendingRoleActions.has(jid)) {
        pendingRoleActions.delete(jid);
        await reply('Role-management action cancelled.');
        return true;
      }

      if (!command?.startsWith(prefix)) return false;

      const ownerCommand = command.slice(prefix.length);

      if (controller.getRole(jid) !== 'owner' && !commandRoles[ownerCommand]?.includes(role)) {
        await recordOwnerAudit({
          jid,
          role,
          command: ownerCommand,
          outcome: 'denied'
        });
        await sendCommandFeedback({
          sock,
          jid,
          messageKey: sourceMessage?.key,
          success: false,
          failureSound: config.failureSound
        });
        await reply(`Access denied. Your role (${role}) cannot use ${config.prefix}${ownerCommand}.`);
        return { handled: true, success: false };
      }

      await recordOwnerAudit({
        jid,
        role,
        command: ownerCommand
      });

      switch (ownerCommand) {
        // 1. Show all owner commands.
        case 'ownerhelp':
          await reply([
            'OWNER COMMANDS',
            '',
            `${config.prefix}ownerhelp - show this list`,
            `${config.prefix}ownerstatus - bot status`,
            `${config.prefix}ownerping - owner connection test`,
            `${config.prefix}ownerrestart - restart process`,
            `${config.prefix}ownershutdown - stop process`,
            `${config.prefix}setprefix <value> - change command prefix`,
            `${config.prefix}setname <value> - change bot display name`,
            `${config.prefix}setcooldown <seconds> - set download cooldown`,
            `${config.prefix}maintenance - pause normal users`,
            `${config.prefix}maintenanceoff - resume normal users`,
            `${config.prefix}ownerstats - message statistics`,
            `${config.prefix}userinfo <jid> - inspect a JID`,
            `${config.prefix}block <jid> - block a user`,
            `${config.prefix}unblock <jid> - unblock a user`,
            `${config.prefix}blocked - list blocked users`,
            `${config.prefix}announce <text> - send to this chat`,
            `${config.prefix}ownersend <jid> | <text> - send direct message`,
            `${config.prefix}cleardownloads - remove temporary files`,
            `${config.prefix}tools - check downloader tools`,
            `${config.prefix}addsudo <jid> - promote to sudoer`,
            `${config.prefix}removesudo <jid> - demote sudoer`,
            `${config.prefix}addmoderator <jid> - promote to moderator`,
            `${config.prefix}removemoderator <jid> - demote moderator`,
            `${config.prefix}roles [jid] - inspect access roles`,
            `${config.prefix}rolemenu - open visual role manager`,
            `${config.prefix}cancel - cancel a pending role action`
          ].join('\n'));
          return true;

        // 2. Show process and connection status.
        case 'ownerstatus':
          await reply([
            'OWNER STATUS',
            '',
            `Uptime: ${formatDuration(process.uptime() * 1000)}`,
            `Memory: ${formatBytes(process.memoryUsage().rss)}`,
            `Maintenance: ${maintenanceMode ? 'ON' : 'OFF'}`,
            `Your role: ${role}`,
            `Owner JID: ${ownerJid || 'NOT CONFIGURED'}`,
            `Node: ${process.version}`
          ].join('\n'));
          return true;

        // 3. Test owner access.
        case 'ownerping':
          await reply('OWNER PONG - authorization verified.');
          return true;

        // 4. Restart through the process manager.
        case 'ownerrestart':
          await reply('Restarting bot process...');
          setTimeout(() => process.exit(75), 500);
          return true;

        // 5. Stop the bot.
        case 'ownershutdown':
          await reply('Shutting down bot process...');
          setTimeout(() => process.exit(0), 500);
          return true;

        // 6. Change command prefix at runtime.
        case 'setprefix':
          if (!argument || argument.length > 3 || /\s/.test(argument)) {
            await reply(`Usage: ${config.prefix}setprefix <one-to-three characters>`);
          } else {
            const oldPrefix = config.prefix;
            config.prefix = argument;
            await reply(`Command prefix changed from ${oldPrefix} to ${config.prefix}`);
          }
          return true;

        // 7. Change bot display name at runtime.
        case 'setname':
          if (!argument) await reply(`Usage: ${config.prefix}setname <name>`);
          else {
            config.name = argument.slice(0, 60);
            await reply(`Bot name changed to: ${config.name}`);
          }
          return true;

        // 8. Change download cooldown at runtime.
        case 'setcooldown': {
          const seconds = Number(argument);
          if (!Number.isFinite(seconds) || seconds < 0 || seconds > 86400) {
            await reply(`Usage: ${config.prefix}setcooldown <seconds between 0 and 86400>`);
          } else {
            downloadLimiter.cooldownMs = seconds * 1000;
            await reply(`Download cooldown set to ${seconds} seconds.`);
          }
          return true;
        }

        // 9. Enable maintenance mode.
        case 'maintenance':
          maintenanceMode = true;
          await reply('Maintenance mode enabled. Normal users will receive a maintenance response.');
          return true;

        // 10. Disable maintenance mode.
        case 'maintenanceoff':
          maintenanceMode = false;
          await reply('Maintenance mode disabled. Bot is accepting normal commands.');
          return true;

        // 11. Show message and download statistics.
        case 'ownerstats':
          await reply([
            'BOT STATISTICS',
            '',
            `Messages: ${stats.messages}`,
            `Commands: ${stats.commands}`,
            `Downloads: ${stats.downloads}`,
            `Blocked users: ${blocked.size}`,
            `Uptime: ${formatDuration(Date.now() - startedAt)}`
          ].join('\n'));
          return true;

        // 12. Inspect a WhatsApp JID.
        case 'userinfo': {
          const target = normalizeJid(argument || jid);
          await reply([
            'USER INFO',
            '',
            `JID: ${target}`,
            `Blocked: ${blocked.has(target) ? 'YES' : 'NO'}`,
            `Owner: ${target === ownerJid ? 'YES' : 'NO'}`
          ].join('\n'));
          return true;
        }

        // 13. Block a user.
        case 'block': {
          const target = normalizeJid(argument);
          if (!target || target === ownerJid) await reply('Usage: block a valid non-owner JID.');
          else {
            blocked.add(target);
            await reply(`Blocked: ${target}`);
          }
          return true;
        }

        // 14. Unblock a user.
        case 'unblock': {
          const target = normalizeJid(argument);
          blocked.delete(target);
          await reply(`Unblocked: ${target || 'no user'}`);
          return true;
        }

        // 15. List blocked users.
        case 'blocked':
          await reply(blocked.size ? `BLOCKED USERS\n\n${[...blocked].join('\n')}` : 'No blocked users.');
          return true;

        // 16. Send an announcement to the current chat.
        case 'announce':
          if (!argument) await reply(`Usage: ${config.prefix}announce <message>`);
          else await sock.sendMessage(jid, { text: `ANNOUNCEMENT\n\n${argument}` });
          return true;

        // 17. Send a direct message to a specified JID.
        case 'ownersend': {
          const separator = argument.indexOf('|');
          if (separator < 1) {
            await reply(`Usage: ${config.prefix}ownersend <phone-or-jid> | <message>`);
          } else {
            const target = normalizeJid(argument.slice(0, separator));
            const message = argument.slice(separator + 1).trim();
            if (!target || !message) await reply('Both recipient and message are required.');
            else {
              await sock.sendMessage(target, { text: message });
              await reply(`Message sent to ${target}`);
            }
          }
          return true;
        }

        // 18. Delete temporary downloaded files.
        case 'cleardownloads': {
          const files = await fs.readdir('./downloads').catch(() => []);
          await Promise.all(files.map((file) => fs.unlink(path.resolve('./downloads', file)).catch(() => {})));
          await reply(`Deleted ${files.length} temporary download file(s).`);
          return true;
        }

        // 19. Check yt-dlp and ffmpeg availability.
        case 'tools':
          await reply([
            'DOWNLOADER TOOLS',
            '',
            `yt-dlp: ${toolVersion('yt-dlp')}`,
            `ffmpeg: ${toolVersion('ffmpeg')}`
          ].join('\n'));
          return true;

        // 20. Promote a user to sudoer.
        case 'addsudo': {
          if (!(await consumeRoleAction())) return true;
          const target = normalizeJid(argument);
          if (!target || target === ownerJid) {
            await reply(`Usage: ${config.prefix}addsudo <phone number or JID>`);
          } else {
            sudoerJids.add(target);
            moderatorJids.delete(target);
            saveAccessControl(sudoerJids, moderatorJids);
            await reply(`Sudoer role granted to ${target}`);
          }
          return true;
        }

        // 21. Demote a sudoer.
        case 'removesudo': {
          if (!(await consumeRoleAction())) return true;
          const target = normalizeJid(argument);
          sudoerJids.delete(target);
          saveAccessControl(sudoerJids, moderatorJids);
          await reply(`Sudoer role removed from ${target || 'no user'}`);
          return true;
        }

        // 22. Promote a user to moderator.
        case 'addmoderator': {
          if (!(await consumeRoleAction())) return true;
          const target = normalizeJid(argument);
          if (!target || target === ownerJid) {
            await reply(`Usage: ${config.prefix}addmoderator <phone number or JID>`);
          } else {
            moderatorJids.add(target);
            sudoerJids.delete(target);
            saveAccessControl(sudoerJids, moderatorJids);
            await reply(`Moderator role granted to ${target}`);
          }
          return true;
        }

        // 23. Demote a moderator.
        case 'removemoderator': {
          if (!(await consumeRoleAction())) return true;
          const target = normalizeJid(argument);
          moderatorJids.delete(target);
          saveAccessControl(sudoerJids, moderatorJids);
          await reply(`Moderator role removed from ${target || 'no user'}`);
          return true;
        }

        // 24. Inspect a user's effective role or list all roles.
        case 'roles': {
          if (argument) {
            const target = normalizeJid(argument);
            await reply(`Role for ${target}: ${controller.getRole(target) || 'none'}`);
          } else {
            await reply([
              'ACCESS ROLES',
              '',
              `Owner: ${ownerJid || 'not configured'}`,
              `Sudoers: ${sudoerJids.size ? [...sudoerJids].join(', ') : 'none'}`,
              `Moderators: ${moderatorJids.size ? [...moderatorJids].join(', ') : 'none'}`
            ].join('\n'));
          }
          return true;
        }

        // Interactive role manager: select an action, then reply with a JID.
        case 'rolemenu':
          await reply('Opening role management interface...');
          await sock.sendMessage(jid, {
            text: 'OWNER ROLE MANAGER\n\nSelect an action. The next message should contain a phone number or JID.',
            title: 'ROLE MANAGEMENT',
            footer: 'Owner access only',
            buttonText: 'MANAGE ROLES',
            sections: [
              {
                title: 'PROMOTE',
                rows: [
                  { title: 'ADD SUDOER', description: 'Grant operational access', rowId: `${config.prefix}roleui_addsudo` },
                  { title: 'ADD MODERATOR', description: 'Grant moderation access', rowId: `${config.prefix}roleui_addmoderator` }
                ]
              },
              {
                title: 'DEMOTE',
                rows: [
                  { title: 'REMOVE SUDOER', description: 'Remove sudoer access', rowId: `${config.prefix}roleui_removesudo` },
                  { title: 'REMOVE MODERATOR', description: 'Remove moderator access', rowId: `${config.prefix}roleui_removemoderator` }
                ]
              },
              {
                title: 'INSPECT',
                rows: [
                  { title: 'VIEW ALL ROLES', description: 'List current access assignments', rowId: `${config.prefix}roles` }
                ]
              }
            ]
          });
          return true;

        case 'roleui_addsudo':
        case 'roleui_removesudo':
        case 'roleui_addmoderator':
        case 'roleui_removemoderator': {
          const action = ownerCommand.replace('roleui_', '');
          pendingRoleActions.set(jid, action);
          await reply(`Reply with the target phone number or JID for: ${action}.\nSend ${config.prefix}cancel to cancel.`);
          return true;
        }

        // Return the dark main menu.
        case 'ownermenu':
          await reply('Opening owner control panel...');
          await sock.sendMessage(jid, {
            text: 'OWNER CONTROL PANEL\n\nSend !ownerhelp to see all owner commands.'
          });
          return true;

        default:
          return false;
      }
    }
  };

  return controller;
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(1)} ${units[index]}`;
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}h ${minutes}m ${seconds}s`;
}

function toolVersion(command) {
  const result = spawnSync(command, ['--version'], { encoding: 'utf8' });
  if (result.error || result.status !== 0) return 'not available';
  return result.stdout.trim().split('\n')[0].slice(0, 100);
}
