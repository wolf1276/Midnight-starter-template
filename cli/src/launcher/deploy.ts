import { appendFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createLogger } from '../logger-utils.js';
import {
  type Config,
  PreviewRemoteConfig,
  PreprodRemoteConfig,
  StandaloneConfig,
  GENESIS_MINT_WALLET_SEED,
} from '../config.js';
import {
  type EnvironmentConfiguration,
  type TestEnvironment,
  logger as sdkInternalLogger,
} from '@midnight-ntwrk/testkit-js';
import { type WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { MidnightWalletProvider } from '../midnight-wallet-provider.js';
import {
  FundingTimeoutError,
  SyncTimeoutError,
  getUnshieldedAddress,
  syncWallet,
  waitForUnshieldedFunds,
} from '../wallet-utils.js';
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
import { buildExplorerUrl, buildWalletExplorerUrl } from '../explorer.js';

globalThis.WebSocket = WebSocket as unknown as typeof globalThis.WebSocket;

const rawArgs = process.argv.slice(2);
const verbose = rawArgs.includes('--verbose') || rawArgs.includes('--debug');
// Manual funding is the default (avoids hammering the public faucet, works during faucet
// outages/rate limits). --auto-fund restores the old automatic faucet-request behaviour.
// --no-wait prints wallet funding details and exits instead of polling.
const autoFund = rawArgs.includes('--auto-fund');
const noWait = rawArgs.includes('--no-wait');
const network = rawArgs.find((a) => !a.startsWith('--')) ?? 'preview';
const networkLabel = network === 'preprod' ? 'Preprod' : network === 'local' ? 'Local' : 'Preview';

// The SDK ships its own module-level pino-pretty logger that writes straight to the
// process's stdout file descriptor (bypassing process.stdout.write, so withQuiet() below
// can't intercept it). Silencing it here is the only way to keep its internal chatter
// ("Initializing wallet builder...", "Creating dust wallet...") out of default-mode output.
if (!verbose) sdkInternalLogger.level = 'silent';

const config: Config =
  network === 'preprod'
    ? new PreprodRemoteConfig()
    : network === 'local'
      ? new StandaloneConfig()
      : new PreviewRemoteConfig();
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

const DEFAULT_FUNDING_TIMEOUT_MS = 15 * 60 * 1000;

const parseFundingTimeoutMs = (): number => {
  const flagIndex = rawArgs.findIndex((a) => a === '--funding-timeout');
  const flagValue = flagIndex !== -1 ? rawArgs[flagIndex + 1] : undefined;
  const raw = flagValue ?? process.env.MIDNIGHT_FUNDING_TIMEOUT;
  if (!raw) return DEFAULT_FUNDING_TIMEOUT_MS;
  const minutes = Number(raw);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new WalletError({
      title: 'Invalid Funding Timeout',
      whatHappened: `"${raw}" is not a valid number of minutes.`,
      howToFix: 'Pass a positive number of minutes, e.g. --funding-timeout 20 or MIDNIGHT_FUNDING_TIMEOUT=20.',
    });
  }
  return minutes * 60 * 1000;
};

const FUNDING_TIMEOUT_MS = parseFundingTimeoutMs();
const BALANCE_POLL_INTERVAL_MS = 5_000;

type FaucetOutageKind = 'rate-limited' | 'depleted' | 'unavailable';

interface FaucetOutage {
  kind: FaucetOutageKind;
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
  const status = (e as { response?: { status?: unknown } } | undefined)?.response?.status;
  const data = (e as { response?: { data?: unknown } } | undefined)?.response?.data;
  const code = data && typeof data === 'object' && 'reason' in data ? String(data.reason) : undefined;

