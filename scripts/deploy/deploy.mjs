#!/usr/bin/env node
import { spawn, execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..', '..');

// --- Terminal formatting helpers (no deps, matches cli/src/ui.ts) ---
const isTTY = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code) => (s) => (isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);
const dim = c('2');
const bold = c('1');
const green = c('32');
const red = c('31');
const yellow = c('33');
const cyan = c('36');
const RULE = dim('\u2501'.repeat(36));

const fmt = {
  ok: (msg) => console.log(`  ${green('\u2713')} ${msg}`),
  fail: (msg) => console.error(`  ${red('\u2717')} ${msg}`),
  warn: (msg) => console.log(`  ${yellow('\u26A0')} ${msg}`),
  section: (title) => {
    console.log(`\n${RULE}`);
    console.log(`  ${bold(title)}`);
    console.log(`${RULE}`);
  },
  info: (msg) => console.log(`  ${dim(msg)}`),
  cmd: (msg) => console.log(`    ${cyan(msg)}`),
  dim,
  bold,
  green,
  red,
  yellow,
  cyan,
};

const args = process.argv.slice(2);
let network = 'preview';
const verbose = args.includes('--verbose') || args.includes('--debug');
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--network' && i + 1 < args.length) {
    network = args[i + 1];
    i++;
  } else if (args[i].startsWith('--network=')) {
    network = args[i].split('=')[1];
  }
}

if (!['preview', 'preprod'].includes(network)) {
  fmt.fail(`Unsupported network '${network}'. Use 'preview' or 'preprod'.`);
  process.exit(1);
}

let deployStart = Date.now();

