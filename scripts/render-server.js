import http from 'node:http';
import { readFile } from 'node:fs/promises';

const port = Number(process.env.PORT || 10000);
const startedAt = new Date().toISOString();
const runtimeStatusPath = './data/runtime-status.json';
let runtimeStatus = { status: 'starting', updatedAt: startedAt };

if (!process.env.SESSION_ID?.startsWith('YAMI_SESSION_V1.')) {
  console.error('SESSION_ID is missing or invalid. Generate one from the Captain Yami Session Site and add it to Render environment variables.');
  process.exit(1);
}

async function refreshRuntimeStatus() {
  try {
    runtimeStatus = JSON.parse(await readFile(runtimeStatusPath, 'utf8'));
  } catch {
    // The child may not have written its first status yet.
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

const healthServer = http.createServer(async (req, res) => {
  await refreshRuntimeStatus();
  if (req.method === 'GET' && (req.url === '/health' || req.url === '/')) {
    return sendJson(res, 200, {
      ok: true,
      service: 'captain-yami-bot',
      version: process.env.BOT_VERSION || 'Yami Black Clover',
      startedAt,
      runtime: runtimeStatus
    });
  }
  if (req.method === 'GET' && req.url === '/ready') {
    const ready = runtimeStatus.status === 'connected';
    return sendJson(res, ready ? 200 : 503, {
      ok: ready,
      service: 'captain-yami-bot',
      ready,
      runtime: runtimeStatus
    });
  }
  if (req.method === 'GET' && req.url === '/status') {
    return sendJson(res, 200, { service: 'captain-yami-bot', startedAt, runtime: runtimeStatus });
  }
  res.writeHead(404);
  res.end('Not found');
});

healthServer.listen(port, '0.0.0.0', () => {
  console.log(`Captain Yami Render health server listening on 0.0.0.0:${port}`);
});

const monitor = setInterval(async () => {
  await refreshRuntimeStatus();
  const ageMs = Date.now() - Date.parse(runtimeStatus.updatedAt || startedAt);
  if (ageMs > 120000 && runtimeStatus.status !== 'connected') {
    console.warn(`WhatsApp runtime status is stale (${Math.round(ageMs / 1000)}s): ${runtimeStatus.status}`);
  }
}, 30000);
monitor.unref();

await import('./run-bot.js');

function shutdown() {
  clearInterval(monitor);
  healthServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
