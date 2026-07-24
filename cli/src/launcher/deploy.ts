import { appendFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createLogger } from '../logger-utils.js';
import { type Config, PreviewRemoteConfig, PreprodRemoteConfig } from '../config.js';
import {
  type EnvironmentConfiguration,
  type TestEnvironment,
  logger as sdkInternalLogger,
} from '@midnight-ntwrk/testkit-js';
import { type WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { MidnightWalletProvider } from '../midnight-wallet-provider.js';
import { FundingTimeoutError, getUnshieldedAddress, syncWallet, waitForUnshieldedFunds } from '../wallet-utils.js';
import { generateDust } from '../generate-dust.js';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { BBoardAPI, type BBoardProviders, type PrivateStateId } from '../../../api/src/index.js';
import { toHex, assertIsContractAddress } from '@midnight-ntwrk/midnight-js-utils';
import { unshieldedToken } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { randomBytes } from '../../../api/src/utils/index.js';
import { BBoardPrivateState } from '../../../contracts/src/witnesses.js';
import * as ui from '../ui.js';
import { color, withQuiet } from '../ui.js';
import {
  type DeploymentNetwork,
  loadDeploymentWalletSeed,
  saveDeploymentWalletSeed,
  walletFileDisplayPath,
} from '../wallet-store.js';
import { WalletError, DeploymentError, runMain } from '../errors.js';
import { buildExplorerUrl } from '../explorer.js';

globalThis.WebSocket = WebSocket as unknown as typeof globalThis.WebSocket;

const rawArgs = process.argv.slice(2);
const verbose = rawArgs.includes('--verbose') || rawArgs.includes('--debug');
const network = rawArgs.find((a) => !a.startsWith('--')) ?? 'preview';
const networkLabel = network === 'preprod' ? 'Preprod' : 'Preview';

// The SDK ships its own module-level pino-pretty logger that writes straight to the
// process's stdout file descriptor (bypassing process.stdout.write, so withQuiet() below
// can't intercept it). Silencing it here is the only way to keep its internal chatter
// ("Initializing wallet builder...", "Creating dust wallet...") out of default-mode output.
if (!verbose) sdkInternalLogger.level = 'silent';

const config: Config = network === 'preprod' ? new PreprodRemoteConfig() : new PreviewRemoteConfig();
const logger = await createLogger(config.logDir, !verbose);
const testEnv: TestEnvironment = config.getEnvironment(logger);

// Everything the underlying SDKs write directly to the terminal (docker/testcontainers
// output, GraphQL/RPC client chatter, wallet internals, etc.) is redirected here instead
// of the real terminal, unless --verbose is passed. The full detail always still lands
// in the per-run log file at config.logDir, plus this raw sink for anything that bypasses
// the pino logger entirely.
const rawLogPath = `${config.logDir}.raw.log`;
const quiet = <T>(fn: () => Promise<T>): Promise<T> =>
  withQuiet(!verbose, (chunk) => appendFileSync(rawLogPath, chunk), fn);

/** A fresh, per-run password for the local private-state store — never persisted or reused. */
const generateStoragePassword = (): string => `${toHex(randomBytes(24))}-${Date.now()}`;

const FUNDING_TIMEOUT_MS = 15 * 60 * 1000;
const BALANCE_POLL_INTERVAL_MS = 5_000;

interface FaucetOutage {
  reason: string;
}

// Reason codes the faucet's health endpoint reports, translated into plain language.
const FAUCET_OUTAGE_REASONS: Record<string, string> = {
  WALLET_BALANCE_LOW: 'The faucet wallet has run out of test tokens to distribute.',
};

const getAxiosRequestUrl = (e: unknown): string | undefined => {
  const url = (e as { config?: { url?: unknown } } | undefined)?.config?.url;
  return typeof url === 'string' ? url : undefined;
};

const describeFaucetOutage = (e: unknown): FaucetOutage => {
  const data = (e as { response?: { data?: unknown } } | undefined)?.response?.data;
  const code = data && typeof data === 'object' && 'reason' in data ? String(data.reason) : undefined;
  return { reason: (code && FAUCET_OUTAGE_REASONS[code]) ?? 'The public faucet is not currently serving requests.' };
};

/** True if `e` is an axios error whose request targeted the faucet host. */
const isFaucetRequestError = (e: unknown, faucetUrl: string | undefined): boolean => {
  if (!faucetUrl) return false;
  const requestUrl = getAxiosRequestUrl(e);
  if (!requestUrl) return false;
  try {
    return new URL(requestUrl).host === new URL(faucetUrl).host;
  } catch {
    return false;
  }
};

/**
 * Starts the test environment, tolerating a faucet outage. Node, indexer and the proof
 * server always have to be healthy to proceed — but a faucet that's down (e.g. depleted)
 * shouldn't block deployment. The user can still fund the wallet manually and we keep
 * polling for it, so treat that one dependency as best-effort.
 */
async function startEnvironment(): Promise<{ config: EnvironmentConfiguration; faucetOutage?: FaucetOutage }> {
  try {
    const envConfiguration = await quiet(() => testEnv.start());
    return { config: envConfiguration };
  } catch (e) {
    // testEnv.start() only reaches the faucet health check after node, indexer and the
    // proof server have already passed theirs, so the configuration is safe to reuse.
    let recoveredConfig: EnvironmentConfiguration | undefined;
    try {
      recoveredConfig = testEnv.getEnvironmentConfiguration();
    } catch {
      // Proof server never came up — this wasn't a faucet-only failure.
    }
    if (recoveredConfig && isFaucetRequestError(e, recoveredConfig.faucet)) {
      return { config: recoveredConfig, faucetOutage: describeFaucetOutage(e) };
    }
    throw e;
  }
}

function printFaucetOutagePanel(outage: FaucetOutage, address: string, faucetUrl: string | undefined): void {
  ui.section(`⚠ ${networkLabel} Faucet Unavailable`);
  ui.info(`The official Midnight ${networkLabel} faucet is currently unable to send test tokens.`);
  ui.info('');
  ui.info(`${color.dim('Reason:')} ${outage.reason}`);
  ui.info('');
  ui.info('This is a temporary issue with the public faucet, not your project:');
  ui.success('Docker is healthy');
  ui.success('Proof Server is healthy');
  ui.success('Node connection is healthy');
  ui.success('Indexer is healthy');
  ui.info('');
  ui.info('You can:');
  ui.info('  • Wait until the faucet is refilled');
  ui.info('  • Fund this wallet manually from another source');
  ui.info('');
  ui.summary([
    ['Wallet Address', address],
    ...(faucetUrl ? ([[`${networkLabel} Faucet`, faucetUrl]] as Array<[string, string]>) : []),
  ]);
  ui.info('');
  ui.info('Deployment will continue automatically once funds arrive.');
  ui.info('');
}

async function runFundingScreen(
  walletFacade: WalletFacade,
  envConfiguration: EnvironmentConfiguration,
  address: string,
  knownFaucetOutage: FaucetOutage | undefined,
): Promise<Awaited<ReturnType<typeof waitForUnshieldedFunds>>> {
  ui.section('💰 Wallet Needs Funding');
  ui.info("This wallet doesn't have enough test tokens to deploy.");
  ui.info('');
  ui.summary([
    ['Wallet Address', address],
    ...(envConfiguration.faucet
      ? ([[`${networkLabel} Faucet`, envConfiguration.faucet]] as Array<[string, string]>)
      : []),
  ]);
  ui.info('');
  ui.info('Copy the address above into the faucet. Once funds arrive, deployment will');
  ui.info('automatically continue — no need to rerun this command.');
  ui.info('');

  let outageShown = false;
  if (knownFaucetOutage) {
    printFaucetOutagePanel(knownFaucetOutage, address, envConfiguration.faucet);
    outageShown = true;
  }

  ui.info('⏳ Waiting for funds...');
  ui.info(`${color.dim('Checking every')} ${BALANCE_POLL_INTERVAL_MS / 1000}s`);
  let lastBalance = 0n;
  try {
    const unshieldedState = await quiet(() =>
      waitForUnshieldedFunds(
        logger,
        walletFacade,
        envConfiguration,
        unshieldedToken(),
        true,
        BALANCE_POLL_INTERVAL_MS,
        {
          timeoutMs: FUNDING_TIMEOUT_MS,
          onBalance: (balance) => {
            if (balance === lastBalance) return;
            lastBalance = balance;
            ui.liveLine(`${color.dim('Current Balance:')} ${balance} tNIGHT`);
          },
          onFaucetError: (e) => {
            if (outageShown) return;
            printFaucetOutagePanel(describeFaucetOutage(e), address, envConfiguration.faucet);
            outageShown = true;
          },
        },
      ),
    );
    ui.endLiveLine();
    const balance = unshieldedState.balances[unshieldedToken().raw] ?? 0n;
    ui.success(`Funds received. Balance: ${balance} tNIGHT`);
    return unshieldedState;
  } catch (e) {
    ui.endLiveLine();
    if (e instanceof FundingTimeoutError) {
      throw new WalletError({
        title: 'Wallet Funding Timed Out',
        whatHappened: `No test tokens arrived at ${address} within ${FUNDING_TIMEOUT_MS / 60_000} minutes.`,
        howToFix: `Open ${envConfiguration.faucet ?? 'the network faucet'}, request tokens for the address above, confirm they arrived, then retry:\n\n  npm run deploy -- --network ${network}`,
      });
    }
    throw e;
  }
}

async function main() {
  ui.section('🚀 Midnight Contract Deployment');
  ui.info(`${color.dim('Network:')} ${network}`);

  const envStep = ui.step('Starting environment');
  const { config: envConfiguration, faucetOutage: startupFaucetOutage } = await startEnvironment();
  if (startupFaucetOutage) {
    envStep.warn('Environment ready (faucet unavailable)');
  } else {
    envStep.succeed('Environment ready');
  }

  const deploymentNetwork = network as DeploymentNetwork;
  const existingSeed = loadDeploymentWalletSeed(deploymentNetwork);
  const isNewWallet = existingSeed === undefined;

  const walletStep = ui.step(isNewWallet ? '🔐 Creating Deployment Wallet' : '🔐 Loading Deployment Wallet');
  const seed = existingSeed ?? toHex(randomBytes(32));
  const walletProvider = await quiet(() => MidnightWalletProvider.build(logger, envConfiguration, seed));
  const walletFacade: WalletFacade = walletProvider.wallet;
  await quiet(() => walletProvider.start());

  if (isNewWallet) {
    const savedPath = saveDeploymentWalletSeed(deploymentNetwork, seed);
    walletStep.succeed('Wallet created');
    ui.success(`Saved to ${path.relative(process.cwd(), savedPath) || walletFileDisplayPath(deploymentNetwork)}`);
  } else {
    walletStep.succeed('Existing wallet loaded');
  }

  // Wait for full sync before reading the balance — otherwise an already-funded wallet
  // briefly reports a stale 0 balance and the funding screen flashes for no reason.
  const syncStep = ui.step('🔄 Synchronizing wallet');
  const syncedState = await quiet(() => syncWallet(logger, walletFacade));
  syncStep.succeed('Wallet synchronized');

  const walletAddress = await getUnshieldedAddress(logger, walletFacade);
  let unshieldedState = syncedState.unshielded;
  let nightBalance = unshieldedState.balances[unshieldedToken().raw] ?? 0n;

  if (nightBalance > 0n) {
    const fundingStep = ui.step('💰 Checking wallet balance');
    fundingStep.succeed('Wallet already funded');
    ui.section('💰 Deployment Wallet');
    ui.summary([
      ['Network', networkLabel],
      ['Wallet Address', walletAddress],
      ['Balance', `${nightBalance} tNIGHT`],
    ]);
    ui.info('Continuing deployment...');
  } else {
    ui.section('💰 Deployment Wallet');
    ui.summary([
      ['Network', networkLabel],
      ['Wallet Address', walletAddress],
      ['Current Balance', `${nightBalance} tNIGHT`],
    ]);
    unshieldedState = await runFundingScreen(walletFacade, envConfiguration, walletAddress, startupFaucetOutage);
    nightBalance = unshieldedState.balances[unshieldedToken().raw] ?? 0n;
    ui.section('🚀 Continuing Deployment');
  }

  if (config.generateDust) {
    const dustStep = ui.step('Registering for DUST generation');
    const dustTx = await quiet(() => generateDust(logger, seed, unshieldedState, walletFacade));
    if (dustTx) {
      await quiet(() => syncWallet(logger, walletFacade));
      dustStep.succeed('DUST generation registered');
    } else {
      dustStep.succeed('DUST already registered');
    }
  }

  ui.section('📦 Deploying Contract');

  const zkConfigProvider = new NodeZkConfigProvider<'post' | 'takeDown'>(config.zkConfigPath);
  // Generated once per run and only ever kept in memory — this store is scratch space for a
  // single deployment, never reopened across processes, so there's nothing to persist.
  const storagePassword = generateStoragePassword();
  const providers: BBoardProviders = {
    privateStateProvider: levelPrivateStateProvider<PrivateStateId, BBoardPrivateState>({
      privateStateStoreName: config.privateStateStoreName,
      signingKeyStoreName: `${config.privateStateStoreName}-signing-keys`,
      privateStoragePasswordProvider: () => storagePassword,
      accountId: seed,
    }),
    publicDataProvider: indexerPublicDataProvider(envConfiguration.indexer, envConfiguration.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(envConfiguration.proofServer, zkConfigProvider),
    walletProvider,
    midnightProvider: walletProvider,
  };

  const deployStep = ui.step('Deploying contract');
  const api = await quiet(() => BBoardAPI.deploy(providers, logger));
  const address = api.deployedContractAddress;
  assertIsContractAddress(address);
  deployStep.succeed('Contract deployed');

  const verifyStep = ui.step('Verifying deployment');
  const deployedState = await quiet(() => providers.publicDataProvider.queryContractState(address));
  if (!deployedState) {
    verifyStep.fail('Deployment could not be verified');
    throw new DeploymentError({
      title: 'Contract Deployed But Not Yet Queryable',
      whatHappened: `The transaction submitted successfully, but querying ${address} on the indexer returned no state.`,
      howToFix: `The indexer may still be catching up. Wait a few seconds and check the address on the explorer, or re-run:\n\n  npm run deploy -- --network ${network}`,
    });
  }
  verifyStep.succeed('Deployment verified — contract is live and queryable');

  const explorerUrl = buildExplorerUrl(config.explorerUrl, address);

  logger.info(`Deployed contract at address: ${address}`);
  // Machine-readable result consumed by infra/scripts/deploy/deploy.mjs to write deployment.json
  // and update web/.env.local. Written to a file (path passed via env var) rather than
  // printed to stdout, so parsing doesn't depend on scraping a magic line out of otherwise
  // free-form CLI output.
  const resultFile = process.env.DEPLOYMENT_RESULT_FILE;
  if (resultFile) {
    writeFileSync(
      resultFile,
      JSON.stringify({
        network,
        contractAddress: address,
        indexer: envConfiguration.indexer,
        node: envConfiguration.node,
        deployedAt: new Date().toISOString(),
        ...(config.explorerUrl ? { explorerUrl } : {}),
      }),
    );
  }

  await quiet(() => walletProvider.stop());
  await quiet(() => testEnv.shutdown());

  // The single, polished success screen is printed by infra/scripts/deploy/deploy.mjs once this
  // process exits — it also owns writing deployment.json and updating web/.env.local, so
  // all of that belongs in one final summary instead of being split across two processes.
  process.exit(0);
}

const retryCommand = `npm run deploy -- --network ${network}`;

await runMain(main, {
  verbose,
  retryCommand,
  onFatal: async (err) => {
    logger.error(err.stack ?? err.message);
    await testEnv.shutdown().catch(() => {});
  },
});
