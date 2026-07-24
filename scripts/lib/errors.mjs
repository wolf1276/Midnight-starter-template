// Plain-JS sibling of cli/src/errors.ts. Scripts under scripts/ run as plain .mjs and can't
// import TypeScript, so this file mirrors the same CLIError taxonomy, classifyError() logic,
// and box-formatted output so setup.sh/doctor.mjs/deploy.mjs/infra.mjs read as the same tool
// as the deploy CLI. Keep the two files' error text in sync when editing either one.

import { execSync } from 'node:child_process';
import { versions } from './versions.mjs';
import { color } from './ui.mjs';

/** Base class for every user-facing failure in the JS tooling. Never throw a raw Error — throw one of these. */
export class CLIError extends Error {
  constructor(details, options) {
    super(details.title, options);
    this.name = new.target.name;
    this.title = details.title;
    this.whatHappened = details.whatHappened;
    this.howToFix = details.howToFix;
    this.moreInfo = details.moreInfo;
    this.exitCode = details.exitCode ?? 1;
  }
}

export class DockerError extends CLIError {}
export class NetworkError extends CLIError {}
export class WalletError extends CLIError {}
export class DeploymentError extends CLIError {}
export class ValidationError extends CLIError {}
export class FilesystemError extends CLIError {}
export class NodeVersionError extends CLIError {}
export class NpmError extends CLIError {}
export class CompactError extends CLIError {}
export class ProofServerError extends CLIError {}
export class IndexerError extends CLIError {}
export class MidnightNodeError extends CLIError {}

/** Render one CLIError in the standard box format. Returns lines; caller decides how to print/log them. */
export function formatCliError(err, verbose) {
  const lines = [];
  lines.push('');
  lines.push(color.red(color.bold(`❌ ${err.title}`)));
  lines.push('');
  lines.push(color.bold('What happened'));
  lines.push('-------------');
  lines.push(err.whatHappened);
  lines.push('');
  lines.push(color.bold('How to fix it'));
  lines.push('-------------');
  lines.push(err.howToFix);
  if (verbose) {
    lines.push('');
    lines.push(color.bold('More information'));
    lines.push('----------------');
    if (err.moreInfo) lines.push(err.moreInfo);
    if (err.cause) lines.push(color.dim(err.cause instanceof Error ? (err.cause.stack ?? err.cause.message) : JSON.stringify(err.cause)));
    if (err.stack) lines.push(color.dim(err.stack));
  } else {
    lines.push('');
    lines.push(color.dim(`Re-run with ${color.cyan('--verbose')} for full diagnostic output.`));
  }
  lines.push('');
  return lines;
}

export function printCliError(err, verbose) {
  for (const line of formatCliError(err, verbose)) {
    process.stderr.write(`${line}\n`);
  }
}

