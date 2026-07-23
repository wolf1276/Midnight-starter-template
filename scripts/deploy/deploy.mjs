#!/usr/bin/env node
import { spawn, execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..', '..');

const args = process.argv.slice(2);
let network = 'preview';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--network' && i + 1 < args.length) {
    network = args[i + 1];
    i++;
  } else if (args[i].startsWith('--network=')) {
    network = args[i].split('=')[1];
  }
}

if (!['preview', 'preprod'].includes(network)) {
  console.error(`Error: Unsupported network '${network}'. Use 'preview' or 'preprod'.`);
  process.exit(1);
}

async function main() {
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
    console.error(`Error: Node.js >= ${requiredNodeMajor}.x required (current: ${nodeVersion}).`);
    console.error(`Run: nvm install ${requiredNodeMajor} && nvm use ${requiredNodeMajor}`);
    console.error(`Or install from https://nodejs.org/`);
    process.exit(1);
  }
  console.log(`✓ Node.js ${nodeVersion}`);

  const rootNodeModules = resolve(rootDir, 'node_modules');
  if (!existsSync(rootNodeModules)) {
    console.error("✗ Dependencies not installed. Run 'npm install' (from contracts/ or the repo root), then retry.");
    process.exit(1);
  }
  console.log('✓ Dependencies installed');

  try {
    execSync('docker info > /dev/null 2>&1', { shell: true });
    console.log('✓ Docker is running');
  } catch {
    console.error('✗ Docker is not running. Install Docker Desktop (or start the Docker daemon) and start it, then retry.');
    process.exit(1);
  }

  try {
    execSync('compact --version > /dev/null 2>&1', { shell: true });
    console.log('✓ Compact compiler found');
  } catch {
    console.error('✗ Compact compiler not found. Install the Midnight Compact toolchain: https://docs.midnight.network/relnotes/compact-toolchain');
    process.exit(1);
  }

  try {
    const out = execSync('compact list', { encoding: 'utf-8', shell: true });
    const active = out.split('\n').find((l) => l.includes('→') || l.includes('*'));
    if (!active) throw new Error('no active toolchain');
    console.log(`✓ Compact toolchain active — ${active.trim()}`);
  } catch {
    console.error("✗ No active Compact toolchain. Run 'compact update' to install one, then retry.");
    process.exit(1);
  }

  const cliPackageDir = resolve(rootDir, 'cli');
  if (!existsSync(resolve(cliPackageDir, 'package.json')) || !existsSync(resolve(cliPackageDir, 'node_modules'))) {
    console.error(
      "✗ Midnight CLI workspace (cli/) is missing or its dependencies aren't installed. Run 'npm install' from the repo root, then retry.",
    );
    process.exit(1);
  }
  console.log('✓ Midnight CLI workspace found');

  const proofServerImage = 'midnightntwrk/proof-server:8.0.3';
  try {
    execSync(`docker image inspect ${proofServerImage} > /dev/null 2>&1 || docker pull ${proofServerImage} > /dev/null 2>&1`, { shell: true });
    console.log(`✓ Proof Server image available (${proofServerImage})`);
  } catch {
    console.error(
      `✗ Could not find or pull the Proof Server image (${proofServerImage}). Check your Docker registry access/network connection, then retry. It will be started automatically as a container during deployment.`,
    );
    process.exit(1);
  }

  const managedDir = resolve(rootDir, 'contracts', 'src', 'managed', 'bboard', 'contract');
  if (!existsSync(managedDir)) {
    console.log('\nBuilding contract...');
    execSync('npm run build:contract', { cwd: rootDir, stdio: 'inherit', shell: true });
    console.log('✓ Contract built');
  } else {
    console.log('✓ Contract already compiled');
  }

  const cliDistDir = resolve(rootDir, 'cli', 'dist');
  const cliLauncherDir = resolve(rootDir, 'cli', 'dist', 'launcher');
  if (!existsSync(cliDistDir) || !existsSync(cliLauncherDir)) {
    console.log('\nBuilding CLI...');
    execSync('npm run build:cli', { cwd: rootDir, stdio: 'inherit', shell: true });
    console.log('✓ CLI built');
  } else {
    console.log('✓ CLI already built');
  }

  // Note: the proof server itself is started by RemoteTestEnvironment (testkit-js)
  // inside deploy.ts via scripts/docker/proof-server.yml — no need to start it here too.

  console.log(`\n━━━ Deploying to ${network} ━━━\n`);

  let output = '';
  const child = spawn(
    'node',
    [
      '--experimental-specifier-resolution=node',
      '--loader', 'ts-node/esm',
      'src/launcher/deploy.ts',
      network,
    ],
    {
      cwd: resolve(rootDir, 'cli'),
      stdio: ['inherit', 'pipe', 'inherit'],
      shell: true,
      env: {
        ...process.env,
        TS_NODE_PROJECT: resolve(rootDir, 'cli', 'tsconfig.json'),
        NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --max-old-space-size=4096`.trim(),
      },
    },
  );

  child.stdout.on('data', (chunk) => {
    process.stdout.write(chunk);
    output += chunk.toString();
  });

  child.on('exit', (code) => {
    if (code === 0) {
      const match = output.match(/^DEPLOYMENT_RESULT (.+)$/m);
      if (match) {
        try {
          const result = JSON.parse(match[1]);
          saveDeploymentArtifacts(result);
        } catch (e) {
          console.warn(`\n⚠ Could not parse deployment result: ${e.message}`);
        }
      }
      console.log('\n✓ Deployment complete');
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
  console.log(`✓ Saved deployment record to deployment.json`);

  const envLocalPath = resolve(rootDir, 'web', '.env.local');
  if (existsSync(envLocalPath)) {
    let env = readFileSync(envLocalPath, 'utf-8');
    const line = `NEXT_PUBLIC_CONTRACT_ADDRESS=${result.contractAddress}`;
    env = /^NEXT_PUBLIC_CONTRACT_ADDRESS=.*$/m.test(env)
      ? env.replace(/^NEXT_PUBLIC_CONTRACT_ADDRESS=.*$/m, line)
      : `${env.trimEnd()}\n\n# Set automatically by npm run contracts:deploy\n${line}\n`;
    writeFileSync(envLocalPath, env);
    console.log('✓ Updated web/.env.local with NEXT_PUBLIC_CONTRACT_ADDRESS');
  }

  console.log(`\nNetwork:  ${result.network}`);
  console.log(`Contract: ${result.contractAddress}`);
  console.log(`Indexer:  ${result.indexer}  (query this to inspect on-chain contract state)`);
}

main();
