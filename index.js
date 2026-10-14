import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const requiredMajor = 20;
const currentMajor = Number(process.versions.node.split('.')[0]);

if (currentMajor < requiredMajor) {
  console.error(`Captain Yami Bot requires Node.js ${requiredMajor} or newer.`);
  console.error(`This panel is running Node.js ${process.versions.node}. Change the server runtime to Node.js 20+ in WispyByte.`);
  process.exit(1);
}

if (!existsSync('./node_modules/dotenv/package.json')) {
  console.log('Dependencies are missing. Installing with npm...');
  const result = spawnSync('npm', ['install', '--omit=dev'], { stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    console.error('Dependency installation failed. Run npm install manually, then restart the server.');
    process.exit(result.status || 1);
  }
}

// Panel-compatible entrypoint. WispyByte can start this with: node index.js
await import('./scripts/run-bot.js');
