#!/usr/bin/env node
// Runs immediately before `docker compose up` in setup.sh, step 8.
//
// Scope is deliberately narrow — this project's own containers only:
//   - if node/indexer/proof-server are already up, say so and let setup.sh skip straight to
//     health checks (no pull, no recreate, no downtime for a dev who's mid-session).
//   - if any of OUR containers exist but are stopped (interrupted previous run), remove just
//     those so `docker compose up` starts clean instead of erroring on a stale container.
//   - if a required port is held by another create-midnight project's stack, stop that whole
//     Compose project automatically (only one local Midnight dev stack is meant to run on a
//     machine at a time — see stopForeignMidnightProject) and proceed;
//   - if a required port is held by anything else (unrelated container, plain process),
//     identify exactly what and exit non-zero with precise recovery instructions — never
//     touched automatically.
//
// "This project's own containers" means the ones in this project's Compose project (see
// infra/scripts/lib/ports.mjs's COMPOSE_PROJECT_NAME, derived from package.json `name`) — never
// a hardcoded name, so multiple scaffolded projects never collide or step on each other here.
//
// No global prune, no volume deletion, no touching containers outside this Compose project
// (or, for a foreign create-midnight project being auto-stopped, outside *that* project).
//
// Exit codes: 0 = proceed with pull/up. 3 = stack already running, skip pull/up. 1 = fatal,
// diagnostics already printed to stderr.
import { execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPort, formatPortConflict, COMPOSE_PROJECT_NAME } from '../lib/ports.mjs';
import { stopForeignMidnightProject, waitForPortFree } from '../lib/recovery.mjs';
import * as ui from '../lib/ui.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..', '..', '..');
const composeFile = resolve(rootDir, 'infra', 'docker', 'docker-compose.yml');

const SERVICES = { node: 9944, indexer: 8088, 'proof-server': 6300 };

function sh(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function serviceState() {
  const state = new Map();
  const out = sh(`docker compose -p ${COMPOSE_PROJECT_NAME} -f ${composeFile} ps --all --format '{{.Service}} {{.State}}'`);
  for (const line of out.split('\n').filter(Boolean)) {
    const [service, ...rest] = line.split(' ');
    state.set(service, rest.join(' '));
  }
  return state;
}

const state = serviceState();

if (Object.keys(SERVICES).every((service) => /running/i.test(state.get(service) ?? ''))) {
  ui.success('Midnight development stack already running.');
  process.exit(3);
}

for (const service of Object.keys(SERVICES)) {
  const current = state.get(service);
  if (current && !/running/i.test(current)) {
    ui.warn(`Removing stale ${service} container (${current}) from a previous run...`);
    sh(`docker compose -p ${COMPOSE_PROJECT_NAME} -f ${composeFile} rm -f ${service}`);
  }
}

const conflicts = [];
for (const [service, port] of Object.entries(SERVICES)) {
  const result = checkPort(port);
  if (result.free) continue;
  if (result.owner?.kind === 'docker' && result.owner.ours) continue; // being recreated
  conflicts.push({ service, port, owner: result.owner });
}

const foreignMidnightProjects = [
  ...new Set(
    conflicts.filter((c) => c.owner?.kind === 'docker' && c.owner.midnight && !c.owner.ours && c.owner.project).map((c) => c.owner.project),
  ),
];
for (const projectName of foreignMidnightProjects) {
  await stopForeignMidnightProject(projectName, ui);
}

let fatal = false;
for (const conflict of conflicts) {
  const { service, port, owner } = conflict;
  if (owner?.kind === 'docker' && owner.midnight && !owner.ours && owner.project) {
    if (await waitForPortFree(port)) continue;
  }
  fatal = true;
  for (const line of formatPortConflict({ port, service, owner })) {
    process.stderr.write(`${line}\n`);
  }
}

process.exit(fatal ? 1 : 0);
