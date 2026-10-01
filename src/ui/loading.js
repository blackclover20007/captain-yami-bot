const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function showLoading(sock, jid, {
  title = 'MIDNIGHT PROCESS',
  steps = ['CONNECTING', 'PROCESSING', 'FINALIZING'],
  finalText = 'Process complete.',
  stepDelayMs = 700,
  completeDelayMs = 500
} = {}) {
  let messageKey;
  let canEdit = true;

  const update = async (status, percent, detail) => {
    const text = renderLoadingCard({ title, status, percent, detail });

    if (!messageKey || !canEdit) {
      const sent = await sock.sendMessage(jid, { text });
      messageKey = sent?.key;
      return;
    }

    try {
      await sock.sendMessage(jid, {
        text,
        edit: messageKey
      });
    } catch {
      // Some WhatsApp clients do not support editing this message type.
      canEdit = false;
      await sock.sendMessage(jid, { text });
    }
  };

  await update('STARTING', 0, 'Preparing request');

  for (let index = 0; index < steps.length; index += 1) {
    await wait(stepDelayMs);
    const percent = Math.round(((index + 1) / (steps.length + 1)) * 100);
    await update(steps[index], percent, 'Please wait...');
  }

  await wait(completeDelayMs);
  await update('COMPLETE', 100, finalText);
}

function renderLoadingCard({ title, status, percent, detail }) {
  const totalBlocks = 12;
  const filledBlocks = Math.round((percent / 100) * totalBlocks);
  const progressBar = '█'.repeat(filledBlocks) + '░'.repeat(totalBlocks - filledBlocks);

  return [
    `╭━━━ ${title} ━━━╮`,
    `┃ STATUS  : ${status}`,
    `┃ PROGRESS: [${progressBar}] ${percent}%`,
    `┃ DETAIL  : ${detail}`,
    '╰━━━━━━━━━━━━━━━━╯'
  ].join('\n');
}
