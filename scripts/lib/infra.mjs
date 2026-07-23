// Local Midnight infrastructure lifecycle management (Docker + local dev stack).
//
// Used by scripts/deploy/deploy.mjs so `npm run deploy` can fully prepare the local
// environment instead of just checking it and exiting. Mirrors the "docker:start" /
// "blockchain:start" package.json scripts, but drives them automatically and waits for
// the resulting containers to actually become healthy.
import { execSync, spawn } from 'node:child_process';
import { platform } from 'node:os';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

const sh = (cmd, opts = {}) => execSync(cmd, { encoding: 'utf-8', shell: true, stdio: ['ignore', 'pipe', 'pipe'], ...opts });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** True when running in CI or any other non-interactive context — we must fail fast there. */
export function isNonInteractive() {
  return Boolean(process.env.CI) || !process.stdout.isTTY;
}

function dockerIsUp() {
  try {
    sh('docker info');
    return true;
  } catch {
    return false;
  }
}

function attemptDockerStart(fmt) {
  const plat = platform();

  if (plat === 'linux') {
    try {
      sh('systemctl --user start docker');
      return;
    } catch {}

    const desktopCandidates = [
      '/usr/bin/docker-desktop',
      '/opt/docker-desktop/bin/docker-desktop',
      `${process.env.HOME}/.local/bin/docker-desktop`,
    ];
    const desktop = desktopCandidates.find((p) => existsSync(p));
    if (desktop) {
      try {
        spawn(desktop, [], { detached: true, stdio: 'ignore' }).unref();
        return;
      } catch {}
    }

    fmt.info('Could not start the Docker daemon automatically.');
    fmt.info('You may need elevated privileges. Try:');
    fmt.cmd('sudo systemctl start docker');
  } else if (plat === 'darwin') {
    try {
      sh('open -a Docker');
    } catch {
      fmt.info('Could not launch Docker Desktop automatically.');
      fmt.info('Open it manually from Applications, or install it:');
      fmt.cmd('https://docs.docker.com/desktop/install/mac-install/');
    }
  } else if (plat === 'win32') {
    try {
      const dockerDesktopExe = 'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe';
      spawn('cmd', ['/c', 'start', '""', `"${dockerDesktopExe}"`], { detached: true, stdio: 'ignore', shell: true }).unref();
    } catch {
      fmt.info('Could not launch Docker Desktop automatically.');
      fmt.info('Start it manually from the Start menu.');
    }
  }
}

/**
 * Ensures Docker is running, starting it automatically when possible and waiting for it
 * to come up. Exits the process only in CI / non-interactive contexts, where waiting
 * indefinitely would just hang a pipeline.
 */
export async function ensureDockerRunning(fmt) {
  fmt.section('\u{1F433} Docker');

  if (dockerIsUp()) {
    fmt.ok('Docker is running.');
    return;
  }

  if (isNonInteractive()) {
    fmt.fail('Docker is not running.');
    fmt.info('Running in a non-interactive environment — refusing to wait indefinitely.');
    fmt.info('Start Docker before running this command, e.g.:');
    fmt.cmd('sudo systemctl start docker');
    process.exit(1);
  }

  fmt.warn('Docker is not running.');
  fmt.info('Attempting to start Docker...');
  attemptDockerStart(fmt);

  const pollIntervalMs = 2000;
  const initialTimeoutMs = 60000;
  let waited = 0;
  while (waited < initialTimeoutMs) {
    await sleep(pollIntervalMs);
    waited += pollIntervalMs;
    if (dockerIsUp()) {
      fmt.ok('Docker is running.');
      return;
    }
  }

  fmt.section('\u2717 Docker could not be started automatically.');
  fmt.info('Please start Docker.');
  fmt.info('The deployment will continue automatically once Docker becomes available.');
  fmt.info('Checking every 2 seconds... (Ctrl+C to cancel)');
  while (!dockerIsUp()) {
    await sleep(pollIntervalMs);
  }
  fmt.ok('Docker is running.');
}

function ensureIndexerSecret(rootDir, fmt) {
  const envFile = resolve(rootDir, 'docker', '.env');
  if (existsSync(envFile) && /^INDEXER_SECRET=.+$/m.test(readFileSync(envFile, 'utf-8'))) return;
  mkdirSync(dirname(envFile), { recursive: true });
  const secret = randomBytes(32).toString('hex');
  writeFileSync(envFile, `INDEXER_SECRET=${secret}\n`);
  fmt.info('Generated docker/.env with a new INDEXER_SECRET.');
}

