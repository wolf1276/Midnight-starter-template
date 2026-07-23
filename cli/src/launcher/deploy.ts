import { appendFileSync } from 'node:fs';
import { WebSocket } from 'ws';
import { createLogger } from '../logger-utils.js';
import { type Config, PreviewRemoteConfig, PreprodRemoteConfig } from '../config.js';
import { type EnvironmentConfiguration, type TestEnvironment } from '@midnight-ntwrk/testkit-js';
import { type WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { MidnightWalletProvider } from '../midnight-wallet-provider.js';
import {
  FundingTimeoutError,
  getInitialUnshieldedState,
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
import { color, type ActionableError, explainError, withQuiet } from '../ui.js';

globalThis.WebSocket = WebSocket as unknown as typeof globalThis.WebSocket;

const rawArgs = process.argv.slice(2);
const verbose = rawArgs.includes('--verbose') || rawArgs.includes('--debug');
const network = rawArgs.find((a) => !a.startsWith('--')) ?? 'preview';
const networkLabel = network === 'preprod' ? 'Preprod' : 'Preview';

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

const FUNDING_TIMEOUT_MS = 15 * 60 * 1000;
const BALANCE_POLL_INTERVAL_MS = 5_000;

const deployStart = Date.now();

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
      throw explainableError({
        what: 'Wallet funding timed out',
        why: `No test tokens arrived at ${address} within ${FUNDING_TIMEOUT_MS / 60_000} minutes.`,
        fix: `Open ${envConfiguration.faucet ?? 'the network faucet'}, request tokens for the address above, confirm they arrived, then retry.`,
        nextCommand: `npm run deploy -- --network ${network}`,
      });
    }
    throw e;
  }
}

class ExplainableError extends Error {
  constructor(public readonly details: ActionableError) {
    super(details.what);
  }
}

function explainableError(details: ActionableError): ExplainableError {
  return new ExplainableError(details);
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

  const walletStep = ui.step('Creating deployment wallet');
  const seed = toHex(randomBytes(32));
  const walletProvider = await quiet(() => MidnightWalletProvider.build(logger, envConfiguration, seed));
  const walletFacade: WalletFacade = walletProvider.wallet;
  await quiet(() => walletProvider.start());
  walletStep.succeed('Wallet created');

  let unshieldedState = await quiet(() => getInitialUnshieldedState(logger, walletFacade.unshielded));
  const walletAddress = await getUnshieldedAddress(logger, walletFacade);
  let nightBalance = unshieldedState.balances[unshieldedToken().raw] ?? 0n;

  // Always show the wallet address and balance — never leave the user guessing what to fund.
  ui.section('💰 Deployment Wallet');
  ui.summary([
    ['Network', networkLabel],
    ['Wallet Address', walletAddress],
    ['Current Balance', `${nightBalance} tNIGHT`],
  ]);

  if (nightBalance === 0n) {
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
  const providers: BBoardProviders = {
    privateStateProvider: levelPrivateStateProvider<PrivateStateId, BBoardPrivateState>({
      privateStateStoreName: config.privateStateStoreName,
      signingKeyStoreName: `${config.privateStateStoreName}-signing-keys`,
      privateStoragePasswordProvider: () => 'Bboard-Test-2026!',
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

  const explorerUrl = config.explorerUrl ? config.explorerUrl.replace('{contractAddress}', address) : '';
  ui.section('📄 Deployment Summary');
  const summaryRows: Array<[string, string]> = [
    ['Network', network],
    ['Contract Address', address],
    ['Indexer', envConfiguration.indexer],
  ];
  if (explorerUrl) {
    summaryRows.splice(2, 0, ['Explorer', explorerUrl]);
  }
  ui.summary(summaryRows);

  logger.info(`Deployed contract at address: ${address}`);
  // Machine-parseable line consumed by scripts/deploy/deploy.mjs to write
  // deployment.json and update web/.env.local — keep this format stable.
  console.log(
    `DEPLOYMENT_RESULT ${JSON.stringify({
      network,
      contractAddress: address,
      indexer: envConfiguration.indexer,
      node: envConfiguration.node,
      deployedAt: new Date().toISOString(),
      ...(config.explorerUrl ? { explorerUrl } : {}),
    })}`,
  );

  await quiet(() => walletProvider.stop());
  await quiet(() => testEnv.shutdown());

  ui.section(`✅ Deployment completed in ${ui.elapsedSince(deployStart)}`);
  process.exit(0);
}

function classifyError(e: unknown): ActionableError {
  if (e instanceof ExplainableError) {
    return e.details;
  }
  let message = e instanceof Error ? e.message : String(e);
  if (!message && e instanceof AggregateError) {
    message = e.errors.map((inner) => (inner instanceof Error ? inner.message : String(inner))).join('; ');
  }
  if (!message && e instanceof Error) {
    message = e.name;
  }
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|network/i.test(message)) {
    return {
      what: 'Could not reach the Midnight network',
      why: message,
      fix: 'Check your internet connection and that the node/indexer/proof-server endpoints are reachable.',
      nextCommand: `npm run deploy -- --network ${network}`,
    };
  }
  if (/proof.?server/i.test(message)) {
    return {
      what: 'Proof server is unavailable',
      why: message,
      fix: 'Make sure Docker is running so the proof server container can start, then retry.',
      nextCommand: `npm run deploy -- --network ${network}`,
    };
  }
  if (/status code 5\d\d/i.test(message)) {
    const requestUrl = getAxiosRequestUrl(e);
    return {
      what: 'A remote Midnight service is temporarily unavailable',
      why: requestUrl
        ? `${requestUrl} returned an error response. This is an issue with that remote service, not your project.`
        : `A remote request failed with a server error. ${message}`,
      fix: 'This is usually temporary — wait a bit and retry.',
      nextCommand: `npm run deploy -- --network ${network}`,
    };
  }
  return {
    what: 'Deployment failed',
    why: message,
    fix: verbose
      ? 'Check the diagnostic output above and the log file for more detail.'
      : 'Re-run with --verbose for full diagnostic output.',
    nextCommand: verbose ? undefined : `npm run deploy -- --network ${network} --verbose`,
  };
}

main().catch(async (e) => {
  const details = classifyError(e);
  explainError(details);
  logger.error(e instanceof Error ? (e.stack ?? e.message) : JSON.stringify(e, Object.getOwnPropertyNames(e)));
  if (verbose && e instanceof Error && e.stack) {
    console.error(color.dim(e.stack));
  }
  await testEnv.shutdown().catch(() => {});
  process.exit(1);
});
