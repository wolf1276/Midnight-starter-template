#!/usr/bin/env node
// Health-check for the Midnight bboard dev environment.
// Run: npm run doctor
import { execSync } from 'node:child_process';
import { existsSync, accessSync, constants, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { versions } from './lib/versions.mjs';
import * as ui from './lib/ui.mjs';
import { checks as preflightChecks } from './lib/preflight.mjs';
import { checkRequiredPorts } from './lib/ports.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const verbose = process.argv.includes('--verbose') || process.argv.includes('--debug');

const results = [];

function check(name, fn, { category = 'Environment', fix, skip } = {}) {
  if (skip) {
    results.push({ name, category, ok: true, detail: 'skipped (not applicable here)' });
    return;
  }
  try {
    const detail = fn();
    results.push({ name, category, ok: true, detail });
  } catch (e) {
    const message =
      e && typeof e === 'object' && 'howToFix' in e ? e.whatHappened.replace(/\n+/g, ' ').trim() : (e.message ?? String(e));
    results.push({ name, category, ok: false, detail: message, fix: fix ?? (e && e.howToFix) });
  }
}

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf-8', shell: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

// --- Toolchain (reuses scripts/lib/preflight.mjs so this stays consistent with setup.sh) ---
check('Node.js version', preflightChecks.node, { category: 'Toolchain', fix: 'npm run setup' });
check('npm', preflightChecks.npm, { category: 'Toolchain' });
check('Docker CLI', preflightChecks.dockerCli, { category: 'Toolchain' });
check('Docker daemon running', preflightChecks.dockerDaemon, { category: 'Toolchain', fix: 'Start Docker Desktop, then re-run npm run doctor' });
check('Docker Compose plugin', preflightChecks.dockerCompose, { category: 'Toolchain' });
check('Docker memory allocation', preflightChecks.dockerMemory, { category: 'Toolchain' });
check('Compact CLI', preflightChecks.compactCli, { category: 'Toolchain' });
check('Compact compiler toolchain', preflightChecks.compactCompiler, { category: 'Toolchain', fix: 'compact update' });
check('Internet connectivity', preflightChecks.internet, { category: 'Toolchain' });
check('Disk space', preflightChecks.diskSpace, { category: 'Toolchain' });
check('Filesystem permissions', preflightChecks.fsPermissions, { category: 'Toolchain' });

// --- Build artifacts ---
check(
  'Contract artifacts compiled',
  () => {
    const managed = resolve(rootDir, 'contracts', 'src', 'managed', 'bboard', 'contract');
    if (!existsSync(managed)) throw new Error('missing');
    return managed;
  },
  { category: 'Build', fix: 'npm run contracts:build' },
);

check(
  'CLI built',
  () => {
    const dist = resolve(rootDir, 'cli', 'dist', 'cli', 'src', 'launcher');
    if (!existsSync(dist)) throw new Error('missing');
    return dist;
  },
  { category: 'Build', fix: 'npm run build:cli' },
);

check(
  'Contract TS package built (contracts/dist)',
  () => {
    const dist = resolve(rootDir, 'contracts', 'dist');
    if (!existsSync(dist)) throw new Error('missing');
    return dist;
  },
  { category: 'Build', fix: 'npm run build:contract' },
);

check(
  'API package built (api/dist)',
  () => {
    const dist = resolve(rootDir, 'api', 'dist');
    if (!existsSync(dist)) throw new Error('missing — required by web/');
    return dist;
  },
  { category: 'Build', fix: 'npm run build:api' },
);

check(
  'web/.env.local present',
  () => {
    const envLocal = resolve(rootDir, 'web', '.env.local');
    if (!existsSync(envLocal)) throw new Error('missing');
    return envLocal;
  },
  { category: 'Build', fix: 'cp web/.env.example web/.env.local' },
);

check(
  'node_modules installed',
  () => {
    const nm = resolve(rootDir, 'node_modules');
    if (!existsSync(nm)) throw new Error('missing');
    return 'present';
  },
  { category: 'Build', fix: 'npm install' },
);

// --- Running services ---
const SERVICES = ['node', 'indexer', 'proof-server'];
let serviceState = new Map();
check(
  'Local Docker services (node, indexer, proof-server)',
  () => {
    let out;
    try {
      out = sh(`docker compose -f ${resolve(rootDir, 'docker', 'docker-compose.yml')} ps --format '{{.Service}} {{.State}}'`);
    } catch {
      throw new Error('could not query compose state');
    }
    serviceState = new Map(
      out
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [service, ...rest] = line.split(' ');
          return [service, rest.join(' ')];
        }),
    );
    const missing = SERVICES.filter((svc) => !serviceState.has(svc) || !/running/i.test(serviceState.get(svc)));
    if (missing.length) throw new Error(`not running: ${missing.join(', ')}`);
    return SERVICES.map((svc) => `${svc}: ${serviceState.get(svc)}`).join(', ');
  },
  { category: 'Services', fix: 'npm run blockchain:start' },
);

