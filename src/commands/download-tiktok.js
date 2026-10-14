import { handleSocialVideoDownload } from './download-social.js';

export function handleTikTokDownload(options) {
  return handleSocialVideoDownload({
    ...options,
    platform: 'TikTok',
    hosts: ['tiktok.com', 'www.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com', 'm.tiktok.com']
  });
}
