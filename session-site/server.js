import 'dotenv/config';

import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { readFile, readdir, rm, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import makeWASocket, { Browsers, useMultiFileAuthState } from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import P from 'pino';

const root = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(root, '..');
const authDir = path.resolve(process.env.SESSION_AUTH_DIR || path.join(projectRoot, 'auth_info'));
const runtimeStatusPath = path.resolve(projectRoot, 'data/runtime-status.json');
const port = Number(process.env.PORT || 10000);
const siteKey = process.env.PAIRING_SITE_KEY || '';
const siteVersion = 'Ultra 1000';
const startedAt = new Date().toISOString();
const logger = P({ level: process.env.LOG_LEVEL || 'info' });

let pairing = { status: 'idle', mode: '', code: '', qr: '', phone: '', sessionId: '', delivery: '', message: 'The gate is dormant. Choose a pairing method.' };
let activeSocket = null;
let botChild = null;
let lastPairAt = 0;
let botStatus = 'waiting_for_session';
let saveCredsPromise = Promise.resolve();

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function cleanPhone(input) { return String(input || '').replace(/\D/g, ''); }
function keyIsValid(key) { return !siteKey || key === siteKey; }
function requestedKey(req, input = {}) { return req.headers['x-site-key'] || input.siteKey || ''; }

async function registered() {
  try {
    const creds = JSON.parse(await readFile(path.join(authDir, 'creds.json'), 'utf8'));
    return Boolean(creds.registered);
  } catch { return false; }
}

async function collectSessionId() {
  const files = {};
  async function walk(dir, prefix = '') {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const relative = path.join(prefix, entry.name);
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full, relative);
      else files[relative] = (await readFile(full)).toString('base64');
    }
  }
  await walk(authDir);
  return `YAMI_SESSION_V1.${gzipSync(Buffer.from(JSON.stringify(files))).toString('base64url')}`;
}

function persistCredentials(saveCreds, update) {
  saveCredsPromise = saveCredsPromise.then(() => saveCreds(update)).catch((error) => logger.warn({ error: error.message }, 'Credential persistence failed'));
}

async function currentBotStatus() {
  try {
    const status = JSON.parse(await readFile(runtimeStatusPath, 'utf8'));
    return status.status || botStatus;
  } catch { return botStatus; }
}

async function waitForCredentials() {
  await new Promise((resolve) => setTimeout(resolve, 1200));
  await saveCredsPromise;
}

function stopBot() {
  if (!botChild) return;
  botChild.kill('SIGTERM');
  botChild = null;
  botStatus = 'waiting_for_session';
}

async function startBotIfReady(ownerJid = '') {
  const hasPortableSession = process.env.SESSION_ID?.startsWith('YAMI_SESSION_V1.');
  if (botChild || (!(await registered()) && !hasPortableSession)) {
    if (!botChild && !(await registered()) && !hasPortableSession) botStatus = 'waiting_for_session';
    return;
  }

  botStatus = 'starting';
  botChild = spawn(process.execPath, [path.join(projectRoot, 'scripts', 'run-bot.js')], {
    cwd: projectRoot,
    env: {
      ...process.env,
      SESSION_ID: '',
      OWNER_JID: process.env.OWNER_JID || ownerJid
    },
    stdio: 'inherit'
  });
  botChild.on('spawn', () => { botStatus = 'starting'; });
  botChild.on('exit', (code) => {
    botChild = null;
    botStatus = code === 0 ? 'stopped' : 'restarting';
  });
}

async function finishPairing(sock, phone) {
  await waitForCredentials();
  const sessionId = await collectSessionId();
  pairing = { ...pairing, status: 'complete', sessionId, qr: '', delivery: 'web', message: 'Session linked. The bot is awakening from the Devil Gate…' };
  activeSocket = null;
  await sock.end?.(undefined);
  await startBotIfReady(phone ? `${phone}@s.whatsapp.net` : '');
  pairing = { ...pairing, delivery: 'web', message: 'WhatsApp linked. Captain Yami Bot is starting now. Copy the session only if you also want a second deployment.' };
}

function attachPairingSocket(sock, mode, phone, saveCreds) {
  activeSocket = sock;
  sock.ev.on('creds.update', (update) => persistCredentials(saveCreds, update));
  sock.ev.on('connection.update', async ({ connection, qr, lastDisconnect }) => {
    if (qr && mode === 'qr') {
      pairing = { ...pairing, status: 'qr', qr: await QRCode.toDataURL(qr, { width: 320, margin: 2 }), message: 'Scan the QR with WhatsApp → Linked devices → Link a device.' };
    }
    if (connection === 'open') await finishPairing(sock, phone);
    if (connection === 'close' && pairing.status !== 'complete') {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === 515 && mode === 'code' && pairing.code) {
        pairing = { ...pairing, status: 'reconnecting', qr: '', message: 'WhatsApp accepted the code. Reopening the Devil Gate automatically…' };
        activeSocket = null;
        await reconnectPairing(mode, phone);
        return;
      }
      activeSocket = null;
      pairing = { ...pairing, status: 'failed', code: '', qr: '', sessionId: '', message: `WhatsApp closed the gate (${code || 'temporary error'}). Remove an old linked device and try again.` };
    }
  });
}

