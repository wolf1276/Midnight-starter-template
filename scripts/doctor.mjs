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
  const active = out.split('\n').find((l) => l.includes('→') || l.includes('*'));
  if (!active) throw new Error("no toolchain installed — run 'compact update'");
  return active.trim();
});

check('Contract artifacts compiled', () => {
  const managed = resolve(rootDir, 'contracts', 'src', 'managed', 'bboard', 'contract');
  if (!existsSync(managed)) throw new Error("missing — run 'npm run contracts:build'");
  return managed;
});

check('CLI built', () => {
  const dist = resolve(rootDir, 'cli', 'dist', 'cli', 'src', 'launcher');
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

check('Local Docker services (node, indexer, proof-server)', () => {
  let out;
  try {
    out = sh(`docker compose -f ${resolve(rootDir, 'docker', 'docker-compose.yml')} ps --format '{{.Service}} {{.State}}'`);
  } catch {
    throw new Error("could not query compose state — run 'npm run docker:start' or 'npm run blockchain:start'");
  }
  const required = ['node', 'indexer', 'proof-server'];
  const running = new Map(
    out
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [service, ...rest] = line.split(' ');
        return [service, rest.join(' ')];
      }),
  );
  const missing = required.filter((svc) => !running.has(svc) || !/running/i.test(running.get(svc)));
  if (missing.length) {
    throw new Error(`not running: ${missing.join(', ')} — run 'npm run blockchain:start' (or 'npm run docker:start')`);
  }
  return required.map((svc) => `${svc}: ${running.get(svc)}`).join(', ');
});

check('Node RPC health (http://localhost:9944/health)', () => {
  try {
    return sh('curl -sf http://localhost:9944/health');
  } catch {
    throw new Error("unreachable — node container may still be starting, or run 'npm run blockchain:start'");
  }
});

check('Indexer reachable (http://localhost:8088)', () => {
  // The indexer has no route at "/" (a healthy instance still 404s there), so check that the
  // HTTP server itself responds at all rather than requiring a 2xx status.
  try {
    const code = sh("curl -s -o /dev/null -w '%{http_code}' http://localhost:8088");
    if (!/^\d{3}$/.test(code)) throw new Error('no response');
    return `HTTP ${code}`;
  } catch {
    throw new Error("unreachable — indexer container may still be starting, or run 'npm run blockchain:start'");
  }
});

check('Proof server reachable (:6300)', () => {
  try {
    sh('curl -sf http://localhost:6300 || nc -z localhost 6300');
    return 'reachable';
  } catch {
    throw new Error("unreachable — run 'npm run blockchain:start' and check 'docker compose -f docker/docker-compose.yml logs proof-server'");
  }
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
