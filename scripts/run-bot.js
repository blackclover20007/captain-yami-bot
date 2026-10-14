import { appendFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

const crashLogPath = path.resolve('./data/crash-recovery.jsonl');
const restartExitCode = 75;
const maxRestartDelayMs = 30000;
let shuttingDown = false;
let child = null;
let restartAttempt = 0;

async function writeRecoveryLog(entry) {
  try {
    await mkdir(path.dirname(crashLogPath), { recursive: true });
    await appendFile(crashLogPath, `${JSON.stringify({
      timestamp: new Date().toISOString(),
      ...entry
    })}\n`, 'utf8');
  } catch (error) {
    console.error('Could not write crash-recovery log:', error.message);
  }
}

function startChild() {
  if (shuttingDown) return;

  child = spawn(process.execPath, ['src/index.js'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit'
  });

  const childStartedAt = Date.now();
  child.on('error', async (error) => {
    await writeRecoveryLog({
      event: 'child_error',
      pid: child.pid,
      error: error.message
    });
  });

  child.on('exit', async (code, signal) => {
    child = null;

    if (shuttingDown || (code === 0 && !signal)) {
      await writeRecoveryLog({
        event: 'clean_exit',
        code,
        signal,
        uptimeMs: Date.now() - childStartedAt
      });
      return;
    }

    const delay = Math.min(maxRestartDelayMs, 1000 * 2 ** restartAttempt);
    restartAttempt += 1;

    await writeRecoveryLog({
      event: 'crash_recovery',
      code,
      signal,
      requestedRestart: code === restartExitCode,
      uptimeMs: Date.now() - childStartedAt,
      restartAttempt,
      restartDelayMs: delay
    });

    console.error(`Captain Yami stopped unexpectedly; restarting in ${delay}ms...`);
    setTimeout(startChild, delay);
  });
}

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  if (child) {
    child.kill(signal);
    setTimeout(() => process.exit(0), 5000).unref();
  } else {
    process.exit(0);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

console.log('Captain Yami crash-recovery supervisor started.');
startChild();
