#!/usr/bin/env node
// Health-check for the Midnight bboard dev environment.
// Run: npm run doctor
import { execSync } from 'node:child_process';
import { existsSync, accessSync, constants } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

const checks = [];
let hasFailure = false;

function check(name, fn) {
  try {
    const detail = fn();
    checks.push({ name, ok: true, detail });
  } catch (e) {
    checks.push({ name, ok: false, detail: e.message ?? String(e) });
    hasFailure = true;
  }
}

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf-8', shell: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

check('Node.js version', () => {
  const version = process.version.slice(1);
  const major = Number(version.split('.')[0]);
  if (major < 24) throw new Error(`found ${version}, need >= 24 — install from https://nodejs.org`);
  return version;
});

check('npm', () => sh('npm --version'));

check('Docker CLI', () => sh('docker --version'));

check('Docker daemon running', () => {
  sh('docker info');
  return 'running';
});

check('Docker Compose plugin', () => sh('docker compose version'));

check('Compact CLI', () => {
  const out = sh('compact --version');
  return out;
});

check('Compact compiler toolchain', () => {
  const out = sh('compact list');
  if (!out.includes('*')) throw new Error("no toolchain installed — run 'compact update'");
  return out.split('\n').find((l) => l.includes('*'))?.trim() ?? 'installed';
});

check('Contract artifacts compiled', () => {
  const managed = resolve(rootDir, 'contracts', 'src', 'managed', 'bboard', 'contract');
  if (!existsSync(managed)) throw new Error("missing — run 'npm run contracts:build'");
  return managed;
});

check('CLI built', () => {
  const dist = resolve(rootDir, 'cli', 'dist', 'launcher');
  if (!existsSync(dist)) throw new Error("missing — run 'npm run build:cli'");
  return dist;
});

check('Contract TS package built (contracts/dist)', () => {
  const dist = resolve(rootDir, 'contracts', 'dist');
  if (!existsSync(dist)) throw new Error("missing — run 'npm run build:contract'");
  return dist;
});

check('API package built (api/dist)', () => {
  const dist = resolve(rootDir, 'api', 'dist');
  if (!existsSync(dist)) throw new Error("missing — run 'npm run build:api' (required by web/)");
  return dist;
});

check('web/.env.local present', () => {
  const envLocal = resolve(rootDir, 'web', '.env.local');
  if (!existsSync(envLocal)) throw new Error("missing — run 'cp web/.env.example web/.env.local'");
  return envLocal;
});

check('node_modules installed', () => {
  const nm = resolve(rootDir, 'node_modules');
  if (!existsSync(nm)) throw new Error("missing — run 'npm install'");
  return 'present';
});

check('Required ports free (3000, 6300, 8088, 9944)', () => {
  const ports = [3000, 6300, 8088, 9944];
  const busy = [];
  for (const port of ports) {
    try {
      const out = sh(`lsof -i :${port} -sTCP:LISTEN -t`);
      if (out) busy.push(port);
    } catch {
      // lsof exits non-zero when nothing is listening — that's the good case.
    }
  }
  if (busy.length) return `note: ${busy.join(', ')} currently in use (fine if that's this project's own services)`;
  return 'all free';
});

check('File permissions (setup.sh executable)', () => {
  const script = resolve(rootDir, 'setup.sh');
  accessSync(script, constants.X_OK);
  return 'executable';
});

check('Git hooks installed', () => {
  const hook = resolve(rootDir, '.git', 'hooks', 'pre-commit');
  if (!existsSync(hook)) throw new Error("missing — run './setup.sh' to install");
  return 'installed';
});

console.log('\nMidnight bboard — environment health check\n');
for (const { name, ok, detail } of checks) {
  const icon = ok ? '✔' : '✘';
  console.log(`${icon} ${name}${detail ? ` — ${detail}` : ''}`);
}

console.log('');
if (hasFailure) {
  console.log('❌ Not ready — fix the items marked ✘ above, then re-run: npm run doctor');
  process.exit(1);
} else {
  console.log('✅ Ready for development');
}
