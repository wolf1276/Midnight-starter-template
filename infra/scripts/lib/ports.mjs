// Real port-conflict detection, shared by preflight checks and infra.mjs, so Docker's own
// "port already allocated" error is never what the user sees. Same lsof/docker ps approach as
// describePortOwner() in errors.mjs / cli/src/errors.ts, generalized into a structured result.

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { versions } from './versions.mjs';
import { color } from './ui.mjs';

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..', '..', '..');

// Each scaffolded project's package.json `name` becomes its Docker Compose project name — this
// is what makes container/network/volume names unique per project on the same machine (Compose
// scopes generated resource names to `-p`/COMPOSE_PROJECT_NAME), replacing the old hardcoded
// `bboard-*` container names that collided across multiple scaffolded projects.
function deriveProjectName() {
  try {
    const pkg = JSON.parse(readFileSync(resolve(rootDir, 'package.json'), 'utf-8'));
    return (
      pkg.name
        .replace(/^@[^/]+\//, '')
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^[-_]+/, '') || 'midnight-app'
    );
  } catch {
    return 'midnight-app';
  }
}

export const COMPOSE_PROJECT_NAME = deriveProjectName();
// Every `docker compose` invocation in this process tree (execSync inherits process.env) picks
// this up automatically — no need to thread `-p ${COMPOSE_PROJECT_NAME}` through every call site.
process.env.COMPOSE_PROJECT_NAME ??= COMPOSE_PROJECT_NAME;

// Any image published under this org is a Midnight stack component — used to tell "another
// Midnight project's container happens to be on this port" apart from a truly unrelated one.
const MIDNIGHT_IMAGE_PREFIX = 'midnightntwrk/';

function findDockerOwner(port) {
  try {
    const out = sh(`docker ps --format "{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Label \\"com.docker.compose.project\\"}}"`);
    for (const line of out.split('\n')) {
      if (!line) continue;
      const [id, name, image, ports, project] = line.split('\t');
      if (ports && ports.includes(`:${port}->`)) {
        return {
          kind: 'docker',
          id,
          name,
          image,
          project,
          ours: project === COMPOSE_PROJECT_NAME,
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
