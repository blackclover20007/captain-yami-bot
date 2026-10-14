import { existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const projectRoot = process.cwd();
const toolsDir = path.join(projectRoot, '.tools');
const venvDir = path.join(toolsDir, 'yt-dlp-venv');
const ytDlpPath = path.join(venvDir, 'bin', 'yt-dlp');

function commandWorks(command, args = ['--version']) {
  const result = spawnSync(command, args, { stdio: 'ignore' });
  return !result.error && result.status === 0;
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}`);
  }
}

function installYtDlp() {
  if (existsSync(ytDlpPath) && commandWorks(ytDlpPath)) {
    console.log('yt-dlp is ready.');
    return;
  }

  console.log('yt-dlp is missing; creating a local Python environment...');
  mkdirSync(toolsDir, { recursive: true });

  if (!existsSync(path.join(venvDir, 'bin', 'python'))) {
    run('python3', ['-m', 'venv', venvDir]);
  }

  run(path.join(venvDir, 'bin', 'python'), [
    '-m',
    'pip',
    'install',
    '--upgrade',
    'yt-dlp'
  ]);

  console.log('yt-dlp installed locally.');
}

function installFfmpeg() {
  if (commandWorks('ffmpeg', ['-version'])) {
    console.log('ffmpeg is ready.');
    return;
  }

  console.log('ffmpeg is missing; attempting automatic installation...');
  run('sudo', ['-n', 'apt-get', 'update']);
  run('sudo', ['-n', 'apt-get', 'install', '-y', 'ffmpeg']);
  console.log('ffmpeg installed.');
}

try {
  installYtDlp();
  installFfmpeg();
} catch (error) {
  console.error(`\nAutomatic tool installation failed: ${error.message}`);
  console.error('Install manually:');
  console.error('  python3 -m venv .tools/yt-dlp-venv');
  console.error('  .tools/yt-dlp-venv/bin/python -m pip install -U yt-dlp');
  console.error('  sudo apt-get update && sudo apt-get install -y ffmpeg');
  process.exit(1);
}
