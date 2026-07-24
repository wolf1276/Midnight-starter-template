import { createInterface, type Interface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { WebSocket } from 'ws';
import {
  BBoardAPI,
  type BBoardDerivedState,
  bboardPrivateStateKey,
  type BBoardProviders,
  type DeployedBBoardContract,
  type PrivateStateId,
} from '../../api/src/index';
import { type WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { ledger, type Ledger, State } from '../../contracts/src/managed/bboard/contract/index.js';
import { State as DerivedState } from '@midnight-ntwrk/bboard-contract';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { type Logger } from 'pino';
import { type Config, StandaloneConfig, GENESIS_MINT_WALLET_SEED } from './config.js';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { type ContractAddress } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { assertIsContractAddress, toHex } from '@midnight-ntwrk/midnight-js-utils';
import { TestEnvironment } from '@midnight-ntwrk/testkit-js';
import { MidnightWalletProvider } from './midnight-wallet-provider';
import { randomBytes } from '../../api/src/utils';
import { unshieldedToken } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { syncWallet, waitForUnshieldedFunds } from './wallet-utils';
import { generateDust } from './generate-dust';
import { BBoardPrivateState } from '../../contracts/src/witnesses.js';
import * as ui from './ui.js';
import { classifyError, printCliError } from './errors.js';

const verbose = process.argv.slice(2).includes('--verbose') || process.argv.slice(2).includes('--debug');

// @ts-expect-error: It's needed to enable WebSocket usage through apollo
globalThis.WebSocket = WebSocket;

export const getBBoardLedgerState = async (
  providers: BBoardProviders,
  contractAddress: ContractAddress,
): Promise<Ledger | null> => {
  assertIsContractAddress(contractAddress);
  const contractState = await providers.publicDataProvider.queryContractState(contractAddress);
  return contractState != null ? ledger(contractState.data) : null;
};

const DEPLOY_OR_JOIN_QUESTION = `
You can do one of the following:
  1. Deploy a new bulletin board contract
  2. Join an existing bulletin board contract
  3. Exit
Which would you like to do? `;

const deployOrJoin = async (providers: BBoardProviders, rli: Interface, logger: Logger): Promise<BBoardAPI | null> => {
  let api: BBoardAPI | null = null;

  while (true) {
    const choice = await rli.question(DEPLOY_OR_JOIN_QUESTION);
    switch (choice) {
      case '1':
        api = await BBoardAPI.deploy(providers, logger);
        ui.success(`Deployed contract at: ${api.deployedContractAddress}`);
        return api;
      case '2':
        api = await BBoardAPI.join(providers, await rli.question('What is the contract address (in hex)? '), logger);
        ui.success(`Joined contract at: ${api.deployedContractAddress}`);
        return api;
      case '3':
        ui.info('Exiting...');
        return null;
      default:
        ui.warn(`Invalid choice: ${choice}`);
    }
  }
};

const displayLedgerState = async (
  providers: BBoardProviders,
  deployedBBoardContract: DeployedBBoardContract,
): Promise<void> => {
  const contractAddress = deployedBBoardContract.deployTxData.public.contractAddress;
  const ledgerState = await getBBoardLedgerState(providers, contractAddress);
  if (ledgerState === null) {
    ui.info(`No bulletin board contract deployed at ${contractAddress}`);
  } else {
    const boardState = ledgerState.state === State.OCCUPIED ? 'occupied' : 'vacant';
    const latestMessage = !ledgerState.message.is_some ? 'none' : ledgerState.message.value;
    ui.info(`State:    ${boardState}`);
    ui.info(`Message:  ${latestMessage}`);
    ui.info(`Sequence: ${ledgerState.sequence}`);
    ui.info(`Owner:    ${toHex(ledgerState.owner)}`);
  }
};

const displayPrivateState = async (providers: BBoardProviders): Promise<void> => {
  const privateState = await providers.privateStateProvider.get(bboardPrivateStateKey);
  if (privateState === null) {
    ui.info('No existing bulletin board private state');
  } else {
    ui.info(`Secret key: ${toHex(privateState.secretKey)}`);
  }
};

const displayDerivedState = (ledgerState: BBoardDerivedState | undefined) => {
  if (ledgerState === undefined) {
    ui.info('No bulletin board state currently available');
  } else {
    const boardState = ledgerState.state === DerivedState.OCCUPIED ? 'occupied' : 'vacant';
    const latestMessage = ledgerState.state === DerivedState.OCCUPIED ? ledgerState.message : 'none';
    ui.info(`State:    ${boardState}`);
    ui.info(`Message:  ${latestMessage}`);
    ui.info(`Sequence: ${ledgerState.sequence}`);
    ui.info(`Owner:    ${ledgerState.isOwner ? 'you' : 'not you'}`);
  }
};

const MAIN_LOOP_QUESTION = `
You can do one of the following:
  1. Post a message
  2. Take down your message
  3. Display the current ledger state (known by everyone)
  4. Display the current private state (known only to this DApp instance)
  5. Display the current derived state (known only to this DApp instance)
  6. Exit
Which would you like to do? `;

const mainLoop = async (providers: BBoardProviders, rli: Interface, logger: Logger): Promise<void> => {
  const bboardApi = await deployOrJoin(providers, rli, logger);
  if (bboardApi === null) {
    return;
  }
  let currentState: BBoardDerivedState | undefined;
  const stateObserver = {
    next: (state: BBoardDerivedState) => (currentState = state),
  };
  const subscription = bboardApi.state$.subscribe(stateObserver);
  try {
    while (true) {
      const choice = await rli.question(MAIN_LOOP_QUESTION);
      try {
        switch (choice) {
          case '1': {
            const message = await rli.question('What message do you want to post? ');
            await bboardApi.post(message);
            ui.success('Message posted');
            break;
          }
          case '2':
            await bboardApi.takeDown();
            ui.success('Message taken down');
            break;
          case '3':
            await displayLedgerState(providers, bboardApi.deployedContract);
            break;
          case '4':
            await displayPrivateState(providers);
            break;
          case '5':
            displayDerivedState(currentState);
            break;
          case '6':
            ui.info('Exiting...');
            return;
          default:
            ui.warn(`Invalid choice: ${choice}`);
        }
      } catch (e) {
        const err = classifyError(e);
        logger.error(err.stack ?? err.message);
        printCliError(err, verbose);
        ui.info('Returning to main menu...');
      }
    }
  } finally {
    subscription.unsubscribe();
  }
};

const WALLET_LOOP_QUESTION = `
You can do one of the following:
  1. Build a fresh wallet
  2. Build wallet from a seed
  3. Exit
Which would you like to do? `;

const buildWallet = async (config: Config, rli: Interface): Promise<string | undefined> => {
  if (config instanceof StandaloneConfig) {
    return GENESIS_MINT_WALLET_SEED;
  }
  while (true) {
    const choice = await rli.question(WALLET_LOOP_QUESTION);
    switch (choice) {
      case '1':
        return toHex(randomBytes(32));
      case '2':
        return await rli.question('Enter your wallet seed: ');
      case '3':
        ui.info('Exiting...');
        return undefined;
      default:
        ui.warn(`Invalid choice: ${choice}`);
    }
  }
};

export const run = async (config: Config, testEnv: TestEnvironment, logger: Logger): Promise<void> => {
  const rli = createInterface({ input, output, terminal: true });
  const providersToBeStopped: MidnightWalletProvider[] = [];
  try {
    const envConfiguration = await testEnv.start();
    logger.debug(`Environment started with configuration: ${JSON.stringify(envConfiguration)}`);
    const seed = await buildWallet(config, rli);
    if (seed === undefined) {
      return;
    }
    const walletProvider = await MidnightWalletProvider.build(logger, envConfiguration, seed);
    providersToBeStopped.push(walletProvider);
    const walletFacade: WalletFacade = walletProvider.wallet;

    await walletProvider.start();

    const unshieldedState = await waitForUnshieldedFunds(logger, walletFacade, envConfiguration, unshieldedToken());
    const nightBalance = unshieldedState.balances[unshieldedToken().raw];
    if (nightBalance === undefined) {
      ui.info('No funds received, exiting...');
      return;
    }
    logger.debug(`NIGHT wallet balance: ${nightBalance}`);

    if (config.generateDust) {
      const dustGeneration = await generateDust(logger, seed, unshieldedState, walletFacade);
      if (dustGeneration) {
        logger.debug(`Submitted dust generation registration transaction: ${dustGeneration}`);
        await syncWallet(logger, walletFacade);
      }
    }

    const zkConfigProvider = new NodeZkConfigProvider<'post' | 'takeDown'>(config.zkConfigPath);
    // Generated once per run and only ever kept in memory — this store is scratch space for a
    // single session, never reopened across processes, so there's nothing to persist.
    const storagePassword = `${toHex(randomBytes(24))}-${Date.now()}`;
    const providers: BBoardProviders = {
      privateStateProvider: levelPrivateStateProvider<PrivateStateId, BBoardPrivateState>({
        privateStateStoreName: config.privateStateStoreName,
        signingKeyStoreName: `${config.privateStateStoreName}-signing-keys`,
        privateStoragePasswordProvider: () => storagePassword,
        accountId: seed,
      }),
      publicDataProvider: indexerPublicDataProvider(envConfiguration.indexer, envConfiguration.indexerWS),
      zkConfigProvider: zkConfigProvider,
      proofProvider: httpClientProofProvider(envConfiguration.proofServer, zkConfigProvider),
      walletProvider: walletProvider,
      midnightProvider: walletProvider,
    };
    await mainLoop(providers, rli, logger);
  } catch (e) {
    const err = classifyError(e);
    logger.error(err.stack ?? err.message);
    printCliError(err, verbose);
    process.exitCode = err.exitCode;
  } finally {
    try {
      rli.close();
      rli.removeAllListeners();
    } catch (e) {
      logError(logger, e);
    } finally {
      try {
        for (const wallet of providersToBeStopped) {
          logger.debug('Stopping wallet...');
          await wallet.stop();
        }
        if (testEnv) {
          logger.debug('Stopping test environment...');
          await testEnv.shutdown();
        }
      } catch (e) {
        logError(logger, e);
      }
    }
  }
};

function logError(logger: Logger, e: unknown) {
  if (e instanceof Error) {
    logger.debug(`${e.stack}`);
    ui.fail(e.message);
  } else {
    ui.fail(String(e));
  }
}
