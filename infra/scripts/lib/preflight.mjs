// One check function per precondition this stack needs before doing expensive work (Docker
// pulls, npm install, contract builds). Each check throws a typed error from errors.mjs with
// an exact title/whatHappened/howToFix on failure — never a generic message. Used by setup.sh
// (via run-preflight.mjs, fail-fast), doctor.mjs (via runPreflight({failFast: false}), full
// report), and the docker/blockchain wrapper scripts (targeted subsets).

import { execSync } from 'node:child_process';
import { accessSync, constants, existsSync, readFileSync, statfsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { versions } from './versions.mjs';
import {
  CompactError,
  DockerError,
  FilesystemError,
  NetworkError,
  NodeVersionError,
  NpmError,
  ValidationError,
  printCliError,
} from './errors.mjs';
import { checkRequiredPorts, printPortConflicts } from './ports.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const rootDir = resolve(__dirname, '..', '..', '..');

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf-8', shell: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** name -> () => detail string | throws a typed CLIError */
export const checks = {
  node: () => {
    const version = process.version.slice(1);
    const major = Number(version.split('.')[0]);
    if (Number.isNaN(major) || major < versions.requiredNodeMajor) {
      throw new NodeVersionError({
        title: 'Unsupported Node.js Version',
        whatHappened: `Required:\nNode.js >=${versions.requiredNodeMajor}\n\nDetected:\nNode.js ${version}`,
        howToFix: `Install Node ${versions.requiredNodeMajor}+ from https://nodejs.org, or with nvm:\n\n  nvm install ${versions.requiredNodeMajor}\n  nvm use ${versions.requiredNodeMajor}`,
      });
    }
    return version;
  },

  npm: () => {
    try {
      return sh('npm --version');
    } catch (e) {
      throw new NpmError(
        {
          title: 'npm Not Found',
          whatHappened: '`npm` is not on your PATH.',
          howToFix: 'Install Node.js (which bundles npm) from https://nodejs.org, then retry.',
        },
        { cause: e },
      );
    }
  },

  dockerCli: () => {
    try {
      return sh('docker --version');
    } catch (e) {
      throw new DockerError(
        {
          title: 'Docker Not Installed',
          whatHappened: 'The `docker` command was not found on your PATH.',
          howToFix: 'Install Docker Desktop from https://docs.docker.com/get-docker/, then re-run.',
        },
        { cause: e },
      );
    }
  },

  dockerDaemon: () => {
    try {
      sh('docker info');
      return 'running';
    } catch (e) {
      throw new DockerError(
        {
          title: 'Docker Daemon Not Running',
          whatHappened: 'Docker is installed, but the daemon is not currently running.',
          howToFix: 'Start Docker Desktop (or `sudo systemctl start docker` on Linux), wait for it to finish starting, then retry.',
        },
        { cause: e },
      );
    }
  },

  dockerCompose: () => {
    try {
      return sh('docker compose version');
    } catch (e) {
      throw new DockerError(
        {
          title: 'Docker Compose Plugin Missing',
          whatHappened: 'The `docker compose` plugin is not available.',
          howToFix: 'Update Docker Desktop, or install the compose plugin: https://docs.docker.com/compose/install/',
        },
        { cause: e },
      );
    }
  },

  dockerMemory: () => {
    try {
      const bytes = Number(sh(`docker info --format '{{.MemTotal}}'`));
      if (!bytes) return 'unknown (could not read Docker memory allocation)';
      const gb = bytes / 1024 ** 3;
      if (gb < 4) {
        throw new DockerError({
          title: 'Docker Memory Allocation Too Low',
          whatHappened: `Docker is allocated ${gb.toFixed(1)}GB of memory. The Midnight node/indexer/proof-server stack needs at least 4GB (8GB recommended).`,
          howToFix: 'Docker Desktop → Settings → Resources → Memory, increase to at least 4GB, then Apply & Restart.',
        });
      }
      return `${gb.toFixed(1)}GB`;
    } catch (e) {
      if (e instanceof DockerError) throw e;
      return 'unknown (could not read Docker memory allocation)';
    }
  },

  compactCli: () => {
    try {
      return sh('compact --version');
    } catch (e) {
      throw new CompactError(
        {
          title: 'Compact CLI Missing',
          whatHappened: 'The `compact` command was not found on your PATH.',
          howToFix: "Install it:\n\n  curl --proto '=https' --tlsv1.2 -LsSf https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh\n  compact --version",
        },
        { cause: e },
      );
    }
  },

  compactCompiler: () => {
    let out;
    try {
      out = sh('compact list');
    } catch (e) {
      throw new CompactError(
        {
          title: 'Compact Toolchain Missing',
          whatHappened: 'Could not list Compact toolchains — the Compact CLI may not be fully installed.',
          howToFix: 'Install and select a toolchain:\n\n  compact update\n  compact list',
        },
        { cause: e },
      );
    }
    // `compact list` marks the default with a "→" glyph, but when stdout isn't a TTY (as here,
    // via execSync) some versions of the CLI print the literal escape text "\u{2192}" instead of
    // the actual arrow character — match both so the check doesn't false-negative in that case.
    const active = out.split('\n').find((l) => l.includes('→') || l.includes('\\u{2192}') || l.includes('*'));
    if (!active) {
      throw new CompactError({
        title: 'Compact Toolchain Not Selected',
        whatHappened: 'The Compact CLI is installed, but no compiler toolchain is active.',
        howToFix: 'Install and select a toolchain:\n\n  compact update\n  compact list',
      });
    }
    return active.trim();
  },

  internet: () => {
    try {
      sh('curl -sf --max-time 5 -o /dev/null https://registry.npmjs.org');
      return 'reachable';
    } catch (e) {
      throw new NetworkError(
        {
          title: 'No Internet Connection',
          whatHappened: 'Could not reach the npm registry (https://registry.npmjs.org).',
          howToFix: 'Check your internet connection / VPN / proxy, then retry.',
        },
        { cause: e },
      );
    }
  },

  ports: () => {
    const conflicts = checkRequiredPorts();
    if (conflicts.length) {
      printPortConflicts(conflicts);
      throw new ValidationError({
        title: 'Ports Already In Use',
        whatHappened: `${conflicts.length} required port${conflicts.length === 1 ? ' is' : 's are'} occupied (see panel above).`,
        howToFix: 'Stop the conflicting process/container(s) listed above, then retry.',
        exitCode: 1,
      });
    }
    return 'all free';
  },

  diskSpace: () => {
    try {
      const stats = statfsSync(rootDir);
      const freeBytes = stats.bavail * stats.bsize;
      const freeGb = freeBytes / 1024 ** 3;
      if (freeGb < 5) {
        throw new FilesystemError({
          title: 'Low Disk Space',
          whatHappened: `Only ${freeGb.toFixed(1)}GB free. Docker images and build artifacts for this project need at least 5GB.`,
          howToFix: 'Free up disk space (docker system prune is a good start once images are pulled), then retry.',
        });
      }
      return `${freeGb.toFixed(1)}GB free`;
    } catch (e) {
      if (e instanceof FilesystemError) throw e;
      return 'unknown (could not check disk space)';
    }
  },

  fsPermissions: () => {
    try {
      accessSync(rootDir, constants.W_OK);
      return 'writable';
    } catch (e) {
      throw new FilesystemError(
        {
          title: 'Project Directory Not Writable',
          whatHappened: `This user does not have write access to ${rootDir}.`,
          howToFix: `Fix ownership/permissions, e.g.:\n\n  sudo chown -R $(whoami) ${rootDir}`,
        },
        { cause: e },
      );
    }
  },

  requiredFiles: () => {
    const missing = [];
    if (!existsSync(resolve(rootDir, 'package.json'))) missing.push('package.json');
    if (!existsSync(resolve(rootDir, 'infra', 'docker', 'docker-compose.yml'))) missing.push('infra/docker/docker-compose.yml');
    if (missing.length) {
      throw new FilesystemError({
        title: 'Missing Required Files',
        whatHappened: `Expected files not found: ${missing.join(', ')}.`,
        howToFix: 'Make sure you are running this from a clean checkout of the repository.',
      });
    }
    return 'present';
  },
};

export const ALL_CHECK_NAMES = Object.keys(checks);

/**
 * Runs the named checks in order. In fail-fast mode (default), stops and prints the first
 * failure, matching "stop immediately, explain why, show the exact fix". In non-fail-fast
 * mode (used by doctor.mjs), runs every check and returns a full report.
 */
export function runPreflight(names = ALL_CHECK_NAMES, { failFast = true, verbose = false } = {}) {
  const results = [];
  for (const name of names) {
    try {
      const detail = checks[name]();
      results.push({ name, ok: true, detail });
    } catch (e) {
      results.push({ name, ok: false, error: e });
      if (failFast) {
        printCliError(e instanceof Error && 'title' in e ? e : e, verbose);
        return { results, passed: results.filter((r) => r.ok), failed: results.filter((r) => !r.ok), stoppedEarly: true };
      }
    }
  }
  return { results, passed: results.filter((r) => r.ok), failed: results.filter((r) => !r.ok), stoppedEarly: false };
}
