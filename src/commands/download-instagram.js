import { handleSocialVideoDownload } from './download-social.js';

export function handleInstagramDownload(options) {
  return handleSocialVideoDownload({
    ...options,
    platform: 'Instagram',
    hosts: ['instagram.com', 'www.instagram.com', 'm.instagram.com']
  });
}
