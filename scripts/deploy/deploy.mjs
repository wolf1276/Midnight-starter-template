#!/usr/bin/env node
import { spawn, execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { select } from '@inquirer/prompts';
import { versions } from '../lib/versions.mjs';

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
let network = null;
const verbose = args.includes('--verbose') || args.includes('--debug');
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--network' && i + 1 < args.length) {
    network = args[i + 1];
    i++;
  } else if (args[i].startsWith('--network=')) {
    network = args[i].split('=')[1];
  }
}

if (network !== null && !['preview', 'preprod'].includes(network)) {
  fmt.fail(`Unsupported network '${network}'. Use 'preview' or 'preprod'.`);
  process.exit(1);
}

const networkConfigPath = resolve(rootDir, 'contracts', '.midnight', 'config.json');

function readLastNetwork() {
  if (!existsSync(networkConfigPath)) return null;
  try {
    const config = JSON.parse(readFileSync(networkConfigPath, 'utf-8'));
    return config.lastNetwork ?? null;
  } catch {
    return null;
  }
}

function writeLastNetwork(selected) {
  try {
    mkdirSync(dirname(networkConfigPath), { recursive: true });
    let config = {};
    if (existsSync(networkConfigPath)) {
      try {
        config = JSON.parse(readFileSync(networkConfigPath, 'utf-8'));
      } catch {
        config = {};
      }
    }
    config.lastNetwork = selected;
    writeFileSync(networkConfigPath, JSON.stringify(config, null, 2) + '\n');
  } catch {}
}

const NETWORK_CHOICES = [
  {
    value: 'preview',
    name: 'Preview',
    description: 'Public testing network\nRecommended for development\nFaucet available',
  },
  {
    value: 'preprod',
    name: 'Preprod',
    description: 'Pre-production network\nClosest to mainnet\nRecommended before production',
  },
];

async function selectNetwork() {
  const lastNetwork = readLastNetwork();
  const choices = NETWORK_CHOICES.map((choice) => ({
    value: choice.value,
    name: choice.value === lastNetwork ? `${choice.name} ${fmt.yellow('⭐ Last Used')}` : choice.name,
    description: choice.description,
  }));

  let selected;
  try {
    selected = await select({
      message: `${fmt.cyan('🌐 Select Deployment Network')}`,
      choices,
      default: lastNetwork ?? undefined,
    });
  } catch {
    console.log('\nDeployment cancelled.');
    process.exit(0);
  }

  console.log(`${fmt.green('✓')} Selected: ${NETWORK_CHOICES.find((c) => c.value === selected).name}`);
  writeLastNetwork(selected);
  return selected;
}

let deployStart = Date.now();

