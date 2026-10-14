import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  createMediaCacheKey,
  findCachedMedia,
  getMediaCacheTemplate,
  prepareMediaCache,
  removeCachedMedia
} from '../media-cache.js';

const MAX_VIDEO_SIZE = 64 * 1024 * 1024;
const ytDlpCommand = existsSync(path.resolve('.tools/yt-dlp-venv/bin/yt-dlp'))
  ? path.resolve('.tools/yt-dlp-venv/bin/yt-dlp')
  : 'yt-dlp';

export async function handleSocialVideoDownload({
  sock,
  jid,
  argument,
  logger,
  platform,
  hosts
}) {
  let url;

  try {
    url = new URL(argument);
  } catch {
    await sock.sendMessage(jid, { text: `Please send a valid ${platform} URL.` });
    return false;
  }

  if (!hosts.includes(url.hostname.toLowerCase())) {
    await sock.sendMessage(jid, { text: `${platform} URLs only are supported.` });
    return false;
  }

  const cacheKey = createMediaCacheKey(platform, argument);
  await prepareMediaCache();

  const cachedFilePath = await findCachedMedia(cacheKey);
  if (cachedFilePath) {
    await sock.sendMessage(jid, {
      text: formatTransferCard({
        platform,
        status: 'CACHE HIT',
        percent: 100,
        speed: 'instant',
        detail: 'Using temporary cached media'
      })
    });

    await sock.sendMessage(jid, {
      video: { url: cachedFilePath },
      caption: `${platform} video downloaded from cache`
    });
    return true;
  }

  await sock.sendMessage(jid, {
    text: formatTransferCard({
      platform,
      status: 'INITIALIZING',
      percent: 0,
      speed: 'calculating...',
      detail: 'Preparing public media transfer'
    })
  });

  const outputPrefix = cacheKey;
  const outputTemplate = getMediaCacheTemplate(cacheKey);
  let lastProgressSentAt = 0;
  let lastProgress = -1;

  try {
    await runCommand(ytDlpCommand, [
      '--no-playlist',
      '--max-filesize', '64M',
      '--newline',
      '--progress',
      '--restrict-filenames',
      '-f', 'best[ext=mp4]/best',
      '--merge-output-format', 'mp4',
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
            platform,
            status: progress.percent >= 100 ? 'FINALIZING' : 'DOWNLOADING',
            percent: progress.percent,
            speed: progress.speed || 'calculating...',
            detail: progress.percent >= 100
              ? 'Preparing WhatsApp upload'
              : `Receiving ${platform} video`
          })
        });
      }
    });

    const files = (await fs.readdir(path.dirname(outputTemplate)))
      .filter((file) => file.startsWith(`${outputPrefix}.`));

    if (!files.length) throw new Error('Downloaded media file was not found');

    const filePath = path.resolve('./downloads', files[0]);
    const fileInfo = await fs.stat(filePath);
    if (fileInfo.size > MAX_VIDEO_SIZE) {
      throw new Error('The final video is larger than WhatsApp\'s 64 MB limit');
    }

    await sock.sendMessage(jid, {
      text: formatTransferCard({
        platform,
        status: 'UPLOADING',
        percent: 100,
        speed: 'complete',
        detail: 'Sending video to WhatsApp'
      })
    });

    await sock.sendMessage(jid, {
      video: { url: filePath },
      caption: `${platform} video downloaded`
    });

    // Keep successful media until the cache TTL expires for fast repeat requests.
    return true;
  } catch (error) {
    await removeCachedMedia(outputPrefix);
    logger.warn({ platform, error: error.message }, `${platform} download failed`);

    const message = error.code === 'ENOENT'
      ? 'yt-dlp is not installed. Run npm start to install it automatically.'
      : error.message.includes('larger than 64 MB') || error.message.includes('max-filesize')
        ? 'This video is too large. Please choose a shorter video.'
        : error.message.includes('timed out')
          ? 'The download timed out. Please try again with a shorter video.'
          : `${platform} download failed. The post may be private, restricted, or unavailable.`;

    await sock.sendMessage(jid, {
      text: formatTransferCard({
        platform,
        status: 'FAILED',
        percent: 0,
        speed: '--',
        detail: message
      })
    });
    return false;
  }
}

function formatTransferCard({ platform, status, percent, speed, detail }) {
  const safePercent = Math.max(0, Math.min(100, percent));
  const totalBlocks = 12;
  const filledBlocks = Math.round((safePercent / 100) * totalBlocks);
  const progressBar = '█'.repeat(filledBlocks) + '░'.repeat(totalBlocks - filledBlocks);

  return [
    `╭━━━ ${platform.toUpperCase()} TRANSFER ━━━╮`,
    `┃ STATUS  : ${status}`,
    `┃ PROGRESS: [${progressBar}] ${safePercent.toFixed(0)}%`,
    `┃ SPEED   : ${speed}`,
    `┃ DETAIL  : ${detail}`,
    '╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯'
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
