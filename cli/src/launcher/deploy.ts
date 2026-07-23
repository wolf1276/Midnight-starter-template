import { WebSocket } from 'ws';
import { createLogger } from '../logger-utils.js';
import { type Config, PreviewRemoteConfig, PreprodRemoteConfig } from '../config.js';
import { type TestEnvironment } from '@midnight-ntwrk/testkit-js';
import { type WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { MidnightWalletProvider } from '../midnight-wallet-provider.js';
import { waitForUnshieldedFunds, syncWallet } from '../wallet-utils.js';
import { generateDust } from '../generate-dust.js';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { BBoardAPI, type BBoardProviders, type PrivateStateId, bboardPrivateStateKey } from '../../../api/src/index.js';
import { toHex, assertIsContractAddress } from '@midnight-ntwrk/midnight-js-utils';
import { unshieldedToken } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { Logger } from 'pino';
import { randomBytes } from '../../../api/src/utils/index.js';
import { BBoardPrivateState } from '../../../contracts/src/witnesses.js';

globalThis.WebSocket = WebSocket as unknown as typeof globalThis.WebSocket;

const network = process.argv[2] ?? 'preview';

const config: Config = network === 'preprod' ? new PreprodRemoteConfig() : new PreviewRemoteConfig();
const logger = await createLogger(config.logDir);
const testEnv: TestEnvironment = config.getEnvironment(logger);

async function main() {
  const envConfiguration = await testEnv.start();
  logger.info(`Environment started: ${JSON.stringify(envConfiguration)}`);

  const seed = toHex(randomBytes(32));
  logger.info(`Generated wallet seed: ${seed}`);

  const walletProvider = await MidnightWalletProvider.build(logger, envConfiguration, seed);
  const walletFacade: WalletFacade = walletProvider.wallet;
  await walletProvider.start();

  const unshieldedState = await waitForUnshieldedFunds(logger, walletFacade, envConfiguration, unshieldedToken(), true);
  const nightBalance = unshieldedState.balances[unshieldedToken().raw];
  if (nightBalance === undefined || nightBalance === 0n) {
    logger.error('No funds received. Check wallet funding.');
    await walletProvider.stop();
    await testEnv.shutdown();
    process.exit(1);
  }
  logger.info(`NIGHT balance: ${nightBalance}`);

  if (config.generateDust) {
    const dustTx = await generateDust(logger, seed, unshieldedState, walletFacade);
    if (dustTx) {
      logger.info(`Dust generation submitted: ${dustTx}`);
      await syncWallet(logger, walletFacade);
    }
  }

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

  const api = await BBoardAPI.deploy(providers, logger);
  const address = api.deployedContractAddress;
  assertIsContractAddress(address);
  logger.info(`Deployed contract at address: ${address}`);
  console.log(`\nDeployed contract at address: ${address}\n`);
  // Machine-parseable line consumed by scripts/deploy/deploy.mjs to write
  // deployment.json and update web/.env.local — keep this format stable.
  console.log(`DEPLOYMENT_RESULT ${JSON.stringify({
    network,
    contractAddress: address,
    indexer: envConfiguration.indexer,
    node: envConfiguration.node,
    deployedAt: new Date().toISOString(),
  })}`);

  await walletProvider.stop();
  await testEnv.shutdown();
  process.exit(0);
}

main().catch(async (e) => {
  logger.error(e instanceof Error ? (e.stack ?? e.message) : JSON.stringify(e, Object.getOwnPropertyNames(e)));
  await testEnv.shutdown().catch(() => {});
  process.exit(1);
});
