#!/usr/bin/env node
// Runs immediately before `docker compose up` in setup.sh, step 8.
//
// Scope is deliberately narrow — this project's own containers only:
//   - if node/indexer/proof-server are already up, say so and let setup.sh skip straight to
//     health checks (no pull, no recreate, no downtime for a dev who's mid-session).
//   - if any of OUR containers exist but are stopped (interrupted previous run), remove just
//     those so `docker compose up` starts clean instead of erroring on a stale container name.
//   - if a required port is held by anything else, identify exactly what (another Midnight
//     project's container, an unrelated container, or a plain process) and exit non-zero with
//     precise recovery instructions — never touched automatically.
//
// No global prune, no volume deletion, no touching containers outside the bboard-* names.
//
// Exit codes: 0 = proceed with pull/up. 3 = stack already running, skip pull/up. 1 = fatal,
// diagnostics already printed to stderr.
import { execSync } from 'node:child_process';
import { checkPort, PROJECT_CONTAINER_PREFIX, formatPortConflict } from '../lib/ports.mjs';
import * as ui from '../lib/ui.mjs';

const SERVICES = { node: 9944, indexer: 8088, 'proof-server': 6300 };

function sh(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function containerStatus(name) {
  // Empty string means the container doesn't exist at all.
  return sh(`docker inspect -f '{{.State.Status}}' ${name}`);
}

const status = Object.fromEntries(
  Object.keys(SERVICES).map((service) => [service, containerStatus(`${PROJECT_CONTAINER_PREFIX}${service}`)]),
);

if (Object.values(status).every((s) => s === 'running')) {
  ui.success('Midnight development stack already running.');
  process.exit(3);
}

for (const [service, state] of Object.entries(status)) {
  if (state && state !== 'running') {
    const name = `${PROJECT_CONTAINER_PREFIX}${service}`;
    ui.warn(`Removing stale container ${name} (${state}) from a previous run...`);
    sh(`docker rm -f ${name}`);
  }
}

let fatal = false;
for (const [service, port] of Object.entries(SERVICES)) {
  const result = checkPort(port);
  if (result.free) continue;
  const ourName = `${PROJECT_CONTAINER_PREFIX}${service}`;
  if (result.owner?.kind === 'docker' && result.owner.name === ourName) continue; // being recreated
  fatal = true;
  for (const line of formatPortConflict({ port, service, owner: result.owner })) {
    process.stderr.write(`${line}\n`);
  }
}

process.exit(fatal ? 1 : 0);