async function reconnectPairing(mode, phone) {
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  saveCredsPromise = Promise.resolve();
  const sock = makeWASocket({
    auth: state,
    browser: Browsers.ubuntu('Chrome'),
    logger,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    fireInitQueries: false,
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 120000
  });
  attachPairingSocket(sock, mode, phone, saveCreds);
}

async function startPairing(mode, phone, requestedSiteKey) {
  if (!keyIsValid(requestedSiteKey)) throw new Error('Invalid gate key.');
  if (activeSocket || ['waiting', 'code', 'qr', 'awakening'].includes(pairing.status)) throw new Error('A pairing ritual is already active.');
  if (Date.now() - lastPairAt < 15000) throw new Error('Please wait 15 seconds before opening another gate.');
  if (mode === 'code' && (phone.length < 8 || phone.length > 15)) throw new Error('Enter an international number with country code.');
  if (await registered()) throw new Error('A session already exists. Use Reset Session or create a new deployment.');

  lastPairAt = Date.now();
  stopBot();
  await rm(authDir, { recursive: true, force: true });
  await mkdir(authDir, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  saveCredsPromise = Promise.resolve();
  pairing = { status: 'awakening', mode, code: '', qr: '', phone, sessionId: '', delivery: '', message: 'Opening the Black Clover gate…' };

  const sock = makeWASocket({
    auth: state,
    browser: Browsers.ubuntu('Chrome'),
    logger,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    fireInitQueries: false,
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 120000
  });
  attachPairingSocket(sock, mode, phone, saveCreds);

  if (mode === 'code') {
    pairing = { ...pairing, status: 'waiting', message: 'Requesting a private phone-linking code…' };
    await new Promise((resolve) => setTimeout(resolve, Number(process.env.PAIRING_REQUEST_DELAY_MS || 2500)));
    const code = await sock.requestPairingCode(phone);
    pairing = { ...pairing, status: 'code', code, message: 'WhatsApp → Linked devices → Link a device → Link with phone number.' };
  } else {
    pairing = { ...pairing, status: 'waiting', message: 'Waiting for WhatsApp to reveal the QR gate…' };
  }
}

async function body(req) {
  let value = '';
  for await (const chunk of req) value += chunk;
  try { return JSON.parse(value || '{}'); } catch { return {}; }
}

const server = http.createServer(async (req, res) => {
  try {
    const liveBotStatus = await currentBotStatus();
    if (req.method === 'GET' && req.url === '/health') return json(res, 200, { ok: true, service: 'captain-yami-unified', version: siteVersion, startedAt, botStatus: liveBotStatus, pairing: pairing.status });
    if (req.method === 'GET' && req.url === '/ready') return json(res, liveBotStatus === 'connected' ? 200 : 200, { ok: liveBotStatus === 'connected', botStatus: liveBotStatus, pairing: pairing.status });
    if (req.method === 'GET' && req.url === '/status') return json(res, 200, { service: 'captain-yami-unified', version: siteVersion, startedAt, uptimeSeconds: Math.floor((Date.now() - Date.parse(startedAt)) / 1000), botStatus: liveBotStatus, pairing: { ...pairing, sessionId: pairing.status === 'complete' ? pairing.sessionId : '' } });
    if (req.method === 'GET' && req.url === '/manus-routes.json') return json(res, 200, { routes: [{ path: '/', title: 'Captain Yami Session Gate' }] });

    if (req.method === 'GET' && req.url === '/api/status') {
      if (!keyIsValid(requestedKey(req))) return json(res, 403, { error: 'Invalid gate key.' });
      return json(res, 200, { ...pairing, botStatus: liveBotStatus, sessionId: pairing.status === 'complete' ? pairing.sessionId : '' });
    }
    if (req.method === 'POST' && req.url === '/api/pair') {
      const input = await body(req);
      const mode = input.mode === 'qr' ? 'qr' : 'code';
      const phone = cleanPhone(input.phone);
      startPairing(mode, phone, requestedKey(req, input)).catch((error) => { pairing = { ...pairing, status: 'failed', message: error.message }; });
      return json(res, 202, { ok: true, mode });
    }
    if (req.method === 'POST' && req.url === '/api/reset') {
      const input = await body(req);
      if (!keyIsValid(requestedKey(req, input))) return json(res, 403, { error: 'Invalid gate key.' });
      stopBot();
      activeSocket?.end?.(undefined);
      activeSocket = null;
      await rm(authDir, { recursive: true, force: true });
      pairing = { status: 'idle', mode: '', code: '', qr: '', phone: '', sessionId: '', delivery: '', message: 'Session deleted. The Devil Gate is ready for a new number.' };
      return json(res, 200, { ok: true });
    }
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      const html = await readFile(path.join(root, 'public', 'index.html'));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(html);
    }
    res.writeHead(404); res.end('Not found');
  } catch (error) {
    logger.error(error, 'Unified session site request failed');
    json(res, 500, { error: 'The Devil Gate encountered an internal error.' });
  }
});

server.listen(port, '0.0.0.0', async () => {
  logger.info({ port }, 'Captain Yami unified gate online');
  if (await registered()) {
    pairing = { ...pairing, status: 'complete', sessionId: await collectSessionId(), message: 'Existing WhatsApp session restored. Captain Yami Bot is online.' };
  }
  await startBotIfReady();
});

process.on('SIGTERM', () => { stopBot(); server.close(() => process.exit(0)); });
process.on('SIGINT', () => { stopBot(); server.close(() => process.exit(0)); });
