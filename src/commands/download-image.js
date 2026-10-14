import fs from 'node:fs/promises';

const MAX_IMAGE_SIZE = 16 * 1024 * 1024;

export async function handleImageDownload({ sock, jid, argument, logger }) {
  let url;

  try {
    url = new URL(argument);
  } catch {
    await sock.sendMessage(jid, {
      text: 'Please send a valid http(s) image URL.'
    });
    return false;
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    await sock.sendMessage(jid, {
      text: 'Only http(s) image URLs are supported.'
    });
    return false;
  }

  await sock.sendMessage(jid, { text: 'Downloading image...' });

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(30000)
    });
    const contentType = response.headers.get('content-type') || '';
    const contentLength = Number(response.headers.get('content-length') || 0);

    if (!response.ok || !contentType.startsWith('image/')) {
      throw new Error('URL did not return an image');
    }

    if (contentLength > MAX_IMAGE_SIZE) {
      throw new Error('Image is larger than 16 MB');
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_IMAGE_SIZE) {
      throw new Error('Image is larger than 16 MB');
    }

    await fs.mkdir('./downloads', { recursive: true });
    const filePath = `./downloads/${Date.now()}-image`;
    await fs.writeFile(filePath, buffer);

    await sock.sendMessage(jid, {
      image: buffer,
      caption: 'Downloaded image'
    });

    await fs.unlink(filePath).catch(() => {});
    return true;
  } catch (error) {
    logger.warn({ error: error.message }, 'Image download failed');
    await sock.sendMessage(jid, {
      text: `Image download failed: ${error.message}`
    });
    return false;
  }
}