// Must run before any interactive prompt: if we re-exec under a different Node binary,
// the prompt would otherwise run twice (once now, once again in the re-executed process).
function ensureRequiredNodeVersion() {
  const requiredNodeMajor = 24;
  const nodeVersion = process.version.slice(1);
  const [nodeMajor] = nodeVersion.split('.').map(Number);
  if (nodeMajor >= requiredNodeMajor) {
    fmt.ok(`Node.js ${nodeVersion}`);
    return;
  }
  const nvmDir = process.env.NVM_DIR || `${process.env.HOME}/.nvm`;
  const nvmSh = `${nvmDir}/nvm.sh`;
  if (existsSync(nvmSh)) {
    try {
      const nvmNodePath = execSync(`. ${nvmSh} && nvm which ${requiredNodeMajor}`, { encoding: 'utf-8', shell: true }).trim();
      if (nvmNodePath && existsSync(nvmNodePath)) {
        console.log(`Node.js ${nodeVersion} is too old. Re-executing with ${nvmNodePath}...`);
        const child = spawn(nvmNodePath, process.argv.slice(1), { stdio: 'inherit', cwd: process.cwd(), shell: true });
        child.on('exit', (code) => process.exit(code ?? 1));
        // The re-executed process takes over from here; this one must not continue on
        // to the interactive prompt or anything else.
        return new Promise(() => {});
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

async function main() {
  await ensureRequiredNodeVersion();

  if (network === null) {
    network = await selectNetwork();
  }

  deployStart = Date.now();

  fmt.section(`\u{1F680} Midnight Contract Deployment`);
  fmt.info(`Network: ${network}`);

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

  const proofServerImage = versions.proofServerImage;
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

  const resultDir = mkdtempSync(join(tmpdir(), 'bboard-deploy-'));
  const resultFile = join(resultDir, 'result.json');

  const cliArgs = [
    '--experimental-specifier-resolution=node',
    '--loader', 'ts-node/esm',
    'src/launcher/deploy.ts',
    network,
  ];
  if (verbose) cliArgs.push('--verbose');

  // Preprod's indexer has a much longer transaction history than preview's, and wallet
  // sync currently has to walk all of it before it can report a synced state — so preprod
  // runs need a bigger heap than preview to get through sync without hitting the OOM
  // detection below.
  const heapSizeMb = network === 'preprod' ? 8192 : 4096;

  let stderrOutput = '';
  const child = spawn('node', cliArgs, {
    cwd: resolve(rootDir, 'cli'),
    stdio: ['inherit', 'inherit', 'pipe'],
    env: {
      ...process.env,
      TS_NODE_PROJECT: resolve(rootDir, 'cli', 'tsconfig.json'),
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --max-old-space-size=${heapSizeMb}`.trim(),
      // Hide ExperimentalWarning/DeprecationWarning noise (ts-node loader, Node internals)
      // by default; --verbose re-enables the full raw output for troubleshooting.
      ...(verbose ? {} : { NODE_NO_WARNINGS: '1' }),
      // deploy.ts writes its machine-readable result here instead of stdout, so parsing
      // doesn't depend on scraping a magic line out of otherwise free-form CLI output.
      DEPLOYMENT_RESULT_FILE: resultFile,
    },
  });

  // Buffered rather than echoed live, even with --verbose: an out-of-memory crash needs to
  // be inspected (see isOutOfMemoryCrash below) before deciding whether to show it at all.
  child.stderr.on('data', (chunk) => {
    stderrOutput += chunk.toString();
  });

  const isOutOfMemoryCrash = (output) =>
    /FATAL ERROR/.test(output) && /JavaScript heap out of memory|Reached heap limit/.test(output);

  function printOutOfMemoryPanel() {
    fmt.section('\u{1F4A5} Wallet Sync Ran Out of Memory');
    fmt.fail(`Node ran out of memory (${heapSizeMb}MB heap) while syncing the ${network} wallet.`);
    fmt.info('');
    fmt.info(
      network === 'preprod'
        ? "Preprod has a long transaction history, and wallet sync currently has to walk all of it before it's considered synced — this can require several GB of memory."
        : 'Wallet sync needed more memory than was available.',
    );
    fmt.info('');
    fmt.info('You can:');
    fmt.info('  • Re-run the command — sync progress is not preserved across crashes, but transient memory pressure may not recur');
    fmt.info('  • Close other memory-heavy applications and retry');
    fmt.info(`  • Raise the heap limit further: NODE_OPTIONS=--max-old-space-size=${heapSizeMb * 2} npm run deploy -- --network ${network}`);
    fmt.info('  • Re-run with --verbose to see full sync diagnostics leading up to the crash');
    fmt.info('');
  }

  child.on('exit', (code) => {
    if (code === 0 && existsSync(resultFile)) {
      try {
        const result = JSON.parse(readFileSync(resultFile, 'utf-8'));
        printFinalSummary(result);
      } catch (e) {
        fmt.warn(`Could not parse deployment result: ${e.message}`);
      }
    } else if (code !== 0) {
      if (isOutOfMemoryCrash(stderrOutput)) {
        printOutOfMemoryPanel();
        if (verbose) {
          console.error('');
          console.error(fmt.dim('Raw crash output:'));
          console.error(stderrOutput);
        }
      } else {
        process.stderr.write(stderrOutput);
        if (!verbose && stderrOutput.trim()) {
          console.error('');
          fmt.fail('Deployment failed.');
          fmt.info('Re-run with --verbose for full diagnostic output:');
          fmt.cmd(`npm run deploy -- --network ${network} --verbose`);
          console.error('');
        }
      }
    }
    rmSync(resultDir, { recursive: true, force: true });
    process.exit(code ?? 1);
  });
}

function printFinalSummary(result) {
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

  let envUpdated = false;
  const envLocalPath = resolve(rootDir, 'web', '.env.local');
  if (existsSync(envLocalPath)) {
    let env = readFileSync(envLocalPath, 'utf-8');
    const line = `NEXT_PUBLIC_CONTRACT_ADDRESS=${result.contractAddress}`;
    env = /^NEXT_PUBLIC_CONTRACT_ADDRESS=.*$/m.test(env)
      ? env.replace(/^NEXT_PUBLIC_CONTRACT_ADDRESS=.*$/m, line)
      : `${env.trimEnd()}\n\n# Set automatically by npm run contracts:deploy\n${line}\n`;
    writeFileSync(envLocalPath, env);
    envUpdated = true;
  }

  const ms = Date.now() - deployStart;
  const elapsed = ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;

  fmt.section(`\u2705 Deployment Complete`);
  console.log(`  ${fmt.dim('Network:')}            ${result.network}`);
  console.log(`  ${fmt.dim('Contract Address:')}   ${result.contractAddress}`);
  if (result.explorerUrl) {
    console.log(`  ${fmt.dim('Explorer URL:')}       ${result.explorerUrl}`);
  }
  console.log(`  ${fmt.dim('Indexer URL:')}        ${result.indexer}`);
  console.log(`  ${fmt.dim('Deployment Record:')}  ${resolve(rootDir, 'deployment.json')}`);
  console.log(
    `  ${fmt.dim('web/.env.local:')}     ${envUpdated ? `${fmt.green('updated')} with NEXT_PUBLIC_CONTRACT_ADDRESS` : 'not found, skipped'}`,
  );
  console.log(`  ${fmt.dim('Total Time:')}         ${elapsed}`);
  console.log('');
  fmt.info('Next steps:');
  fmt.cmd('npm run dev                         Start the frontend');
  fmt.cmd('npm run contracts:deploy -- --network ' + result.network + '  Deploy again');
  console.log('');
}

main();
