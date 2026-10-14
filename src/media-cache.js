import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const cacheDir = path.resolve(process.env.MEDIA_CACHE_DIR || './.cache/media');
const ttlMs = Number(process.env.MEDIA_CACHE_TTL_MS || 15 * 60 * 1000);
const maxBytes = Number(process.env.MEDIA_CACHE_MAX_BYTES || 512 * 1024 * 1024);

export function createMediaCacheKey(platform, url) {
  return `${platform.toLowerCase()}-${crypto
    .createHash('sha256')
    .update(`${platform}:${url}`)
    .digest('hex')
    .slice(0, 24)}`;
}

export async function prepareMediaCache() {
  await fs.mkdir(cacheDir, { recursive: true });
  await cleanupMediaCache();
}

export function getMediaCacheTemplate(cacheKey) {
  return path.join(cacheDir, `${cacheKey}.%(ext)s`);
}

export async function findCachedMedia(cacheKey) {
  const files = await fs.readdir(cacheDir).catch(() => []);
  const matchingFiles = files.filter((file) => file.startsWith(`${cacheKey}.`));

  for (const file of matchingFiles) {
    const filePath = path.join(cacheDir, file);
    const stats = await fs.stat(filePath).catch(() => null);
    if (!stats) continue;

    if (Date.now() - stats.mtimeMs > ttlMs) {
      await fs.unlink(filePath).catch(() => {});
      continue;
    }

    return filePath;
  }

  return null;
}

export async function removeCachedMedia(cacheKey) {
  const files = await fs.readdir(cacheDir).catch(() => []);
  await Promise.all(
    files
      .filter((file) => file.startsWith(`${cacheKey}.`))
      .map((file) => fs.unlink(path.join(cacheDir, file)).catch(() => {}))
  );
}

async function cleanupMediaCache() {
  const files = await fs.readdir(cacheDir).catch(() => []);
  const entries = [];

  for (const file of files) {
    const filePath = path.join(cacheDir, file);
    const stats = await fs.stat(filePath).catch(() => null);
    if (!stats?.isFile()) continue;

    if (Date.now() - stats.mtimeMs > ttlMs) {
      await fs.unlink(filePath).catch(() => {});
      continue;
    }

    entries.push({ filePath, size: stats.size, mtimeMs: stats.mtimeMs });
  }

  let totalBytes = entries.reduce((total, entry) => total + entry.size, 0);
  if (totalBytes <= maxBytes) return;

  entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
  for (const entry of entries) {
    if (totalBytes <= maxBytes) break;
    await fs.unlink(entry.filePath).catch(() => {});
    totalBytes -= entry.size;
  }
}
