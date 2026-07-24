// Shared runner behind scripts/docker/*.mjs and scripts/blockchain/*.mjs: pre-flight checks,
// automatic recovery, a classified error on failure, and consistent formatted output — so the
// raw `docker compose ...` commands in package.json never surface an unwrapped Docker error.
import { execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ui from './ui.mjs';
import { classifyError, printCliError } from './errors.mjs';
import { ensureIndexerSecret } from './infra.mjs';
import { checkRequiredPorts, printPortConflicts } from './ports.mjs';
import { tryStartDocker } from './recovery.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const rootDir = resolve(__dirname, '..', '..');
export const composeFile = resolve(rootDir, 'docker', 'docker-compose.yml');

export const verbose = process.argv.includes('--verbose') || process.argv.includes('--debug');

function dockerIsUp() {
  try {
    execSync('docker info', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Runs a `docker compose ...` command with pre-flight validation and classified error
 * handling. `opts.checkPorts: true` blocks (with the exact port-conflict panel) before a
 * `starting` command if a required port is held by a foreign process.
 */
export async function runCompose(label, args, { checkPorts = false, requireDaemon = true } = {}) {
  ui.section(label);

  if (requireDaemon && !dockerIsUp()) {
    ui.warn('Docker is not running — attempting to start it automatically...');
    const { recovered, detail } = await tryStartDocker();
    if (!recovered) {
      const err = classifyError(new Error('Cannot connect to the Docker daemon.'));
      printCliError(err, verbose);
      process.exit(err.exitCode);
    }
    ui.success(`Docker is running (${detail}).`);
  }

  if (checkPorts) {
    const conflicts = checkRequiredPorts().filter((c) => c.owner?.kind === 'process');
    if (conflicts.length) {
      printPortConflicts(conflicts);
      process.exit(1);
    }
  }

  // docker-compose.yml interpolates INDEXER_SECRET from docker/.env for every command
  // (up, stop, down, ps, ...), not just `up` — so this must run unconditionally here,
  // not only on the `checkPorts` (start) path. setup.sh generates this file too; this
  // covers anyone who runs blockchain:*/docker:* directly without running setup.sh.
  ensureIndexerSecret(rootDir, { info: ui.info });

  try {
    execSync(`docker compose -f ${composeFile} ${args}`, {
      stdio: verbose ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      encoding: 'utf-8',
    });
    ui.success('Done.');
  } catch (e) {
    const err = classifyError(new Error(e.stderr?.toString?.() || e.message));
    printCliError(err, verbose);
    process.exit(err.exitCode);
  }
}
