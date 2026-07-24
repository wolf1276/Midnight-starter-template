// Real port-conflict detection, shared by preflight checks and infra.mjs, so Docker's own
// "port already allocated" error is never what the user sees. Same lsof/docker ps approach as
// describePortOwner() in errors.mjs / cli/src/errors.ts, generalized into a structured result.

import { execSync } from 'node:child_process';
import { versions } from './versions.mjs';
import { color } from './ui.mjs';

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

// This project's containers are all named with this prefix (see docker/docker-compose.yml's
// `container_name:` entries) — used to tell "our stack being restarted" apart from some other
// project's container that happens to be squatting on the same port.
export const PROJECT_CONTAINER_PREFIX = 'bboard-';

function findDockerOwner(port) {
  try {
    const out = sh(`docker ps --format "{{.ID}}\t{{.Names}}\t{{.Ports}}"`);
    for (const line of out.split('\n')) {
      if (!line) continue;
      const [id, name, ports] = line.split('\t');
      if (ports && ports.includes(`:${port}->`)) {
        return { kind: 'docker', id, name, ours: name.startsWith(PROJECT_CONTAINER_PREFIX) };
      }
    }
  } catch {
    // Docker not available — fall through
  }
  return undefined;
}

function findProcessOwner(port) {
  try {
    const out = sh(`lsof -i :${port} -sTCP:LISTEN -P -n`);
    const lines = out.split('\n').filter(Boolean);
    // header line is "COMMAND PID USER ..."; first data line has what we need
    const dataLine = lines[1];
    if (dataLine) {
      const parts = dataLine.trim().split(/\s+/);
      const [name, pid] = parts;
      return { kind: 'process', name, pid };
    }
  } catch {
    // lsof not installed or nothing listening — fall through
  }
  return undefined;
}

/** Checks whether `port` is free. Returns { free, owner? } — owner identifies a Docker container or a raw process. Never throws. */
export function checkPort(port) {
  const dockerOwner = findDockerOwner(port);
  if (dockerOwner) return { free: false, owner: dockerOwner };
  const processOwner = findProcessOwner(port);
  if (processOwner) return { free: false, owner: processOwner };
  return { free: true };
}

/** Checks all ports this stack needs (config/versions.json's `ports` map). Returns an array of conflicts (empty if all free). */
export function checkRequiredPorts() {
  const conflicts = [];
  for (const portStr of Object.keys(versions.ports)) {
    const port = Number(portStr);
    const result = checkPort(port);
    if (!result.free) conflicts.push({ port, service: versions.ports[portStr], owner: result.owner });
  }
  return conflicts;
}

/** Formats the "❌ Port Already In Use" panel for a single conflict. */
export function formatPortConflict({ port, service, owner }) {
  const lines = [];
  lines.push('');
  lines.push(color.red(color.bold('❌ Port Already In Use')));
  lines.push('');
  lines.push(`Port ${port} is already occupied.`);
  lines.push('');
  lines.push(`${service ? `${service[0].toUpperCase()}${service.slice(1)} requires this port.\n\n` : ''}Used by:`);
  lines.push('');
  if (owner?.kind === 'docker') {
    lines.push('Docker Container:');
    lines.push(owner.name);
  } else if (owner?.kind === 'process') {
    lines.push(`PID ${owner.pid}`);
    lines.push(owner.name);
  } else {
    lines.push('(could not identify the process — try `lsof -i` or `docker ps` yourself)');
  }
  lines.push('');
  lines.push('To fix:');
  lines.push('');
  if (owner?.kind === 'docker') {
    lines.push(`  docker stop ${owner.name}`);
  } else if (owner?.kind === 'process' && owner.pid) {
    lines.push(`  kill ${owner.pid}`);
  } else {
    lines.push(`  lsof -i :${port}`);
  }
  lines.push('');
  return lines;
}

export function printPortConflicts(conflicts) {
  for (const conflict of conflicts) {
    for (const line of formatPortConflict(conflict)) {
      process.stderr.write(`${line}\n`);
    }
  }
}
