// Automatic recovery helpers: attempt the safe, well-known fix before giving up and handing
// the user a CLIError. Every function here returns { recovered, detail } and never throws —
// callers decide whether to proceed or surface the original failure.

import { execSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { platform } from 'node:os';
import * as ui from './ui.mjs';
import { checkPort, COMPOSE_PROJECT_NAME } from './ports.mjs';

const sh = (cmd, opts = {}) => execSync(cmd, { encoding: 'utf-8', shell: true, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function dockerIsUp() {
  try {
    sh('docker info');
    return true;
  } catch {
    return false;
  }
}

function launchDockerDesktop() {
  const plat = platform();
  if (plat === 'linux') {
    try {
      sh('systemctl --user start docker');
      return true;
    } catch {}
    const desktopCandidates = ['/usr/bin/docker-desktop', '/opt/docker-desktop/bin/docker-desktop', `${process.env.HOME}/.local/bin/docker-desktop`];
    const desktop = desktopCandidates.find((p) => existsSync(p));
    if (desktop) {
      try {
        spawn(desktop, [], { detached: true, stdio: 'ignore' }).unref();
        return true;
      } catch {}
    }
    return false;
  }
  if (plat === 'darwin') {
    try {
      sh('open -a Docker');
      return true;
    } catch {
      return false;
    }
  }
  if (plat === 'win32') {
    try {
      spawn('cmd', ['/c', 'start', '""', '"C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe"'], { detached: true, stdio: 'ignore', shell: true }).unref();
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Attempts to start the Docker daemon and waits up to `timeoutMs` for it to come up.
 * Never hangs indefinitely — callers in non-interactive contexts should skip this and fail fast.
 */
export async function tryStartDocker({ timeoutMs = 60000, pollIntervalMs = 2000 } = {}) {
  if (dockerIsUp()) return { recovered: true, detail: 'already running' };

  ui.info('Docker is not running — attempting to start it automatically...');
  const launched = launchDockerDesktop();
  if (!launched) return { recovered: false, detail: 'could not launch Docker automatically' };

  let waited = 0;
  while (waited < timeoutMs) {
    await sleep(pollIntervalMs);
    waited += pollIntervalMs;
    if (dockerIsUp()) return { recovered: true, detail: `started after ${(waited / 1000).toFixed(0)}s` };
  }
  return { recovered: false, detail: `Docker did not come up within ${(timeoutMs / 1000).toFixed(0)}s` };
}

/** Restarts a named Docker Compose service once. Returns recovered: true only if it becomes "running" afterward. */
export function tryRestartContainer(composeFile, service) {
  try {
    sh(`docker compose -p ${COMPOSE_PROJECT_NAME} -f ${composeFile} restart ${service}`);
    const out = sh(`docker compose -p ${COMPOSE_PROJECT_NAME} -f ${composeFile} ps --format '{{.Service}} {{.State}}' ${service}`);
    const running = out.split('\n').some((line) => line.startsWith(`${service} `) && /running/i.test(line));
    return { recovered: running, detail: running ? 'restarted' : 'restart did not bring it to a running state' };
  } catch (e) {
    return { recovered: false, detail: e.message ?? String(e) };
  }
}

/** Convenience wrapper for the Proof Server specifically, since it's the most failure-prone service. */
export function tryRestartProofServer(composeFile) {
  return tryRestartContainer(composeFile, 'proof-server');
}

export function tryStopContainer(nameOrId) {
  try {
    sh(`docker stop ${nameOrId}`);
    return true;
  } catch {
    return false;
  }
}

export function tryRemoveContainer(nameOrId) {
  try {
    sh(`docker rm -f ${nameOrId}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Waits for a port to actually become free after stopping/removing whatever held it. Docker
 * doesn't always release a port allocation the instant a container stops, so a single
 * immediate re-check can see a stale conflict — poll a few times before giving up.
 */
export async function waitForPortFree(port, { retries = 5, delayMs = 500 } = {}) {
  for (let i = 0; i < retries; i++) {
    if (checkPort(port).free) return true;
    await sleep(delayMs);
  }
  return checkPort(port).free;
}

/**
 * Only one local Midnight dev stack is meant to run on a machine at a time (fixed host ports
 * are intentional — see infra/docker/docker-compose.yml — so scaffolded projects can point
 * wallets/tools at fixed addresses). Stops another create-midnight project's whole Compose
 * project (all its containers + its network), identified by its containers' image prefix
 * rather than by guessing a name, so a fresh `docker compose up -d` here never hits a port
 * conflict just because a previous project's stack was left running. Named volumes are left
 * alone — `down` with no `-v` never touches them.
 */
export async function stopForeignMidnightProject(projectName, fmt) {
  fmt.info('Found an existing create-midnight development environment.');
  fmt.info('Stopping it so this project can use the local Midnight ports...');
  try {
    sh(`docker compose -p ${projectName} down --remove-orphans`);
    return true;
  } catch (e) {
    fmt.warn(`Could not fully stop project "${projectName}" (${e.message ?? e}).`);
    return false;
  }
}

/**
 * Attempts to automatically resolve a set of port conflicts (as returned by
 * `checkRequiredPorts()`) before the caller gives up and fails:
 *
 *  - one of this project's own containers (name prefixed `bboard-`) is stopped and removed,
 *    so the caller's subsequent `docker compose up -d` recreates it cleanly and execution
 *    continues without any manual `docker stop`/`docker compose down`;
 *  - another create-midnight project's stack is stopped automatically (see
 *    stopForeignMidnightProject) — only one local Midnight stack is meant to run at a time;
 *  - a foreign, non-Midnight Docker container is only ever stopped after the user explicitly
 *    confirms — we tell them which container owns the port first;
 *  - a non-Docker process is never touched automatically; it's always left in `remaining`
 *    for the caller to report via `printPortConflicts`.
 *
 * Returns { resolved, remaining } — `remaining` is the subset of `conflicts` that still
 * needs manual intervention after recovery was attempted.
 */
export async function recoverPortConflicts(conflicts, { fmt = ui } = {}) {
  const remaining = [];

  // Stop each distinct foreign create-midnight project once, up front, rather than once per
  // conflicting port (node/indexer/proof-server conflicts all point at the same project).
  const foreignMidnightProjects = [
    ...new Set(
      conflicts
        .filter((c) => c.owner?.kind === 'docker' && c.owner.midnight && !c.owner.ours && c.owner.project)
        .map((c) => c.owner.project),
    ),
  ];
  for (const projectName of foreignMidnightProjects) {
    await stopForeignMidnightProject(projectName, fmt);
  }

  for (const conflict of conflicts) {
    const { port, owner } = conflict;

    if (!owner || owner.kind === 'process') {
      // Never touch a non-Docker process automatically.
      remaining.push(conflict);
      continue;
    }

    if (owner.kind === 'docker' && owner.midnight && !owner.ours && owner.project) {
      if (await waitForPortFree(port)) {
        fmt.info(`Port ${port} is free again.`);
      } else {
        remaining.push(conflict);
      }
      continue;
    }

    if (owner.ours) {
      fmt.warn(`Port ${port} is held by ${owner.name}, one of this project's own containers — stopping and removing it so it can be recreated...`);
      tryStopContainer(owner.id ?? owner.name);
      tryRemoveContainer(owner.id ?? owner.name);
      if (await waitForPortFree(port)) {
        fmt.info(`Port ${port} is free again.`);
      } else {
        remaining.push(conflict);
      }
      continue;
    }

    // A foreign Docker container — identify it and ask before touching it.
    fmt.warn(`Port ${port} is held by "${owner.name}", a Docker container that does not belong to this project.`);
    const shouldStop = await ui.confirm(`Stop container "${owner.name}" so this project can use port ${port}?`);
    if (!shouldStop) {
      fmt.info(`Leaving "${owner.name}" running — resolve the conflict on port ${port} manually and retry.`);
      remaining.push(conflict);
      continue;
    }
    tryStopContainer(owner.id ?? owner.name);
    if (await waitForPortFree(port)) {
      fmt.info(`Port ${port} is free again.`);
    } else {
      remaining.push(conflict);
    }
  }

  return { resolved: remaining.length === 0, remaining };
}
