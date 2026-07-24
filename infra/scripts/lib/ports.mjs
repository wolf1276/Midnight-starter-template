// Real port-conflict detection, shared by preflight checks and infra.mjs, so Docker's own
// "port already allocated" error is never what the user sees. Same lsof/docker ps approach as
// describePortOwner() in errors.mjs / cli/src/errors.ts, generalized into a structured result.

import { execSync } from 'node:child_process';
import { versions } from './versions.mjs';
import { color } from './ui.mjs';

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

// This project's containers are all named with this prefix (see infra/docker/docker-compose.yml's
// `container_name:` entries) — used to tell "our stack being restarted" apart from some other
// project's container that happens to be squatting on the same port.
//
// Name matching over Compose project labels (`com.docker.compose.project`) is deliberate here:
// the compose file has no top-level `name:`, so Compose derives that label from the directory
// basename ("docker" — infra/docker/), which is generic and would collide with any other repo's
// compose file living in a directory of the same name. The explicit `container_name: bboard-*`
// values are unique to this repo and cannot collide, making them the more reliable identity
// signal — not merely equivalent to the label. If the compose file later adds a top-level
// `name:` (making the project label repo-specific), prefer matching on
// `com.docker.compose.project` at that point.
export const PROJECT_CONTAINER_PREFIX = 'bboard-';

// Any image published under this org is a Midnight stack component — used to tell "another
// Midnight project's container happens to be on this port" apart from a truly unrelated one.
const MIDNIGHT_IMAGE_PREFIX = 'midnightntwrk/';

function findDockerOwner(port) {
  try {
    const out = sh(`docker ps --format "{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Ports}}"`);
    for (const line of out.split('\n')) {
      if (!line) continue;
      const [id, name, image, ports] = line.split('\t');
      if (ports && ports.includes(`:${port}->`)) {
        return {
          kind: 'docker',
          id,
          name,
          image,
          ours: name.startsWith(PROJECT_CONTAINER_PREFIX),
          midnight: image.startsWith(MIDNIGHT_IMAGE_PREFIX),
        };
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
      // Best-effort full executable path/command line — purely informational, never blocks.
      const exe = sh(`ps -o comm= -p ${pid}`) || undefined;
      return { kind: 'process', name, pid, exe };
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

/** Checks all ports this stack needs (infra/config/versions.json's `ports` map). Returns an array of conflicts (empty if all free). */
export function checkRequiredPorts() {
  const conflicts = [];
  for (const portStr of Object.keys(versions.ports)) {
    const port = Number(portStr);
    const result = checkPort(port);
    if (!result.free) conflicts.push({ port, service: versions.ports[portStr], owner: result.owner });
  }
  return conflicts;
}

/** Formats the "❌ Port Already In Use" panel for a single conflict, distinguishing exactly
 *  what's holding the port: this project's own container, another Midnight project's container,
 *  an unrelated Docker container, or a plain OS process. */
export function formatPortConflict({ port, service, owner }) {
  const lines = [];
  lines.push('');
  lines.push(color.red(color.bold('❌ Port Already In Use')));
  lines.push('');
  lines.push(`Port ${port}${service ? ` (${service})` : ''} is already occupied.`);
  lines.push('');
  if (owner?.kind === 'docker' && owner.ours) {
    lines.push(`Owned by this project's own container: ${owner.name} (image ${owner.image}).`);
    lines.push('');
    lines.push('This is expected if the stack is already running — `npm run setup` reuses it automatically.');
    lines.push('If it looks stuck instead:');
    lines.push('');
    lines.push(`  docker restart ${owner.name}`);
  } else if (owner?.kind === 'docker' && owner.midnight) {
    lines.push(`Owned by a container from a different Midnight project: ${owner.name} (image ${owner.image}).`);
    lines.push('');
    lines.push('Stop that project\'s stack, or free the port:');
    lines.push('');
    lines.push(`  docker stop ${owner.name}`);
  } else if (owner?.kind === 'docker') {
    lines.push(`Owned by an unrelated Docker container: ${owner.name} (image ${owner.image}).`);
    lines.push('');
    lines.push('To free it:');
    lines.push('');
    lines.push(`  docker stop ${owner.name}`);
  } else if (owner?.kind === 'process') {
    lines.push(`Owned by process: ${owner.name}${owner.exe ? ` (${owner.exe})` : ''}, PID ${owner.pid}.`);
    lines.push('');
    lines.push('To free it:');
    lines.push('');
    lines.push(`  kill ${owner.pid}`);
  } else {
    lines.push('Could not identify the owner automatically.');
    lines.push('');
    lines.push('Investigate with:');
    lines.push('');
    lines.push(`  lsof -i :${port}`);
    lines.push(`  docker ps`);
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