/** Best-effort: who's holding a TCP port, for "Port Already In Use" errors. Never throws. */
export function describePortOwner(port) {
  try {
    const out = execSync(`lsof -i :${port} -sTCP:LISTEN`, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (out) return out;
  } catch {
    // lsof not installed or nothing found — fall through
  }
  try {
    const out = execSync('docker ps', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (out) return out;
  } catch {
    // Docker not available either
  }
  return '(could not identify the process — try `lsof -i` or `docker ps` yourself)';
}

const SERVICE_BY_PORT = Object.fromEntries(Object.entries(versions.ports).map(([port, service]) => [Number(port), service]));

function messageOf(e) {
  if (e instanceof Error) return e.message || e.name;
  if (e instanceof AggregateError) return e.errors.map((inner) => messageOf(inner)).join('; ');
  return String(e);
}

function nodeErrCode(e) {
  return e && typeof e === 'object' && 'code' in e ? String(e.code) : undefined;
}

/**
 * Classifies an arbitrary caught error (Docker CLI failure, Node error, npm error, SDK
 * error, filesystem error, bash failure, etc.) into a typed CLIError with a plain-English
 * explanation and exact next steps. `retryCommand` is the command the user should re-run
 * once fixed.
 */
export function classifyError(e, retryCommand) {
  if (e instanceof CLIError) return e;

  const message = messageOf(e);
  const code = nodeErrCode(e);
  const cause = e instanceof Error ? e : undefined;

  const portMatch =
    message.match(/Bind for 0\.0\.0\.0:(\d+) failed: port is already allocated/i) ??
    message.match(/:(\d{2,5}):.*address already in use/i);
  if (portMatch || /EADDRINUSE/i.test(message)) {
    const port = Number(portMatch?.[1] ?? message.match(/EADDRINUSE.*?:(\d{2,5})/i)?.[1]);
    const service = port ? (SERVICE_BY_PORT[port] ?? 'a required service') : 'a required service';
    const owner = port ? describePortOwner(port) : '(port unknown — see raw error with --verbose)';
    return new DockerError(
      {
        title: 'Port Already In Use',
        whatHappened: port
          ? `Port ${port} is already being used.\n\n${service[0].toUpperCase()}${service.slice(1)} requires this port.\n\nProcess using the port:\n\n${owner}`
          : `A required port is already in use.\n\n${message}`,
        howToFix: `Find what's using the port:\n\n  lsof -i :${port || '<port>'}\n\nor\n\n  docker ps\n\nStop the process or container using the port, then run:\n\n  npm run blockchain:start`,
      },
      { cause },
    );
  }

  if (/cannot connect to the docker daemon|docker daemon is not running|is the docker daemon running/i.test(message)) {
    return new DockerError(
      {
        title: 'Docker Daemon Not Running',
        whatHappened: 'Docker is installed, but the Docker daemon is not currently running.',
        howToFix: 'Start Docker Desktop (or run `sudo systemctl start docker` on Linux), wait for it to finish starting, then retry.',
      },
      { cause },
    );
  }

  if (/docker desktop is starting|docker is starting/i.test(message)) {
    return new DockerError(
      {
        title: 'Docker Desktop Is Still Starting',
        whatHappened: 'Docker Desktop is in the process of starting up.',
        howToFix: 'Wait a few seconds for Docker to finish starting, then retry.',
      },
      { cause },
    );
  }

  if (/permission denied.*docker\.sock|permission denied while trying to connect to the docker daemon/i.test(message)) {
    return new DockerError(
      {
        title: 'Docker Permission Denied',
        whatHappened: "Your user doesn't have permission to talk to the Docker daemon.",
        howToFix: 'Add yourself to the docker group and restart your session:\n\n  sudo usermod -aG docker $USER\n\nthen log out and back in. Or re-run with sudo (not recommended for regular use).',
      },
      { cause },
    );
  }

  if (
    /docker\.sock.*(no such file|not found|connection refused)/i.test(message) ||
    /cannot connect to the docker daemon at unix/i.test(message)
  ) {
    return new DockerError(
      {
        title: 'Docker Socket Unavailable',
        whatHappened: 'The Docker socket could not be reached — Docker may not be installed or running.',
        howToFix: 'Install Docker from https://docs.docker.com/get-docker/, make sure it is running, then retry.',
      },
      { cause },
    );
  }

  if (
    /command not found: docker|'docker' is not recognized|no such file or directory.*docker$/i.test(message) ||
    (code === 'ENOENT' && /docker/i.test(message))
  ) {
    return new DockerError(
      {
        title: 'Docker Not Installed',
        whatHappened: 'The `docker` command was not found on your PATH.',
        howToFix: 'Install Docker Desktop from https://docs.docker.com/get-docker/, then re-run this command.',
      },
      { cause },
    );
  }

  if (/pull access denied|manifest unknown|failed to pull image|no such image|error pulling image/i.test(message)) {
    return new DockerError(
      {
        title: 'Docker Image Pull Failed',
        whatHappened: `Docker could not pull a required image.\n\n${message}`,
        howToFix: 'Check your internet connection and that you can reach Docker Hub, then retry:\n\n  npm run blockchain:start\n\nIf this persists, check config/versions.json for the expected image tags.',
      },
      { cause },
    );
  }

  if (/container.*already in use|is already in use by container|conflict.*container name/i.test(message)) {
    return new DockerError(
      {
        title: 'Existing Container Conflict',
        whatHappened: `A container with the same name already exists.\n\n${message}`,
        howToFix: 'Remove the conflicting container(s) and retry:\n\n  npm run blockchain:reset\n  npm run blockchain:start',
      },
      { cause },
    );
  }

  if (/network .*already exists|could not find an available.*network|pool overlaps with other one/i.test(message)) {
    return new DockerError(
      {
        title: 'Existing Network Conflict',
        whatHappened: `Docker could not create the network for this stack.\n\n${message}`,
        howToFix: 'Reset the stack and retry:\n\n  npm run blockchain:reset\n  npm run blockchain:start',
      },
      { cause },
    );
  }

  if (/volume .*already exists|volume.*in use/i.test(message)) {
    return new DockerError(
      {
        title: 'Existing Volume Conflict',
        whatHappened: `Docker reported a conflicting volume.\n\n${message}`,
        howToFix: 'Reset volumes and retry (this clears local chain/indexer data):\n\n  npm run docker:reset\n  npm run blockchain:start',
      },
      { cause },
    );
  }

  if (/container.*(unhealthy|exited|failed to start)/i.test(message)) {
    return new DockerError(
      {
        title: 'Container Failed To Start',
        whatHappened: `A required container failed to start or become healthy.\n\n${message}`,
        howToFix: 'Inspect logs and retry:\n\n  docker compose -f docker/docker-compose.yml logs\n  npm run blockchain:reset\n  npm run blockchain:start',
      },
      { cause },
    );
  }

  if (code === 'ENOMEM' || /out of memory|oom.?killed|cannot allocate memory/i.test(message)) {
    return new DockerError(
      {
        title: 'Docker Ran Out Of Memory',
        whatHappened: `A container was killed for exceeding available memory.\n\n${message}`,
        howToFix: 'Increase the memory allocated to Docker (Docker Desktop → Settings → Resources → Memory, at least 8GB recommended), then retry:\n\n  npm run blockchain:start',
      },
      { cause },
    );
  }

  // Bash / shell-level failures from setup.sh
  if (/command not found/i.test(message) && !/docker|compact/i.test(message)) {
    const cmd = message.match(/(\S+): command not found/i)?.[1];
    return new ValidationError(
      {
        title: 'Missing Required Tool',
        whatHappened: cmd ? `The '${cmd}' command was not found on your PATH.` : message,
        howToFix: cmd ? `Install '${cmd}' and re-run 'npm run setup'.` : 'Install the missing tool and re-run.',
      },
      { cause },
    );
  }

  // npm
  if (/npm (err|ERR!)/i.test(message) || /npm install failed/i.test(message)) {
    if (/ENOSPC/i.test(message) || code === 'ENOSPC') {
      return new NpmError(
        {
          title: 'npm Install Failed — Disk Full',
          whatHappened: 'npm ran out of disk space while installing dependencies.',
          howToFix: 'Free up disk space, then re-run:\n\n  npm install',
        },
        { cause },
      );
    }
    if (/EACCES/i.test(message) || code === 'EACCES') {
      return new NpmError(
        {
          title: 'npm Install Failed — Permission Denied',
          whatHappened: 'npm was denied permission to write to a required directory.',
          howToFix: "Don't use sudo with npm. Fix ownership of your npm cache/project directory:\n\n  sudo chown -R $(whoami) ~/.npm .\n\nthen re-run:\n\n  npm install",
        },
        { cause },
      );
    }
    if (/ENOTFOUND|ETIMEDOUT|network/i.test(message)) {
      return new NpmError(
        {
          title: 'npm Install Failed — Network Error',
          whatHappened: 'npm could not reach the registry.',
          howToFix: 'Check your internet connection / proxy / VPN, then retry:\n\n  npm install',
        },
        { cause },
      );
    }
    return new NpmError(
      {
        title: 'npm Install Failed',
        whatHappened: message,
        howToFix: 'Re-run with --verbose for the full npm log, or try:\n\n  rm -rf node_modules\n  npm install',
      },
      { cause },
    );
  }

  // Compact CLI / toolchain
  if (/command not found: compact|'compact' is not recognized|compact.*ENOENT/i.test(message)) {
    return new CompactError(
      {
        title: 'Compact CLI Missing',
        whatHappened: 'The `compact` command was not found on your PATH.',
        howToFix: "Install the Compact CLI, then verify it: \n\n  curl --proto '=https' --tlsv1.2 -LsSf https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh\n  compact --version",
      },
      { cause },
    );
  }
  if (/no toolchain installed|compact update/i.test(message)) {
    return new CompactError(
      {
        title: 'Compact Toolchain Missing',
        whatHappened: 'The Compact CLI is installed, but no compiler toolchain is active.',
        howToFix: 'Install and select a toolchain:\n\n  compact update\n  compact list',
      },
      { cause },
    );
  }
  if (/compact.*compile.*(failed|error)|compiler error/i.test(message)) {
    return new CompactError(
      {
        title: 'Contract Compilation Failed',
        whatHappened: `The Compact compiler reported an error.\n\n${message}`,
        howToFix: 'Fix the reported error in your .compact source, then rebuild:\n\n  npm run build:contract',
      },
      { cause },
    );
  }
  if (/verification failed/i.test(message)) {
    return new CompactError(
      {
        title: 'Contract Verification Failed',
        whatHappened: `The compiled contract failed verification.\n\n${message}`,
        howToFix: 'Re-run the build with --verbose to see the full verifier output, then fix the contract and rebuild:\n\n  npm run build:contract',
      },
      { cause },
    );
  }

  // Proof server / indexer / node
  if (/proof.?server/i.test(message)) {
    if (/timeout|timed out/i.test(message)) {
      return new ProofServerError(
        {
          title: 'Proof Server Startup Timeout',
          whatHappened: 'The Proof Server did not become healthy in time.',
          howToFix: 'Check logs and retry:\n\n  docker compose -f docker/docker-compose.yml logs proof-server\n  npm run blockchain:reset\n  npm run blockchain:start',
        },
        { cause },
      );
    }
    return new ProofServerError(
      {
        title: 'Proof Server Unavailable',
        whatHappened: `The Proof Server could not be reached.\n\n${message}`,
        howToFix: 'Make sure Docker is running and the stack is up, then retry:\n\n  npm run blockchain:start',
      },
      { cause },
    );
  }
  if (/indexer/i.test(message) && /(unreachable|health|timeout|corrupt)/i.test(message)) {
    return new IndexerError(
      {
        title: 'Indexer Unavailable',
        whatHappened: `The Indexer could not be reached or reported bad health.\n\n${message}`,
        howToFix: 'Check logs and retry:\n\n  docker compose -f docker/docker-compose.yml logs indexer\n  npm run blockchain:reset\n  npm run blockchain:start',
      },
      { cause },
    );
  }
  if (/\bnode\b.*(rpc|sync).*timeout|rpc unavailable/i.test(message)) {
    return new MidnightNodeError(
      {
        title: 'Midnight Node Unavailable',
        whatHappened: `The Midnight Node RPC could not be reached or failed to sync in time.\n\n${message}`,
        howToFix: 'Check logs and retry:\n\n  docker compose -f docker/docker-compose.yml logs node\n  npm run blockchain:reset\n  npm run blockchain:start',
      },
      { cause },
    );
  }

  // Wallet / faucet
  if (/status code 503/i.test(message) && /faucet/i.test(message)) {
    return new WalletError(
      {
        title: 'Faucet Temporarily Unavailable',
        whatHappened: 'The public faucet is currently out of funds or unavailable.',
        howToFix: 'Please try again in a few minutes. The deployment will continue automatically once funds arrive.',
      },
      { cause },
    );
  }
  if (/wallet.*corrupt/i.test(message)) {
    return new WalletError(
      {
        title: 'Wallet Data Corrupted',
        whatHappened: `The local wallet store could not be read.\n\n${message}`,
        howToFix: 'Reset the local deployment wallet and re-fund it:\n\n  npm run wallet:reset',
      },
      { cause },
    );
  }
  if (/insufficient (balance|funds)/i.test(message)) {
    return new WalletError(
      {
        title: 'Insufficient Wallet Balance',
        whatHappened: 'The wallet does not have enough tokens to complete this operation.',
        howToFix: 'Fund the wallet from the faucet shown above, wait for the balance to update, then retry.',
      },
      { cause },
    );
  }
  if (/network mismatch|wrong network|unexpected network id/i.test(message)) {
    return new WalletError(
      {
        title: 'Wallet Network Mismatch',
        whatHappened: `This wallet was created for a different network.\n\n${message}`,
        howToFix: 'Reset the wallet for this network and let the CLI create a new one:\n\n  npm run wallet:reset',
      },
      { cause },
    );
  }

  // Deployment
  if (/transaction rejected/i.test(message)) {
    return new DeploymentError(
      {
        title: 'Transaction Rejected',
        whatHappened: `The network rejected the deployment transaction.\n\n${message}`,
        howToFix: 'Check the reported reason above, ensure your wallet is funded and synced, then retry.',
      },
      { cause },
    );
  }
  if (/proof generation failed/i.test(message)) {
    return new DeploymentError(
      {
        title: 'Proof Generation Failed',
        whatHappened: `Generating the zero-knowledge proof for this transaction failed.\n\n${message}`,
        howToFix: 'Make sure the Proof Server is healthy, then retry:\n\n  npm run blockchain:start',
      },
      { cause },
    );
  }
  if (/duplicate deployment|already deployed/i.test(message)) {
    return new DeploymentError(
      {
        title: 'Duplicate Deployment',
        whatHappened: 'A contract from this wallet/nonce appears to already be deployed.',
        howToFix: 'Check deployment.json for the existing address, or reset the wallet to deploy fresh:\n\n  npm run wallet:reset',
      },
      { cause },
    );
  }
  if (/deployment timed out|deployment timeout/i.test(message)) {
    return new DeploymentError(
      {
        title: 'Deployment Timed Out',
        whatHappened: message,
        howToFix: 'Check network connectivity and Docker service health, then retry.',
      },
      { cause },
    );
  }

  // Filesystem
  if (code === 'EACCES' || /permission denied/i.test(message)) {
    return new FilesystemError(
      {
        title: 'Permission Denied',
        whatHappened: `A filesystem operation was denied.\n\n${message}`,
        howToFix: 'Check file/directory ownership and permissions for this project, then retry.',
      },
      { cause },
    );
  }
  if (code === 'ENOSPC') {
    return new FilesystemError(
      {
        title: 'Disk Full',
        whatHappened: 'The filesystem ran out of space.',
        howToFix: 'Free up disk space, then retry.',
      },
      { cause },
    );
  }
  if (code === 'EROFS') {
    return new FilesystemError(
      {
        title: 'Read-Only Filesystem',
        whatHappened: 'A write was attempted on a read-only filesystem.',
        howToFix: 'Re-run from a writable location/volume.',
      },
      { cause },
    );
  }
  // `(?![a-zA-Z])` after `.env` keeps this from false-matching "...indexer.environment..."
  // (e.g. docker compose variable-interpolation errors), which contains ".env" as a
  // substring of "environment" but isn't about a missing .env file at all.
  if (/\.env(?![a-zA-Z]).*(missing|not found|ENOENT)|ENOENT.*\.env(?![a-zA-Z])/i.test(message)) {
    return new FilesystemError(
      {
        title: 'Missing .env File',
        whatHappened: 'A required .env file was not found.',
        howToFix: 'Copy the example file and fill it in:\n\n  cp web/.env.example web/.env.local',
      },
      { cause },
    );
  }
  if (/managed\/bboard|contracts.*not found|missing contract/i.test(message)) {
    return new FilesystemError(
      {
        title: 'Missing Compiled Contract',
        whatHappened: 'The compiled contract artifacts were not found.',
        howToFix: 'Build the contract first:\n\n  npm run build:contract',
      },
      { cause },
    );
  }

  // Network
  if (/enotfound|eai_again/i.test(message) || code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return new NetworkError(
      {
        title: 'DNS Lookup Failed',
        whatHappened: `Could not resolve a hostname.\n\n${message}`,
        howToFix: 'Check your internet connection and DNS settings, then retry.',
      },
      { cause },
    );
  }
  if (/econnrefused/i.test(message) || code === 'ECONNREFUSED') {
    return new NetworkError(
      {
        title: 'Connection Refused',
        whatHappened: `Could not connect to a required service.\n\n${message}`,
        howToFix: 'Make sure the required services are running:\n\n  npm run blockchain:start\n  npm run doctor',
      },
      { cause },
    );
  }
  if (/etimedout|timed out|timeout/i.test(message) || code === 'ETIMEDOUT') {
    return new NetworkError(
      {
        title: 'Network Timeout',
        whatHappened: `A network request timed out.\n\n${message}`,
        howToFix: 'Check your connection and retry. If this persists, the remote service may be degraded.',
      },
      { cause },
    );
  }
  if (/self signed certificate|unable to verify the first certificate|certificate has expired|SSL|TLS/i.test(message)) {
    return new NetworkError(
      {
        title: 'TLS/SSL Error',
        whatHappened: `A secure connection could not be established.\n\n${message}`,
        howToFix: 'If you are behind a corporate proxy/VPN, configure NODE_EXTRA_CA_CERTS, or check the system clock, then retry.',
      },
      { cause },
    );
  }
  if (/proxy/i.test(message) && /(error|failed|refused)/i.test(message)) {
    return new NetworkError(
      {
        title: 'Proxy Error',
        whatHappened: message,
        howToFix: 'Check your HTTP_PROXY/HTTPS_PROXY environment variables, then retry.',
      },
      { cause },
    );
  }
  if (/status code 5\d\d/i.test(message)) {
    return new NetworkError(
      {
        title: 'Remote Service Unavailable',
        whatHappened: `A remote Midnight service returned a server error.\n\n${message}`,
        howToFix: 'This is usually temporary — wait a bit and retry.',
      },
      { cause },
    );
  }
  if (/offline|network is unreachable/i.test(message) || code === 'ENETUNREACH') {
    return new NetworkError(
      {
        title: 'No Network Connection',
        whatHappened: 'This machine appears to be offline.',
        howToFix: 'Check your internet connection, then retry.',
      },
      { cause },
    );
  }

  // Fallback — never show a raw stack trace.
  return new CLIError(
    {
      title: 'Unexpected Error',
      whatHappened: 'Something unexpected happened.',
      howToFix: `Please rerun with:\n\n  --verbose\n\nand report the output${retryCommand ? `, e.g.:\n\n  ${retryCommand} --verbose` : '.'}`,
      moreInfo: message,
    },
    { cause },
  );
}

/** Throws a friendly NodeVersionError instead of letting an old Node choke on modern syntax later. */
export function assertSupportedNodeVersion() {
  const required = versions.requiredNodeMajor;
  const major = Number(process.version.slice(1).split('.')[0]);
  if (Number.isNaN(major) || major < required) {
    throw new NodeVersionError({
      title: 'Unsupported Node.js Version',
      whatHappened: `Required:\nNode.js >=${required}\n\nDetected:\nNode.js ${process.version.slice(1)}`,
      howToFix: `nvm install ${required}\nnvm use ${required}`,
    });
  }
}

/**
 * Installs a top-level handler for a script: runs `fn`, and on any failure prints a
 * structured CLIError (classifying raw errors first) instead of letting a stack trace
 * reach the terminal, then exits with that error's code. Also catches anything that slips
 * past a local try/catch via unhandledRejection/uncaughtException.
 */
export async function runMain(fn, opts) {
  const { verbose, retryCommand, onFatal } = opts;
  const fail = async (e) => {
    const err = classifyError(e, retryCommand);
    printCliError(err, verbose);
    if (onFatal) await onFatal(err).catch(() => {});
    process.exit(err.exitCode);
  };
  process.once('unhandledRejection', fail);
  process.once('uncaughtException', fail);
  try {
    assertSupportedNodeVersion();
    await fn();
  } catch (e) {
    await fail(e);
  }
}

export const isVerbose = () => process.argv.slice(2).includes('--verbose') || process.argv.slice(2).includes('--debug');
