/*
 * This file is part of example-bboard.
 * Copyright (C) Midnight Foundation
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0 (the "License");
 * You may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { UnshieldedTokenType } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { type FacadeState, type WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { type ShieldedWalletAPI, type ShieldedWalletState } from '@midnight-ntwrk/wallet-sdk-shielded';
import { type UnshieldedWalletAPI, type UnshieldedWalletState } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import * as Rx from 'rxjs';

import { FaucetClient, type EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
import { Logger } from 'pino';
import { UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';

export const getInitialShieldedState = async (
  logger: Logger,
  wallet: ShieldedWalletAPI,
): Promise<ShieldedWalletState> => {
  logger.debug('Getting initial state of wallet...');
  return Rx.firstValueFrom(wallet.state);
};

export const getInitialUnshieldedState = async (
  logger: Logger,
  wallet: UnshieldedWalletAPI,
): Promise<UnshieldedWalletState> => {
  logger.debug('Getting initial state of wallet...');
  return Rx.firstValueFrom(wallet.state);
};

const verboseSyncDebug = process.env.DEBUG !== undefined || process.argv.slice(2).includes('--verbose');

const isProgressStrictlyComplete = (progress: unknown): boolean => {
  if (!progress || typeof progress !== 'object') {
    return false;
  }
  const candidate = progress as { isStrictlyComplete?: unknown };
  if (typeof candidate.isStrictlyComplete !== 'function') {
    return false;
  }
  return (candidate.isStrictlyComplete as () => boolean)();
};

const isFacadeStateSynced = (state: FacadeState): boolean =>
  isProgressStrictlyComplete(state.shielded.state.progress) &&
  isProgressStrictlyComplete(state.dust.state.progress) &&
  isProgressStrictlyComplete(state.unshielded.progress);

type SyncLabel = 'shielded' | 'unshielded' | 'dust';

/**
 * shielded/dust progress objects come from @midnight-ntwrk/wallet-sdk-abstractions and expose
 * appliedIndex/highestRelevantWalletIndex/highestIndex. unshielded progress comes from its own
 * package (wallet-sdk-unshielded-wallet) with a different shape: appliedId/highestTransactionId,
 * no highestIndex equivalent. Reading the wrong field names silently yields `undefined` instead
 * of a type error, so pull the counters per-label instead of assuming one shared shape.
 */
const getSyncCounters = (
  label: SyncLabel,
  progress: unknown,
): { applied: bigint; highest: bigint; isConnected: boolean } => {
  const p = progress as Record<string, unknown>;
  if (label === 'unshielded') {
    return {
      applied: p.appliedId as bigint,
      highest: p.highestTransactionId as bigint,
      isConnected: p.isConnected as boolean,
    };
  }
  return {
    applied: p.appliedIndex as bigint,
    highest: p.highestRelevantWalletIndex as bigint,
    isConnected: p.isConnected as boolean,
  };
};

/** Debug-only: log the raw sync counters per component (behind DEBUG env var or --verbose). */
const logSyncProgressDebug = (logger: Logger, state: FacadeState): void => {
  if (!verboseSyncDebug) return;
  (
    [
      ['shielded', state.shielded.state.progress],
      ['unshielded', state.unshielded.progress],
      ['dust', state.dust.state.progress],
    ] as const
  ).forEach(([label, progress]) => {
    const { applied, highest, isConnected } = getSyncCounters(label, progress);
    logger.debug(`[sync:${label}] applied=${applied} highest=${highest} isConnected=${isConnected}`);
  });
};

/**
 * Always includes all three components (never hides a completed one) so the UI can't imply
 * overall sync is done while a component is still lagging. e.g.
 * "shielded 100% ✓ · unshielded 100% ✓ · dust 38%"
 */
export const formatSyncProgress = (state: FacadeState): string =>
  (
    [
      ['shielded', state.shielded.state.progress],
      ['unshielded', state.unshielded.progress],
      ['dust', state.dust.state.progress],
    ] as const
  )
    .map(([label, progress]) => {
      // isStrictlyComplete() compares "applied" against each component's own target (not the
      // chain-wide highest), so use the same pairing here — otherwise the percentage understates
      // progress, e.g. dust can sit near 0% for minutes while actually close to done.
      const { applied, highest } = getSyncCounters(label, progress);
      const pct = highest > 0n ? Number((applied * 100n) / highest) : 0;
      const done = isProgressStrictlyComplete(progress);
      return `${label} ${pct}%${done ? ' ✓' : ''}`;
    })
    .join(' · ');

export class SyncTimeoutError extends Error {}

