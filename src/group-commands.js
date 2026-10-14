import fs from 'node:fs/promises';
import path from 'node:path';

const settingsPath = path.resolve('./data/group-settings.json');
const linkPattern = /(?:https?:\/\/|www\.)\S+/i;

export function createGroupController({ prefix = '!', logger }) {
  const settings = new Map();
  let loaded = false;

  async function ensureLoaded() {
    if (loaded) return;
    loaded = true;

    try {
      const saved = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
      for (const [jid, value] of Object.entries(saved)) {
        settings.set(jid, normalizeSettings(value));
      }
    } catch (error) {
      if (error.code !== 'ENOENT') logger.warn({ error: error.message }, 'Could not load group settings');
    }
  }

  function getSettings(jid) {
    if (!settings.has(jid)) {
      settings.set(jid, normalizeSettings({}));
    }
    return settings.get(jid);
  }

  async function saveSettings() {
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    await fs.writeFile(settingsPath, JSON.stringify(Object.fromEntries(settings), null, 2));
  }

  async function getMetadata(sock, jid) {
    try {
      return await sock.groupMetadata(jid);
    } catch (error) {
      logger.warn({ jid, error: error.message }, 'Could not read group metadata');
      return null;
    }
  }

  function isAdmin(metadata, senderJid) {
    const participant = metadata?.participants?.find((entry) => entry.id === senderJid);
    return Boolean(participant?.admin === 'admin' || participant?.admin === 'superadmin');
  }

  async function handle(sock, jid, text, senderJid) {
    if (!jid.endsWith('@g.us')) return false;
    await ensureLoaded();

    const parts = text.trim().split(/\s+/);
    const command = parts.shift()?.toLowerCase();
    const argument = parts.join(' ').trim();
    if (!command?.startsWith(prefix.toLowerCase())) return false;

    const commandName = command.slice(prefix.length);
    const supported = new Set(['groupinfo', 'admins', 'tagall', 'welcome', 'goodbye', 'antilink']);
    if (!supported.has(commandName)) return false;

    const metadata = await getMetadata(sock, jid);
    if (!metadata) {
      await sock.sendMessage(jid, { text: 'I could not read this group metadata.' });
      return { handled: true, success: false };
    }

    const settingsForGroup = getSettings(jid);
    const reply = (message) => sock.sendMessage(jid, { text: message });

    if (commandName === 'groupinfo') {
      const admins = metadata.participants.filter((entry) => entry.admin);
      await reply([
        '╭━━━ GROUP INFO ━━━╮',
        `┃ NAME    : ${metadata.subject || 'Unnamed group'}`,
        `┃ OWNER   : ${metadata.owner || 'Not available'}`,
        `┃ MEMBERS : ${metadata.participants.length}`,
        `┃ ADMINS  : ${admins.length}`,
        `┃ WELCOME : ${settingsForGroup.welcome ? 'ON' : 'OFF'}`,
        `┃ GOODBYE : ${settingsForGroup.goodbye ? 'ON' : 'OFF'}`,
        `┃ ANTILINK: ${settingsForGroup.antilink ? 'ON' : 'OFF'}`,
        '╰━━━━━━━━━━━━━━━━━━╯'
      ].join('\n'));
      return true;
    }

    if (commandName === 'admins') {
      const admins = metadata.participants.filter((entry) => entry.admin);
      await sock.sendMessage(jid, {
        text: `GROUP ADMINS\n\n${admins.length ? admins.map((entry, index) => `${index + 1}. @${entry.id.split('@')[0]}`).join('\n') : 'No admins found.'}`,
        mentions: admins.map((entry) => entry.id)
      });
      return true;
    }

    if (!isAdmin(metadata, senderJid)) {
      await reply('Only group admins can use this group-management command.');
      return { handled: true, success: false };
    }

    if (commandName === 'tagall') {
      const members = metadata.participants.map((entry) => entry.id);
      await sock.sendMessage(jid, {
        text: `GROUP ROLL CALL\n\n${members.map((member) => `@${member.split('@')[0]}`).join(' ')}`,
        mentions: members
      });
      return true;
    }

    if (!['on', 'off'].includes(argument.toLowerCase())) {
      await reply(`${prefix}${commandName} ${settingsForGroup[commandName] ? 'is ON' : 'is OFF'}. Use ${prefix}${commandName} on or ${prefix}${commandName} off.`);
      return true;
    }

    settingsForGroup[commandName] = argument.toLowerCase() === 'on';
    await saveSettings();
    await reply(`${commandName.toUpperCase()} is now ${settingsForGroup[commandName] ? 'ON' : 'OFF'} for this group.`);
    return true;
  }

  async function enforceAntiLink(sock, message, text) {
    const jid = message.key.remoteJid;
    if (!jid?.endsWith('@g.us')) return false;
    await ensureLoaded();

    const groupSettings = getSettings(jid);
    if (!groupSettings.antilink || !linkPattern.test(text)) return false;

    const senderJid = message.key.participant;
    const metadata = await getMetadata(sock, jid);
    if (!metadata || isAdmin(metadata, senderJid)) return false;

    await sock.sendMessage(jid, { delete: message.key }).catch(() => {});
    await sock.sendMessage(jid, {
      text: `@${senderJid.split('@')[0]}, links are disabled in this group.`,
      mentions: [senderJid]
    });
    return true;
  }

  async function handleParticipantUpdate(sock, update) {
    const { id: jid, participants, action } = update;
    if (!jid?.endsWith('@g.us')) return;
    await ensureLoaded();

    const groupSettings = getSettings(jid);
    if (action === 'add' && groupSettings.welcome) {
      await sock.sendMessage(jid, {
        text: `WELCOME\n\n${participants.map((member) => `Welcome @${member.split('@')[0]} to the group.`).join('\n')}`,
        mentions: participants
      });
    }

    if ((action === 'remove' || action === 'leave') && groupSettings.goodbye) {
      await sock.sendMessage(jid, {
        text: `GOODBYE\n\n${participants.map((member) => `Goodbye @${member.split('@')[0]}.`).join('\n')}`,
        mentions: participants
      });
    }
  }

  return { handle, enforceAntiLink, handleParticipantUpdate };
}

function normalizeSettings(value) {
  return {
    welcome: Boolean(value?.welcome),
    goodbye: Boolean(value?.goodbye),
    antilink: Boolean(value?.antilink)
  };
}
