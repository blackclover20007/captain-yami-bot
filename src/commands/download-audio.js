import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const MAX_AUDIO_SIZE = 32 * 1024 * 1024;
const allowedHosts = new Set([
  'youtube.com',
  'www.youtube.com',
  'youtu.be',
  'm.youtube.com'
]);
const ytDlpCommand = existsSync(path.resolve('.tools/yt-dlp-venv/bin/yt-dlp'))
  ? path.resolve('.tools/yt-dlp-venv/bin/yt-dlp')
  : 'yt-dlp';

export async function handleAudioDownload({ sock, jid, argument, logger }) {
  let url;

  try {
    url = new URL(argument);
  } catch {
    await sock.sendMessage(jid, { text: 'Please send a valid YouTube URL.' });
    return false;
  }

  if (!allowedHosts.has(url.hostname.toLowerCase())) {
    await sock.sendMessage(jid, { text: 'This command accepts YouTube URLs only.' });
    return false;
  }

  await sock.sendMessage(jid, {
    text: formatTransferCard({
      status: 'INITIALIZING',
      percent: 0,
      speed: 'calculating...',
      detail: 'Preparing MP3 audio extraction'
    })
  });

  await fs.mkdir('./downloads', { recursive: true });
  const outputPrefix = `${Date.now()}-audio`;
  const outputTemplate = path.resolve('./downloads', `${outputPrefix}.%(ext)s`);
  let lastProgressSentAt = 0;
  let lastProgress = -1;

  try {
    await runCommand(ytDlpCommand, [
      '--no-playlist',
      '--max-filesize', '32M',
      '--newline',
      '--progress',
      '--extract-audio',
      '--audio-format', 'mp3',
      '--audio-quality', '128K',
      '-o', outputTemplate,
      argument
    ], 180000, async (progress) => {
      const now = Date.now();
      const enoughTimePassed = now - lastProgressSentAt >= 10000;
      const meaningfulChange = progress.percent - lastProgress >= 10;

      if (progress.percent >= 0 && (enoughTimePassed || meaningfulChange)) {
        lastProgressSentAt = now;
        lastProgress = progress.percent;

        await sock.sendMessage(jid, {
          text: formatTransferCard({
            status: progress.percent >= 100 ? 'ENCODING MP3' : 'EXTRACTING AUDIO',
            percent: progress.percent,
            speed: progress.speed || 'calculating...',
            detail: progress.percent >= 100
              ? 'Converting audio to MP3'
              : 'Receiving audio stream'
          })
        });
      }
    });

    const files = (await fs.readdir('./downloads'))
      .filter((file) => file.startsWith(`${outputPrefix}.`));

    if (!files.length) throw new Error('MP3 file was not found');

    const filePath = path.resolve('./downloads', files[0]);
    const fileInfo = await fs.stat(filePath);

    if (fileInfo.size > MAX_AUDIO_SIZE) {
      throw new Error('The final MP3 is larger than 32 MB');
    }

    await sock.sendMessage(jid, {
      text: formatTransferCard({
        status: 'UPLOADING',
        percent: 100,
        speed: 'complete',
        detail: 'Sending MP3 to WhatsApp'
      })
    });

    await sock.sendMessage(jid, {
      audio: { url: filePath },
      mimetype: 'audio/mpeg',
      fileName: `${outputPrefix}.mp3`,
      ptt: false
    });

    await fs.unlink(filePath).catch(() => {});
    return true;
  } catch (error) {
    const files = (await fs.readdir('./downloads').catch(() => []))
      .filter((file) => file.startsWith(`${outputPrefix}.`));
    await Promise.all(
      files.map((file) => fs.unlink(path.resolve('./downloads', file)).catch(() => {}))
    );

    logger.warn({ error: error.message }, 'MP3 download failed');
    const message = error.code === 'ENOENT'
      ? 'yt-dlp is not installed. Install it with: python3 -m pip install -U yt-dlp'
      : error.message.includes('larger than 32 MB') || error.message.includes('max-filesize')
        ? 'This audio file is too large. Please choose a shorter video.'
        : error.message.includes('timed out')
          ? 'The MP3 extraction timed out. Please try a shorter video.'
          : `MP3 download failed: ${error.message}`;

    await sock.sendMessage(jid, {
      text: formatTransferCard({
        status: 'FAILED',
        percent: 0,
        speed: '--',
        detail: message
      })
    });
    return false;
  }
}

function formatTransferCard({ status, percent, speed, detail }) {
  const safePercent = Math.max(0, Math.min(100, percent));
  const totalBlocks = 12;
  const filledBlocks = Math.round((safePercent / 100) * totalBlocks);
  const progressBar = '█'.repeat(filledBlocks) + '░'.repeat(totalBlocks - filledBlocks);

  return [
    '╭━━━ MIDNIGHT AUDIO TRANSFER ━━━╮',
    `┃ STATUS  : ${status}`,
    `┃ PROGRESS: [${progressBar}] ${safePercent.toFixed(0)}%`,
    `┃ SPEED   : ${speed}`,
    `┃ DETAIL  : ${detail}`,
    '╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯'
  ].join('\n');
}

function runCommand(command, args, timeoutMs, onProgress) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let lineBuffer = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      reject(new Error('download timed out'));
    }, timeoutMs);

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      lineBuffer += text;
      const lines = lineBuffer.split(/\r?\n/);
      lineBuffer = lines.pop() || '';

      for (const line of lines) {
        const match = line.match(/(\d+(?:\.\d+)?)%.*?at\s+([^ ]+)/);
        if (match && onProgress) {
          Promise.resolve(onProgress({
            percent: Number(match[1]),
            speed: match[2]
          })).catch(() => {});
        }
      }
    });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) return resolve();
      reject(new Error(stderr.trim().slice(-500) || `process exited with code ${code}`));
    });
  });
}