export const syncWallet = (
  logger: Logger,
  wallet: WalletFacade,
  throttleTime = 2_000,
  onProgress?: (detail: string) => void,
  timeoutMs?: number,
) => {
  logger.debug('Syncing wallet...');

  let obs$ = wallet.state().pipe(
    Rx.throttleTime(throttleTime),
    Rx.tap((state: FacadeState) => {
      const shieldedSynced = isProgressStrictlyComplete(state.shielded.state.progress);
      const unshieldedSynced = isProgressStrictlyComplete(state.unshielded.progress);
      const dustSynced = isProgressStrictlyComplete(state.dust.state.progress);
      const isSynced = shieldedSynced && dustSynced && unshieldedSynced;

      logger.debug(
        `Wallet synced state emission (synced=${isSynced}): { shielded=${shieldedSynced}, unshielded=${unshieldedSynced}, dust=${dustSynced} }`,
      );
      logSyncProgressDebug(logger, state);
      if (!isSynced) onProgress?.(`Waiting for all wallet components... ${formatSyncProgress(state)}`);
    }),
    Rx.filter((state: FacadeState) => isFacadeStateSynced(state)),
    Rx.tap(() => logger.debug('Sync complete')),
    Rx.tap((state: FacadeState) => {
      const shieldedBalances = state.shielded.balances || {};
      const unshieldedBalances = state.unshielded.balances || {};
      const dustBalances = state.dust.balance(new Date(Date.now())) || 0n;

      logger.debug(
        `Wallet balances after sync - Shielded: ${JSON.stringify(shieldedBalances)}, Unshielded: ${JSON.stringify(unshieldedBalances)}, Dust: ${dustBalances}`,
      );
    }),
  );
  if (timeoutMs !== undefined) {
    obs$ = obs$.pipe(Rx.timeout(timeoutMs));
  }
  return Rx.firstValueFrom(obs$).catch((e: unknown) => {
    if (e instanceof Rx.TimeoutError) {
      throw new SyncTimeoutError(`Wallet sync did not complete within ${timeoutMs}ms`);
    }
    throw e;
  });
};

export const getUnshieldedAddress = async (logger: Logger, wallet: WalletFacade): Promise<string> => {
  const initialState = await getInitialUnshieldedState(logger, wallet.unshielded);
  return UnshieldedAddress.codec.encode(getNetworkId(), initialState.address).toString();
};

export class FundingTimeoutError extends Error {}

export interface WaitForFundsOptions {
  /** Called with the latest known unshielded balance while waiting. */
  onBalance?: (balance: bigint) => void;
  /** Called if the automatic faucet request fails (e.g. faucet depleted/unreachable). Non-fatal. */
  onFaucetError?: (e: unknown) => void;
  /** If set, reject with FundingTimeoutError instead of waiting forever. */
  timeoutMs?: number;
}

export const waitForUnshieldedFunds = async (
  logger: Logger,
  wallet: WalletFacade,
  env: EnvironmentConfiguration,
  tokenType: UnshieldedTokenType,
  fundFromFaucet = false,
  throttleTime = 2_000,
  opts?: WaitForFundsOptions,
): Promise<UnshieldedWalletState> => {
  const initialState = await getInitialUnshieldedState(logger, wallet.unshielded);
  const unshieldedAddress = UnshieldedAddress.codec.encode(getNetworkId(), initialState.address);
  logger.debug(`Using unshielded address: ${unshieldedAddress.toString()} waiting for funds...`);
  if (fundFromFaucet && env.faucet) {
    logger.debug('Requesting tokens from faucet...');
    try {
      await new FaucetClient(env.faucet, logger).requestTokens(unshieldedAddress.toString());
    } catch (e) {
      // Best-effort: the faucet may be temporarily unavailable (e.g. depleted). Fall through
      // to the polling loop below so a manually-funded wallet still unblocks deployment.
      logger.warn(`Automatic faucet request failed, falling back to manual funding: ${(e as Error).message}`);
      opts?.onFaucetError?.(e);
    }
  }
  const initialBalance = initialState.balances[tokenType.raw];
  if (initialBalance === undefined || initialBalance === 0n) {
    logger.debug(`Your wallet initial balance is: 0 (not yet initialized)`);
    logger.debug(`Waiting to receive tokens...`);
    opts?.onBalance?.(0n);
    let obs$ = wallet.state().pipe(
      Rx.tap((state: FacadeState) => {
        const balance = state.unshielded.balances[tokenType.raw] ?? 0n;
        opts?.onBalance?.(balance);
        logger.debug(
          `Wallet funds state emission: { synced=${isFacadeStateSynced(state)}, balance=${balance.toString()} }`,
        );
      }),
      Rx.throttleTime(throttleTime),
      Rx.filter(
        (state: FacadeState) => isFacadeStateSynced(state) && (state.unshielded.balances[tokenType.raw] ?? 0n) > 0n,
      ),
      Rx.tap(() => logger.debug('Sync complete')),
      Rx.tap((state: FacadeState) => {
        const shieldedBalances = state.shielded.balances || {};
        const unshieldedBalances = state.unshielded.balances || {};
        const dustBalances = state.dust.balance(new Date(Date.now())) || 0n;

        logger.debug(
          `Wallet balances after sync - Shielded: ${JSON.stringify(shieldedBalances)}, Unshielded: ${JSON.stringify(unshieldedBalances)}, Dust: ${dustBalances}`,
        );
      }),
      Rx.map((state: FacadeState) => state.unshielded),
    );
    if (opts?.timeoutMs !== undefined) {
      obs$ = obs$.pipe(Rx.timeout(opts.timeoutMs));
    }
    try {
      return await Rx.firstValueFrom(obs$);
    } catch (e) {
      if (e instanceof Rx.TimeoutError) {
        throw new FundingTimeoutError(`Timed out after ${opts?.timeoutMs}ms waiting for funds`);
      }
      throw e;
    }
  }
  return initialState;
};
