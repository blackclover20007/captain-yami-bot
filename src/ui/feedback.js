import { existsSync } from 'node:fs';

export async function sendCommandFeedback({
  sock,
  jid,
  messageKey,
  success,
  kind = 'command',
  successSound,
  failureSound
}) {
  if (messageKey) {
    const reaction = success
      ? getSuccessReaction(kind)
      : '❌';

    await sock.sendMessage(jid, {
      react: {
        text: reaction,
        key: messageKey
      }
    }).catch(() => {});
  }

  const soundPath = success ? successSound : failureSound;
  if (soundPath && existsSync(soundPath)) {
    await sock.sendMessage(jid, {
      audio: { url: soundPath },
      mimetype: 'audio/ogg; codecs=opus',
      ptt: true
    }).catch(() => {});
  }
}

function getSuccessReaction(kind) {
  if (kind === 'owner') return '👑';
  if (kind === 'download') return '📥';
  if (kind === 'role') return '🛡️';
  if (kind === 'menu') return '✨';
  return '✅';
}