function composeState(composeFile) {
  const state = new Map();
  try {
    const out = sh(`docker compose -f ${composeFile} ps --format '{{.Service}} {{.State}}'`);
    for (const line of out.split('\n').filter(Boolean)) {
      const [service, ...rest] = line.split(' ');
      state.set(service, rest.join(' '));
    }
  } catch {}
  return state;
}

function checkRpc() {
  try {
    sh('curl -sf http://localhost:9944/health');
    return true;
  } catch {
    return false;
  }
}

function checkIndexer() {
  try {
    const code = sh("curl -s -o /dev/null -w '%{http_code}' http://localhost:8088").trim();
    return /^\d{3}$/.test(code);
  } catch {
    return false;
  }
}

function checkProofServer() {
  try {
    sh('curl -sf http://localhost:6300 > /dev/null 2>&1 || nc -z localhost 6300');
    return true;
  } catch {
    return false;
  }
}

function printProofServerFailure(fmt, composeFile) {
  fmt.section('\u2717 Proof Server failed to start.');
  fmt.info('Possible causes:');
  fmt.info('  \u2022 Docker has insufficient memory.');
  fmt.info('  \u2022 A required port is already in use (6300, 8088, 9944).');
  fmt.info('  \u2022 The container failed to initialize.');
  fmt.info('');
  fmt.info('Container: bboard-proof-server');
  fmt.info('Inspect logs:');
  fmt.cmd(`docker compose -f ${composeFile} logs proof-server`);
  fmt.info('Check container status:');
  fmt.cmd('docker ps');
  fmt.info('Suggested fixes:');
  fmt.info('  \u2022 Increase Docker Desktop memory allocation (Settings \u2192 Resources).');
  fmt.info('  \u2022 Free the required ports, or stop conflicting containers.');
  fmt.info('  \u2022 Reset and retry:');
  fmt.cmd('npm run blockchain:reset && npm run deploy');
}

/**
 * Ensures the local Docker Compose stack (node, indexer, proof-server) exists, is running,
 * and is healthy — creating/starting containers as needed via `docker compose up -d`, which
 * transparently handles both the "missing" and "stopped" cases.
 */
export async function ensureLocalMidnightServices(rootDir, fmt, verbose) {
  fmt.section('\u{1F510} Proof Server');
  fmt.info('Checking Proof Server...');

  const composeFile = resolve(rootDir, 'docker', 'docker-compose.yml');
  ensureIndexerSecret(rootDir, fmt);

  const required = ['node', 'indexer', 'proof-server'];
  const before = composeState(composeFile);
  const running = required.filter((s) => before.has(s) && /running/i.test(before.get(s)));

  if (running.length < required.length) {
    const missing = required.filter((s) => !before.has(s));
    const stopped = required.filter((s) => before.has(s) && !/running/i.test(before.get(s)));
    if (missing.length) fmt.info(`Creating container(s): ${missing.join(', ')}...`);
    if (stopped.length) fmt.info(`Starting container(s): ${stopped.join(', ')}...`);
    fmt.info('Running Docker Compose...');
    try {
      sh(`docker compose -f ${composeFile} up -d ${required.join(' ')}`, {
        stdio: verbose ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      if (verbose) console.error(e.stderr?.toString?.() ?? e.message);
      printProofServerFailure(fmt, composeFile);
      process.exit(1);
    }
  } else {
    fmt.ok('Proof Server already running.');
  }

  fmt.info('Waiting for health check...');
  const timeoutMs = 90000;
  const pollIntervalMs = 2000;
  let waited = 0;
  let healthy = checkRpc() && checkIndexer() && checkProofServer();
  while (!healthy && waited < timeoutMs) {
    await sleep(pollIntervalMs);
    waited += pollIntervalMs;
    healthy = checkRpc() && checkIndexer() && checkProofServer();
  }

  if (!healthy) {
    printProofServerFailure(fmt, composeFile);
    process.exit(1);
  }
  fmt.ok('Proof Server is healthy.');

  fmt.section('\u{1F310} Midnight Services');
  fmt.ok('Proof Server');
  fmt.ok('Indexer reachable');
  fmt.ok('RPC reachable');
}