  if (status === 429) {
    return { kind: 'rate-limited', reason: 'Too many funding requests were made in a short window.' };
  }
  if (code && FAUCET_OUTAGE_REASONS[code]) {
    return { kind: 'depleted', reason: FAUCET_OUTAGE_REASONS[code] };
  }
  return { kind: 'unavailable', reason: 'The public faucet is not currently serving requests.' };
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

const FAUCET_OUTAGE_TITLES: Record<FaucetOutageKind, string> = {
  'rate-limited': 'Rate Limited',
  depleted: 'Depleted',
  unavailable: 'Unavailable',
};

function printFaucetOutagePanel(outage: FaucetOutage, address: string, faucetUrl: string | undefined): void {
  ui.section(`⚠ ${networkLabel} Faucet ${FAUCET_OUTAGE_TITLES[outage.kind]}`);
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
  ui.info(`  • ${outage.kind === 'rate-limited' ? 'Wait a minute or two, then retry' : 'Wait until the faucet is refilled'}`);
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

/** Prints the wallet's funding requirements: address, network, balance, faucet and explorer URLs. */
function printFundingInfo(address: string, nightBalance: bigint, envConfiguration: EnvironmentConfiguration): void {
  ui.section('💰 Wallet Needs Funding');
  ui.info("This wallet doesn't have enough test tokens to deploy.");
  ui.info('');
  ui.summary([
    ['Wallet Address', address],
    ['Network', networkLabel],
    ['Current Balance', `${nightBalance} tNIGHT`],
    ['Required Balance', '> 0 tNIGHT'],
    ...(envConfiguration.faucet
      ? ([[`${networkLabel} Faucet`, envConfiguration.faucet]] as Array<[string, string]>)
      : []),
    ...(config.explorerUrl
      ? ([[`${networkLabel} Explorer`, buildWalletExplorerUrl(config.explorerUrl, address)]] as Array<
          [string, string]
        >)
      : []),
  ]);
  ui.info('');
}

async function runFundingScreen(
  status: ui.StatusLine,
  walletFacade: WalletFacade,
  envConfiguration: EnvironmentConfiguration,
  address: string,
  knownFaucetOutage: FaucetOutage | undefined,
): Promise<Awaited<ReturnType<typeof waitForUnshieldedFunds>>> {
  ui.info(
    autoFund
      ? 'Copy the address above into the faucet. Once funds arrive, deployment will'
      : 'Fund this wallet manually (e.g. from the faucet above). Once funds arrive, deployment will',
  );
  ui.info('automatically continue — no need to rerun this command.');
  ui.info(`${color.dim(`Funding timeout: ${FUNDING_TIMEOUT_MS / 60_000} min (--funding-timeout / MIDNIGHT_FUNDING_TIMEOUT)`)}`);
  ui.info(`${color.dim(`Polling balance every ${BALANCE_POLL_INTERVAL_MS / 1000}s.`)}${autoFund ? '' : ' Not requesting from the faucet automatically — pass --auto-fund to restore that.'}`);
  ui.info('');

  let outageShown = false;
  if (knownFaucetOutage) {
    printFaucetOutagePanel(knownFaucetOutage, address, envConfiguration.faucet);
    outageShown = true;
  }

  status.setStage('Funding Wallet', autoFund ? 'pending — request sent to faucet' : 'waiting for manual funding');
  let lastBalance = 0n;
  try {
    const unshieldedState = await quiet(() =>
      waitForUnshieldedFunds(
        logger,
        walletFacade,
        envConfiguration,
        unshieldedToken(),
        autoFund,
        BALANCE_POLL_INTERVAL_MS,
        {
          timeoutMs: FUNDING_TIMEOUT_MS,
          onBalance: (balance) => {
            if (balance === lastBalance) return;
            lastBalance = balance;
            status.setDetail(`Balance: ${balance} tNIGHT`);
          },
          onFaucetError: (e) => {
            const outage = describeFaucetOutage(e);
            status.setDetail(`${FAUCET_OUTAGE_TITLES[outage.kind]} — falling back to manual funding`);
            if (outageShown) return;
            printFaucetOutagePanel(outage, address, envConfiguration.faucet);
            outageShown = true;
          },
        },
      ),
    );
    const balance = unshieldedState.balances[unshieldedToken().raw] ?? 0n;
    status.milestone(`Funds received. Balance: ${balance} tNIGHT`);
    return unshieldedState;
  } catch (e) {
    if (e instanceof FundingTimeoutError) {
      throw new WalletError({
        title: 'Wallet Funding Timed Out',
        whatHappened: `No test tokens arrived at ${address} within ${FUNDING_TIMEOUT_MS / 60_000} minutes.`,
        howToFix: `Open ${envConfiguration.faucet ?? 'the network faucet'}, request tokens for the address above, confirm they arrived, then retry (or raise the timeout with --funding-timeout <minutes>):\n\n  npm run deploy -- --network ${network}`,
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
  // Local uses the well-known genesis-funded seed instead of a persisted/random one — the
  // local devnet has no faucet, so this is the only seed that starts out with funds.
  const isLocal = config instanceof StandaloneConfig;
  const existingSeed = isLocal ? GENESIS_MINT_WALLET_SEED : loadDeploymentWalletSeed(deploymentNetwork);
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

  const walletAddress = await getUnshieldedAddress(logger, walletFacade);

  // Single, continuously-updating status line for the rest of the run (funding wait, sync,
  // dust registration, deployment) — these are the stages long enough that the CLI can
  // otherwise look stuck.
  const status = ui.statusLine(networkLabel, walletAddress, 'Wallet Sync');

  // Wait for full sync before reading the balance — otherwise an already-funded wallet
  // briefly reports a stale 0 balance and the funding screen flashes for no reason.
  // Bounded by FUNDING_TIMEOUT_MS: on a live network, unshielded sync demands an exact
  // zero-gap match against the chain tip, which can otherwise never resolve and hang forever.
  let syncedState;
  try {
    syncedState = await quiet(() =>
      syncWallet(logger, walletFacade, 2_000, (detail) => status.setDetail(detail), FUNDING_TIMEOUT_MS),
    );
  } catch (e) {
    if (e instanceof SyncTimeoutError) {
      throw new WalletError({
        title: 'Wallet Sync Timed Out',
        whatHappened: `The wallet did not finish syncing with the ${networkLabel} network within ${FUNDING_TIMEOUT_MS / 60_000} minutes.`,
        howToFix: `Check that the indexer and node are healthy, then retry (or raise the timeout with --funding-timeout <minutes>):\n\n  npm run deploy -- --network ${network}`,
      });
    }
    throw e;
  }
  status.milestone('Wallet synchronized');

  let unshieldedState = syncedState.unshielded;
  let nightBalance = unshieldedState.balances[unshieldedToken().raw] ?? 0n;

  if (nightBalance > 0n) {
    status.milestone('Wallet already funded');
    ui.section('💰 Deployment Wallet');
    ui.summary([
      ['Network', networkLabel],
      ['Wallet Address', walletAddress],
      ['Balance', `${nightBalance} tNIGHT`],
    ]);
    ui.info('Continuing deployment...');
  } else {
    printFundingInfo(walletAddress, nightBalance, envConfiguration);
    if (noWait) {
      status.stop();
      ui.info('Re-run this command once funded to continue deployment automatically.');
      await quiet(() => walletProvider.stop());
      await quiet(() => testEnv.shutdown());
      process.exit(0);
    }
    unshieldedState = await runFundingScreen(status, walletFacade, envConfiguration, walletAddress, startupFaucetOutage);
    nightBalance = unshieldedState.balances[unshieldedToken().raw] ?? 0n;
    ui.section('🚀 Continuing Deployment');
  }

  if (config.generateDust) {
    status.setStage('DUST Registration');
    const dustTx = await quiet(() => generateDust(logger, seed, unshieldedState, walletFacade));
    if (dustTx) {
      await quiet(() => syncWallet(logger, walletFacade, 2_000, undefined, FUNDING_TIMEOUT_MS));
      status.milestone('DUST generation registered');
    } else {
      status.milestone('DUST already registered');
    }
  }

  status.setStage('Contract Deployment');
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

  const api = await quiet(() => BBoardAPI.deploy(providers, logger));
  const address = api.deployedContractAddress;
  assertIsContractAddress(address);
  status.milestone('Contract deployed');

  status.setDetail('verifying...');
  const deployedState = await quiet(() => providers.publicDataProvider.queryContractState(address));
  if (!deployedState) {
    status.stop();
    throw new DeploymentError({
      title: 'Contract Deployed But Not Yet Queryable',
      whatHappened: `The transaction submitted successfully, but querying ${address} on the indexer returned no state.`,
      howToFix: `The indexer may still be catching up. Wait a few seconds and check the address on the explorer, or re-run:\n\n  npm run deploy -- --network ${network}`,
    });
  }
  status.milestone('Deployment verified — contract is live and queryable');
  status.stop();

  const explorerUrl = buildExplorerUrl(config.explorerUrl, address);
  if (explorerUrl) ui.info(`${color.dim('Explorer:')} ${explorerUrl}`);
  ui.info(`${color.dim('Balance:')} ${nightBalance} tNIGHT`);

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
