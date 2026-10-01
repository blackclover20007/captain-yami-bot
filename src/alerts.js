export async function notifyRateLimitBreach({
  sock,
  groupJid,
  webhookUrl,
  actorJid,
  command,
  event,
  reason,
  retryAfterMs
}) {
  const timestamp = new Date().toISOString();
  const seconds = Math.ceil((retryAfterMs || 0) / 1000);
  const payload = {
    timestamp,
    event,
    actorJid,
    command,
    reason,
    retryAfterSeconds: seconds
  };

  const notifications = [];

  if (groupJid) {
    notifications.push(
      sock.sendMessage(groupJid, {
        text: [
          '╭━━━ RATE LIMIT ALERT ━━━╮',
          `┃ TIME    : ${timestamp}`,
          `┃ EVENT   : ${event}`,
          `┃ ACTOR   : ${actorJid}`,
          `┃ COMMAND : ${command}`,
          `┃ REASON  : ${reason}`,
          `┃ RETRY   : ${seconds}s`,
          '╰━━━━━━━━━━━━━━━━━━━━━━╯'
        ].join('\n')
      })
    );
  }

  if (webhookUrl) {
    notifications.push(
      fetch(webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000)
      }).then((response) => {
        if (!response.ok) throw new Error(`webhook returned ${response.status}`);
      })
    );
  }

  const results = await Promise.allSettled(notifications);
  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('Rate-limit alert delivery failed:', result.reason?.message || result.reason);
    }
  }
}
