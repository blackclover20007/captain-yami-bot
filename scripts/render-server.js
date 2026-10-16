import http from 'node:http';

const port = Number(process.env.PORT || 10000);
const startedAt = new Date().toISOString();

if (!process.env.SESSION_ID?.startsWith('YAMI_SESSION_V1.')) {
  console.error('SESSION_ID is missing or invalid. Generate one from the Captain Yami Session Site and add it to Render environment variables.');
  process.exit(1);
}

const healthServer = http.createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/health' || req.url === '/')) {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(JSON.stringify({
      ok: true,
      service: 'captain-yami-bot',
      version: process.env.BOT_VERSION || 'Yami Black Clover',
      startedAt
    }));
  }
  res.writeHead(404);
  res.end('Not found');
});

healthServer.listen(port, '0.0.0.0', () => {
  console.log(`Captain Yami Render health server listening on 0.0.0.0:${port}`);
});

await import('./run-bot.js');

function shutdown(signal) {
  healthServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