async function main() {
  deployStart = Date.now();

  fmt.section(`\u{1F680} Midnight Contract Deployment`);
  fmt.info(`Network: ${network}`);

  const requiredNodeMajor = 24;
  const nodeVersion = process.version.slice(1);
  const [nodeMajor] = nodeVersion.split('.').map(Number);
  if (nodeMajor < requiredNodeMajor) {
    const nvmDir = process.env.NVM_DIR || `${process.env.HOME}/.nvm`;
    const nvmSh = `${nvmDir}/nvm.sh`;
    if (existsSync(nvmSh)) {
      try {
        const nvmNodePath = execSync(`. ${nvmSh} && nvm which ${requiredNodeMajor}`, { encoding: 'utf-8', shell: true }).trim();
        if (nvmNodePath && existsSync(nvmNodePath)) {
          console.log(`Node.js ${nodeVersion} is too old. Re-executing with ${nvmNodePath}...`);
          const child = spawn(nvmNodePath, process.argv.slice(1), { stdio: 'inherit', cwd: process.cwd(), shell: true });
          child.on('exit', (code) => process.exit(code ?? 1));
          return;
        }
      } catch {}
    }
    fmt.fail(`Node.js >= ${requiredNodeMajor}.x required (current: ${nodeVersion}).`);
    fmt.info('Install via nvm:');
    fmt.cmd(`nvm install ${requiredNodeMajor} && nvm use ${requiredNodeMajor}`);
    fmt.info('Or download from:');
    fmt.cmd('https://nodejs.org/');
    process.exit(1);
  }
  fmt.ok(`Node.js ${nodeVersion}`);

  const rootNodeModules = resolve(rootDir, 'node_modules');
  if (!existsSync(rootNodeModules)) {
    fmt.fail("Dependencies not installed.");
    fmt.info("Run:");
    fmt.cmd("npm install");
    process.exit(1);
  }
  fmt.ok('Dependencies installed');

  try {
    execSync('docker info > /dev/null 2>&1', { shell: true });
    fmt.ok('Docker is running');
  } catch {
    fmt.fail('Docker is not running.');
    fmt.info('Install Docker Desktop (or start the Docker daemon) and start it, then retry.');
    fmt.info('  https://docs.docker.com/get-docker/');
    process.exit(1);
  }

  try {
    execSync('compact --version > /dev/null 2>&1', { shell: true });
    fmt.ok('Compact compiler found');
  } catch {
    fmt.fail('Compact compiler not found.');
    fmt.info('Install the Midnight Compact toolchain:');
    fmt.cmd('curl --proto \'=https\' --tlsv1.2 -sSf https://raw.githubusercontent.com/midnightntwrk/compact/main/install.sh | sh');
    process.exit(1);
  }

  try {
    const out = execSync('compact list', { encoding: 'utf-8', shell: true });
    const active = out.split('\n').find((l) => l.includes('→') || l.includes('*'));
    if (!active) throw new Error('no active toolchain');
    fmt.ok(`Compact toolchain active — ${active.trim()}`);
  } catch {
    fmt.fail('No active Compact toolchain.');
    fmt.info("Install one via:");
    fmt.cmd('compact update');
    process.exit(1);
  }

  const cliPackageDir = resolve(rootDir, 'cli');
  if (!existsSync(resolve(cliPackageDir, 'package.json')) || !existsSync(resolve(cliPackageDir, 'node_modules'))) {
    fmt.fail("CLI workspace (cli/) missing or dependencies not installed.");
    fmt.info("Run from repo root:");
    fmt.cmd('npm install');
    process.exit(1);
  }
  fmt.ok('CLI workspace ready');

  const proofServerImage = 'midnightntwrk/proof-server:8.0.3';
  try {
    execSync(`docker image inspect ${proofServerImage} > /dev/null 2>&1 || docker pull ${proofServerImage} > /dev/null 2>&1`, { shell: true });
    fmt.ok('Proof Server image available');
  } catch {
    fmt.fail('Could not find or pull the Proof Server image.');
    fmt.info(`Image: ${proofServerImage}`);
    fmt.info('Check your Docker registry access and network connection, then retry.');
    fmt.info('The proof server will be started automatically as a container during deployment.');
    process.exit(1);
  }

  const managedDir = resolve(rootDir, 'contracts', 'src', 'managed', 'bboard', 'contract');
  if (!existsSync(managedDir)) {
    fmt.info('\nBuilding contract...');
    execSync('npm run build:contract', { cwd: rootDir, stdio: 'inherit', shell: true });
    fmt.ok('Contract built');
  } else {
    fmt.ok('Contract already compiled');
  }

  const cliDistDir = resolve(rootDir, 'cli', 'dist');
  const cliLauncherDir = resolve(rootDir, 'cli', 'dist', 'launcher');
  if (!existsSync(cliDistDir) || !existsSync(cliLauncherDir)) {
    fmt.info('Building CLI...');
    execSync('npm run build:cli', { cwd: rootDir, stdio: 'inherit', shell: true });
    fmt.ok('CLI built');
  } else {
    fmt.ok('CLI already built');
  }

  // Note: the proof server itself is started by RemoteTestEnvironment (testkit-js)
  // inside deploy.ts via scripts/docker/proof-server.yml — no need to start it here too.

  fmt.section(`\u{1F4E6} Deploying to ${network}`);

  const cliArgs = [
    '--experimental-specifier-resolution=node',
    '--loader', 'ts-node/esm',
    'src/launcher/deploy.ts',
    network,
  ];
  if (verbose) cliArgs.push('--verbose');

  let output = '';
  let stderrOutput = '';
  const child = spawn('node', cliArgs, {
    cwd: resolve(rootDir, 'cli'),
    stdio: ['inherit', 'pipe', 'pipe'],
    env: {
      ...process.env,
      TS_NODE_PROJECT: resolve(rootDir, 'cli', 'tsconfig.json'),
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --max-old-space-size=4096`.trim(),
      // Hide ExperimentalWarning/DeprecationWarning noise (ts-node loader, Node internals)
      // by default; --verbose re-enables the full raw output for troubleshooting.
      ...(verbose ? {} : { NODE_NO_WARNINGS: '1' }),
    },
  });

  child.stdout.on('data', (chunk) => {
    process.stdout.write(chunk);
    output += chunk.toString();
  });

  child.stderr.on('data', (chunk) => {
    if (verbose) {
      process.stderr.write(chunk);
    } else {
      stderrOutput += chunk.toString();
    }
  });

  child.on('exit', (code) => {
    if (code === 0) {
      const match = output.match(/^DEPLOYMENT_RESULT (.+)$/m);
      if (match) {
        try {
          const result = JSON.parse(match[1]);
          saveDeploymentArtifacts(result);
        } catch (e) {
          fmt.warn(`Could not parse deployment result: ${e.message}`);
        }
      }
    } else {
      if (!verbose && stderrOutput.trim()) {
        console.error('');
        fmt.fail('Deployment failed.');
        fmt.info('Re-run with --verbose for full diagnostic output:');
        fmt.cmd(`npm run deploy -- --network ${network} --verbose`);
        console.error('');
      }
    }
    process.exit(code ?? 1);
  });
}

function saveDeploymentArtifacts(result) {
  const deploymentPath = resolve(rootDir, 'deployment.json');
  let history = [];
  if (existsSync(deploymentPath)) {
    try {
      history = JSON.parse(readFileSync(deploymentPath, 'utf-8'));
      if (!Array.isArray(history)) history = [];
    } catch {
      history = [];
    }
  }
  history.unshift(result);
  writeFileSync(deploymentPath, JSON.stringify(history, null, 2) + '\n');
  fmt.ok('Saved deployment record to deployment.json');

  const envLocalPath = resolve(rootDir, 'web', '.env.local');
  if (existsSync(envLocalPath)) {
    let env = readFileSync(envLocalPath, 'utf-8');
    const line = `NEXT_PUBLIC_CONTRACT_ADDRESS=${result.contractAddress}`;
    env = /^NEXT_PUBLIC_CONTRACT_ADDRESS=.*$/m.test(env)
      ? env.replace(/^NEXT_PUBLIC_CONTRACT_ADDRESS=.*$/m, line)
      : `${env.trimEnd()}\n\n# Set automatically by npm run contracts:deploy\n${line}\n`;
    writeFileSync(envLocalPath, env);
    fmt.ok('Updated web/.env.local with NEXT_PUBLIC_CONTRACT_ADDRESS');
  }

  const ms = Date.now() - deployStart;
  const elapsed = ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;

  fmt.section(`\u2705 Deployment completed in ${elapsed}`);
  console.log(`  ${fmt.dim('Network:')}   ${result.network}`);
  console.log(`  ${fmt.dim('Contract:')}  ${result.contractAddress}`);
  if (result.explorerUrl) {
    console.log(`  ${fmt.dim('Explorer:')}  ${result.explorerUrl}`);
  }
  console.log(`  ${fmt.dim('Indexer:')}   ${result.indexer}`);
  console.log('');
  fmt.info('Next steps:');
  fmt.cmd('npm run dev                         Start the frontend');
  fmt.cmd('npm run contracts:deploy -- --network ' + result.network + '  Deploy again');
  console.log('');
}

main();
