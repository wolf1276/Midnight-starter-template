// Automatic recovery helpers: attempt the safe, well-known fix before giving up and handing
// the user a CLIError. Every function here returns { recovered, detail } and never throws —
// callers decide whether to proceed or surface the original failure.

import { execSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { platform } from 'node:os';
import * as ui from './ui.mjs';

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
    sh(`docker compose -f ${composeFile} restart ${service}`);
    const out = sh(`docker compose -f ${composeFile} ps --format '{{.Service}} {{.State}}' ${service}`);
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
