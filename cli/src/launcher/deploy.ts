import { appendFileSync } from 'node:fs';
import { get } from 'node:https';
import { WebSocket } from 'ws';
import { createLogger } from '../logger-utils.js';
import { type Config, PreviewRemoteConfig, PreprodRemoteConfig } from '../config.js';
import { type TestEnvironment } from '@midnight-ntwrk/testkit-js';
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

const FAUCET_CHECK_TIMEOUT_MS = 10_000;

const deployStart = Date.now();

/** Quick reachability check for the faucet URL — warn early if it's down. */
async function checkFaucetReachable(faucetUrl: string): Promise<boolean> {
  return new Promise((resolve) => {
    const url = new URL(faucetUrl);
    const req = get(url, { timeout: FAUCET_CHECK_TIMEOUT_MS, rejectUnauthorized: false }, (res) => {
      res.destroy();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function runFundingScreen(
  walletFacade: WalletFacade,
  envConfiguration: Awaited<ReturnType<TestEnvironment['start']>>,
): Promise<Awaited<ReturnType<typeof waitForUnshieldedFunds>>> {
  const address = await getUnshieldedAddress(logger, walletFacade);

  ui.section('💰 Wallet Funding Required');
  ui.summary([
    ['Network', network],
    ['Funding Address', address],
    ['Faucet', envConfiguration.faucet ?? '(none configured for this network)'],
  ]);
  ui.info('');
  ui.info('Open the faucet, paste the address above, request test tokens, and this');
  ui.info('deployment will automatically continue once funds arrive.');
  ui.info('');

  // Quick faucet reachability check — avoids a 15-minute silent timeout if the
  // faucet URL is stale or the network is unreachable.
  if (envConfiguration.faucet) {
    const faucetOk = await quiet(() => checkFaucetReachable(envConfiguration.faucet!));
    if (!faucetOk) {
      ui.warn(
        `Faucet at ${envConfiguration.faucet} appears unreachable. Funding may still work, but if deployment times out, check that the faucet URL is correct and accessible.`,
      );
      ui.info('');
    }
  }

  const fundingStep = ui.step('Waiting for funds');
  let lastBalance = 0n;
  try {
    const unshieldedState = await quiet(() =>
      waitForUnshieldedFunds(logger, walletFacade, envConfiguration, unshieldedToken(), true, 2_000, {
        timeoutMs: FUNDING_TIMEOUT_MS,
        onBalance: (balance) => {
          lastBalance = balance;
        },
      }),
    );
    const balance = unshieldedState.balances[unshieldedToken().raw] ?? 0n;
    fundingStep.succeed(`Funds detected (balance: ${balance} tNIGHT)`);
    return unshieldedState;
  } catch (e) {
    if (e instanceof FundingTimeoutError) {
      fundingStep.fail(
        `No funds received after ${FUNDING_TIMEOUT_MS / 60_000} minutes (balance: ${lastBalance} tNIGHT)`,
      );
      throw explainableError({
        what: 'Wallet funding timed out',
        why: `No test tokens arrived at ${address} within ${FUNDING_TIMEOUT_MS / 60_000} minutes.`,
        fix: `Open ${envConfiguration.faucet ?? 'the network faucet'}, request tokens for the address above, confirm they arrived, then retry.`,
        nextCommand: `npm run deploy -- --network ${network}`,
      });
    }
    fundingStep.fail('Funding check failed');
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
  const envConfiguration = await quiet(() => testEnv.start());
  envStep.succeed('Environment ready');

  ui.section('💰 Wallet Setup');

  const walletStep = ui.step('Creating deployment wallet');
  const seed = toHex(randomBytes(32));
  const walletProvider = await quiet(() => MidnightWalletProvider.build(logger, envConfiguration, seed));
  const walletFacade: WalletFacade = walletProvider.wallet;
  await quiet(() => walletProvider.start());
  walletStep.succeed('Wallet created');

  const balanceStep = ui.step('Checking wallet balance');
  let unshieldedState = await quiet(() => getInitialUnshieldedState(logger, walletFacade.unshielded));
  const nightBalance = unshieldedState.balances[unshieldedToken().raw];
  if (nightBalance === undefined || nightBalance === 0n) {
    balanceStep.warn('No funds yet');
    unshieldedState = await runFundingScreen(walletFacade, envConfiguration);
    ui.section('🚀 Continuing Deployment');
  } else {
    balanceStep.succeed(`Balance: ${nightBalance} tNIGHT`);
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
