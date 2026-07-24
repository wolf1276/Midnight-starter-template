#!/usr/bin/env node
import { spawn, execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir, freemem, totalmem } from 'node:os';
import { select } from '@inquirer/prompts';
import { versions } from '../lib/versions.mjs';
import { ensureDockerRunning, ensureLocalMidnightServices } from '../lib/infra.mjs';
import { color } from '../lib/ui.mjs';
import { FilesystemError, NodeVersionError, classifyError, printCliError } from '../lib/errors.mjs';
import { checks as preflightChecks } from '../lib/preflight.mjs';
import { printDeploymentComplete } from '../lib/success.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..', '..', '..');

// --- Terminal formatting helpers, backed by scripts/lib/ui.mjs (same visual language as
// setup.sh/doctor.mjs/cli/src/ui.ts \u2014 no local reimplementation). ---
const RULE = color.dim('\u2501'.repeat(36));

const fmt = {
  ok: (msg) => console.log(`  ${color.green('\u2713')} ${msg}`),
  fail: (msg) => console.error(`  ${color.red('\u2717')} ${msg}`),
  warn: (msg) => console.log(`  ${color.yellow('\u26A0')} ${msg}`),
  section: (title) => {
    console.log(`\n${RULE}`);
    console.log(`  ${color.bold(title)}`);
    console.log(`${RULE}`);
  },
  info: (msg) => console.log(`  ${color.dim(msg)}`),
  cmd: (msg) => console.log(`    ${color.cyan(msg)}`),
  dim: color.dim,
  bold: color.bold,
  green: color.green,
  red: color.red,
  yellow: color.yellow,
  cyan: color.cyan,
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

if (network !== null && !['local', 'preview', 'preprod'].includes(network)) {
  fmt.fail(`Unsupported network '${network}'. Use 'local', 'preview' or 'preprod'.`);
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
    value: 'local',
    name: `Local ${fmt.yellow('⭐ Recommended')}`,
    description: 'Local Midnight node running via Docker\nNo faucet or internet required after images are pulled\nRecommended for onboarding',
  },
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
      default: lastNetwork ?? 'local',
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
  const requiredNodeMajor = versions.requiredNodeMajor;
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
  printCliError(
    new NodeVersionError({
      title: 'Unsupported Node.js Version',
      whatHappened: `Required:\nNode.js >=${requiredNodeMajor}\n\nDetected:\nNode.js ${nodeVersion}`,
      howToFix: `nvm install ${requiredNodeMajor}\nnvm use ${requiredNodeMajor}\n\nor download from https://nodejs.org/`,
    }),
    verbose,
  );
  process.exit(1);
}

async function main() {
  fmt.section(`\u{1F9F0} Preparing Local Environment`);

  await ensureRequiredNodeVersion();

  const rootNodeModules = resolve(rootDir, 'node_modules');
  if (!existsSync(rootNodeModules)) {
    printCliError(
      new FilesystemError({
        title: 'Dependencies Not Installed',
        whatHappened: 'node_modules is missing at the repository root.',
        howToFix: 'Run:\n\n  npm install',
      }),
      verbose,
    );
    process.exit(1);
  }
  fmt.ok('Dependencies installed');

  if (network === null) {
    network = await selectNetwork();
  }

  deployStart = Date.now();

  await ensureDockerRunning(fmt);
  await ensureLocalMidnightServices(rootDir, fmt, verbose);

  fmt.section(`\u{1F680} Midnight Contract Deployment`);
  fmt.info(`Network: ${network}`);

  try {
    preflightChecks.compactCli();
    fmt.ok('Compact compiler found');
  } catch (e) {
    printCliError(e, verbose);
    process.exit(1);
  }

  try {
    fmt.ok(`Compact toolchain active — ${preflightChecks.compactCompiler()}`);
  } catch (e) {
    printCliError(e, verbose);
    process.exit(1);
  }

  const cliPackageDir = resolve(rootDir, 'cli');
  if (!existsSync(resolve(cliPackageDir, 'package.json')) || !existsSync(resolve(cliPackageDir, 'node_modules'))) {
    printCliError(
      new FilesystemError({
        title: 'CLI Workspace Not Ready',
        whatHappened: 'cli/ is missing or its dependencies are not installed.',
        howToFix: 'Run from repo root:\n\n  npm install',
      }),
      verbose,
    );
    process.exit(1);
  }
  fmt.ok('CLI workspace ready');

  const proofServerImage = versions.proofServerImage;
  try {
    execSync(`docker image inspect ${proofServerImage} > /dev/null 2>&1 || docker pull ${proofServerImage} > /dev/null 2>&1`, { shell: true });
    fmt.ok('Proof Server image available');
  } catch (e) {
    const err = classifyError(new Error(e.stderr?.toString?.() || `Could not find or pull ${proofServerImage}`), 'npm run deploy');
    printCliError(err, verbose);
    process.exit(err.exitCode);
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
  // inside deploy.ts via cli/proof-server.yml — no need to start it here too.

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
  // detection below. Rather than cap the child at a fixed number, size it off whatever
  // memory the machine actually has free right now (leaving headroom for the rest of the
  // system), floored at the old fixed minimums so small/busy machines don't regress.
  const minHeapMb = network === 'preprod' ? 8192 : network === 'preview' ? 4096 : 2048;
  const freeMb = freemem() / 1024 / 1024;
  const totalMb = totalmem() / 1024 / 1024;
  const heapSizeMb = Math.round(Math.min(Math.max(freeMb * 0.75, minHeapMb), totalMb * 0.85));

  let stderrOutput = '';
  const child = spawn(process.execPath, cliArgs, {
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
    fmt.fail(`Node ran out of memory (${heapSizeMb}MB heap, sized from ~${Math.round(freeMb)}MB free of ${Math.round(totalMb)}MB total) while syncing the ${network} wallet.`);
    fmt.info('');
    fmt.info(
      network === 'preprod'
        ? "Preprod has a long transaction history, and wallet sync currently has to walk all of it before it's considered synced — this can require several GB of memory."
        : 'Wallet sync needed more memory than was available.',
    );
    fmt.info('');
    fmt.info('The heap above was already sized from most of this machine\'s free memory, so:');
    fmt.info('  • Re-run the command — sync progress is not preserved across crashes, but transient memory pressure may not recur');
    fmt.info('  • Close other memory-heavy applications and retry (frees up more for the next sync attempt)');
    fmt.info(`  • Force a specific heap size: NODE_OPTIONS=--max-old-space-size=<MB> npm run deploy -- --network ${network}`);
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
        const err = classifyError(
          new Error(stderrOutput.trim() || `Deployment failed (exit code ${code})`),
          `npm run deploy -- --network ${network}`,
        );
        printCliError(err, verbose);
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

  printDeploymentComplete({
    address: result.contractAddress,
    explorerUrl: result.explorerUrl,
    wallet: 'see "Wallet Address" above',
    network: result.network,
    frontendUpdated: envUpdated,
    nextCommand: `npm run dev\nnpm run contracts:deploy -- --network ${result.network}  # deploy again`,
  });
}

main();
