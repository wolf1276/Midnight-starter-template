// Local Midnight infrastructure lifecycle management (Docker + local dev stack).
//
// Used by scripts/deploy/deploy.mjs and the scripts/docker|blockchain/*.mjs wrappers so
// `npm run deploy` / `npm run blockchain:start` can fully prepare the local environment
// instead of just checking it and exiting. Waits for the resulting containers to actually
// become healthy, attempts automatic recovery before giving up, and reports every failure
// through the shared CLIError system (never a raw Docker/curl error).
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DockerError, ProofServerError, classifyError, printCliError } from './errors.mjs';
import { checkRequiredPorts, printPortConflicts } from './ports.mjs';
import { tryRestartContainer, tryStartDocker, recoverPortConflicts } from './recovery.mjs';

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
    printCliError(
      new DockerError({
        title: 'Docker Daemon Not Running',
        whatHappened: 'Docker is not running, and this is a non-interactive environment — refusing to wait indefinitely.',
        howToFix: 'Start Docker before running this command, e.g.:\n\n  sudo systemctl start docker',
      }),
      false,
    );
    process.exit(1);
  }

  fmt.warn('Docker is not running.');
  const { recovered, detail } = await tryStartDocker();
  if (recovered) {
    fmt.ok(`Docker is running (${detail}).`);
    return;
  }

  fmt.warn(`Could not start Docker automatically (${detail}).`);
  fmt.info('Please start Docker manually. Checking every 2 seconds... (Ctrl+C to cancel)');
  while (!dockerIsUp()) {
    await sleep(2000);
  }
  fmt.ok('Docker is running.');
}

export function ensureIndexerSecret(rootDir, fmt = { info: () => {} }) {
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

/**
 * Ensures the local Docker Compose stack (node, indexer, proof-server) exists, is running,
 * and is healthy — creating/starting containers as needed via `docker compose up -d`, which
 * transparently handles both the "missing" and "stopped" cases. Attempts an automatic restart
 * once before surfacing a classified failure.
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

    const conflicts = checkRequiredPorts();
    if (conflicts.length) {
      const { resolved, remaining } = await recoverPortConflicts(conflicts, { fmt });
      if (!resolved) {
        printPortConflicts(remaining);
        process.exit(1);
      }
    }

    if (missing.length) fmt.info(`Creating container(s): ${missing.join(', ')}...`);
    if (stopped.length) fmt.info(`Starting container(s): ${stopped.join(', ')}...`);
    fmt.info('Running Docker Compose...');
    try {
      sh(`docker compose -f ${composeFile} up -d ${required.join(' ')}`, {
        stdio: verbose ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      const err = classifyError(new Error(e.stderr?.toString?.() || e.message), 'npm run blockchain:start');
      printCliError(err, verbose);
      process.exit(err.exitCode);
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
    fmt.warn('Services did not become healthy in time — attempting to restart the Proof Server once...');
    const { recovered } = tryRestartContainer(composeFile, 'proof-server');
    if (recovered) {
      waited = 0;
      healthy = checkRpc() && checkIndexer() && checkProofServer();
      while (!healthy && waited < timeoutMs) {
        await sleep(pollIntervalMs);
        waited += pollIntervalMs;
        healthy = checkRpc() && checkIndexer() && checkProofServer();
      }
    }
  }

  if (!healthy) {
    printCliError(
      new ProofServerError({
        title: 'Proof Server Failed To Start',
        whatHappened:
          'One or more of node/indexer/proof-server did not become healthy in time, and an automatic restart did not fix it.\n\nPossible causes: Docker has insufficient memory, a required port is already in use, or a container failed to initialize.',
        howToFix: `Inspect logs and reset:\n\n  docker compose -f ${composeFile} logs\n  npm run blockchain:reset\n  npm run blockchain:start`,
      }),
      verbose,
    );
    process.exit(1);
  }
  fmt.ok('Proof Server is healthy.');

  fmt.section('\u{1F310} Midnight Services');
  fmt.ok('Proof Server');
  fmt.ok('Indexer reachable');
  fmt.ok('RPC reachable');
}