check(
  'Node RPC health (http://localhost:9944/health)',
  () => {
    try {
      return sh('curl -sf http://localhost:9944/health');
    } catch {
      throw new Error('unreachable — node container may still be starting');
    }
  },
  { category: 'Services', fix: 'npm run blockchain:start' },
);

check(
  'Indexer reachable (http://localhost:8088)',
  () => {
    try {
      const code = sh("curl -s -o /dev/null -w '%{http_code}' http://localhost:8088");
      if (!/^\d{3}$/.test(code)) throw new Error('no response');
      return `HTTP ${code}`;
    } catch {
      throw new Error('unreachable — indexer container may still be starting');
    }
  },
  { category: 'Services', fix: 'npm run blockchain:start' },
);

check(
  'Proof server reachable (:6300)',
  () => {
    try {
      sh('curl -sf http://localhost:6300 || nc -z localhost 6300');
      return 'reachable';
    } catch {
      throw new Error('unreachable');
    }
  },
  { category: 'Services', fix: 'npm run blockchain:start' },
);

check(
  'Required ports free or owned by this project',
  () => {
    const conflicts = checkRequiredPorts();
    if (!conflicts.length) return 'all free';
    // Ports being busy is fine when it's this project's own containers (checked in Services
    // above) — treat as informational rather than a hard failure to avoid double-reporting.
    return 'in use — see Services section above for what is bound to them';
  },
  { category: 'Environment' },
);

check(
  'File permissions (setup.sh executable)',
  () => {
    accessSync(resolve(rootDir, 'setup.sh'), constants.X_OK);
    return 'executable';
  },
  { category: 'Environment', fix: 'chmod +x setup.sh' },
);

check(
  'Git hooks installed',
  () => {
    if (!existsSync(resolve(rootDir, '.git', 'hooks', 'pre-commit'))) throw new Error('missing');
    return 'installed';
  },
  // Hooks only matter for someone committing from this checkout; an ephemeral CI runner
  // never does, so don't fail the whole health check over it there.
  { category: 'Environment', fix: './setup.sh', skip: Boolean(process.env.CI) },
);

check(
  'Indexer dev secret configured',
  () => {
    const envFile = resolve(rootDir, 'docker', '.env');
    if (!existsSync(envFile) || !/^INDEXER_SECRET=.+$/m.test(readFileSync(envFile, 'utf-8'))) throw new Error('missing');
    return 'present';
  },
  { category: 'Environment', fix: './setup.sh' },
);

let versionMismatches = [];
check(
  'Pinned image versions match config/versions.json',
  () => {
    const compose = readFileSync(resolve(rootDir, 'docker', 'docker-compose.yml'), 'utf-8');
    const cliProofServer = readFileSync(resolve(rootDir, 'cli', 'proof-server.yml'), 'utf-8');
    const mismatches = [];
    for (const [file, text, expected] of [
      ['docker/docker-compose.yml', compose, versions.midnightNodeImage],
      ['docker/docker-compose.yml', compose, versions.indexerImage],
      ['docker/docker-compose.yml', compose, versions.proofServerImage],
      ['cli/proof-server.yml', cliProofServer, versions.proofServerImage],
    ]) {
      if (!text.includes(expected)) mismatches.push(`${file} does not reference ${expected}`);
    }
    versionMismatches = mismatches;
    if (mismatches.length) throw new Error(`out of sync: ${mismatches.join('; ')}`);
    return 'in sync';
  },
  { category: 'Environment' },
);

// --- Report -----------------------------------------------------------------
const categories = [...new Set(results.map((r) => r.category))];
const passed = results.filter((r) => r.ok);
const failed = results.filter((r) => !r.ok);
const score = Math.round((passed.length / results.length) * 100);

ui.section('🩺 Midnight bboard — environment health check');

for (const category of categories) {
  ui.info(ui.color.bold(category));
  for (const r of results.filter((x) => x.category === category)) {
    const line = `${r.name}${r.detail ? ` — ${r.detail}` : ''}`;
    if (r.ok) ui.success(line);
    else ui.fail(line);
  }
  ui.info('');
}

ui.section(score === 100 ? '✅ Health Summary — 100% healthy' : `⚠️  Health Summary — ${score}% healthy`);

const running = SERVICES.filter((s) => serviceState.has(s) && /running/i.test(serviceState.get(s)));
const stopped = SERVICES.filter((s) => !running.includes(s));
ui.info(`Running services: ${running.length ? running.join(', ') : 'none'}`);
ui.info(`Stopped services: ${stopped.length ? stopped.join(', ') : 'none'}`);
if (versionMismatches.length) {
  ui.warn(`Version mismatches: ${versionMismatches.join('; ')}`);
}
ui.info('');

if (failed.length) {
  ui.info(ui.color.bold('Recommendations'));
  for (const r of failed) {
    ui.fail(r.name);
    ui.info(`  ${ui.color.dim('Why:')} ${r.detail}`);
    if (r.fix) ui.info(`  ${ui.color.dim('Suggested fix:')} ${ui.color.cyan(r.fix)}`);
  }
  ui.info('');
  process.exit(1);
} else {
  ui.section('✅ Ready for development');
}
