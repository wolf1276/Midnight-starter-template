import { type BBoardCircuitKeys, type BBoardProviders } from '@midnight-ntwrk/bboard-api';
import { fromHex, toHex } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import {
  Binding,
  FinalizedTransaction,
  Proof,
  SignatureEnabled,
  Transaction,
  TransactionId,
} from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { BBoardPrivateState } from '@midnight-ntwrk/bboard-contract';
import type { UnboundTransaction } from '@midnight-ntwrk/midnight-js-types';
import { type Logger } from 'pino';
import { networkId } from '@/config';
import { connectToWallet } from './wallet';
import { inMemoryPrivateStateProvider } from './in-memory-private-state-provider';

/**
 * Builds the full set of {@link BBoardProviders} required to deploy or join a bulletin board
 * contract in a browser session.
 *
 * @remarks
 * The indexer, indexer-websocket and proof-server endpoints are not configured by this app;
 * they come from the connected wallet's own configuration (`connectedAPI.getConfiguration()`),
 * so the same build works against whichever network the user's wallet is pointed at.
 */
export const initializeProviders = async (logger: Logger): Promise<BBoardProviders> => {
  const connectedAPI = await connectToWallet(logger, networkId);
  const zkConfigPath = window.location.origin;
  const keyMaterialProvider = new FetchZkConfigProvider<BBoardCircuitKeys>(zkConfigPath, fetch.bind(window));
  const config = await connectedAPI.getConfiguration();
  const privateStateProvider = inMemoryPrivateStateProvider<string, BBoardPrivateState>();
  const shieldedAddresses = await connectedAPI.getShieldedAddresses();

  return {
    privateStateProvider,
    zkConfigProvider: keyMaterialProvider,
    proofProvider: httpClientProofProvider(config.proverServerUri!, keyMaterialProvider),
    publicDataProvider: indexerPublicDataProvider(config.indexerUri, config.indexerWsUri),
    walletProvider: {
      getCoinPublicKey(): string {
        return shieldedAddresses.shieldedCoinPublicKey;
      },
      getEncryptionPublicKey(): string {
        return shieldedAddresses.shieldedEncryptionPublicKey;
      },
      balanceTx: async (tx: UnboundTransaction, ttl?: Date): Promise<FinalizedTransaction> => {
        try {
          logger.info({ tx, ttl }, 'Balancing transaction via wallet');
          const serializedTx = toHex(tx.serialize());
          const received = await connectedAPI.balanceUnsealedTransaction(serializedTx);
          return Transaction.deserialize<SignatureEnabled, Proof, Binding>(
            'signature',
            'proof',
            'binding',
            fromHex(received.tx),
          );
        } catch (e) {
          logger.error({ error: e }, 'Error balancing transaction via wallet');
          throw e;
        }
      },
    },
    midnightProvider: {
      submitTx: async (tx: FinalizedTransaction): Promise<TransactionId> => {
        await connectedAPI.submitTransaction(toHex(tx.serialize()));
        const txIdentifiers = tx.identifiers();
        const txId = txIdentifiers[0]; // A finalized transaction always has at least one identifier.
        logger.info({ txIdentifiers }, 'Submitted transaction via wallet');
        return txId!;
      },
    },
  };
};
