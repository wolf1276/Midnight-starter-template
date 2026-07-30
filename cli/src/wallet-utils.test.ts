// This file is part of midnightntwrk/example-bboard.
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { describe, expect, it } from 'vitest';
import * as Rx from 'rxjs';
import { formatSyncProgress, syncWallet, SyncTimeoutError } from './wallet-utils.js';
import type { FacadeState } from '@midnight-ntwrk/wallet-sdk-facade';
import type { Logger } from 'pino';

// shielded/dust progress (wallet-sdk-abstractions shape).
const indexProgress = (appliedIndex: bigint, highestRelevantWalletIndex: bigint, isStrictlyComplete: boolean) => ({
  appliedIndex,
  highestRelevantWalletIndex,
  isStrictlyComplete: () => isStrictlyComplete,
});

// unshielded progress (wallet-sdk-unshielded-wallet shape) — different field names entirely.
const idProgress = (appliedId: bigint, highestTransactionId: bigint, isStrictlyComplete: boolean) => ({
  appliedId,
  highestTransactionId,
  isStrictlyComplete: () => isStrictlyComplete,
});

const fakeState = (shieldedDone: boolean, unshieldedDone: boolean, dustDone: boolean) =>
  ({
    shielded: { state: { progress: indexProgress(100n, 100n, shieldedDone) }, balances: {} },
    unshielded: { progress: idProgress(70n, 100n, unshieldedDone), balances: {} },
    dust: { state: { progress: indexProgress(38n, 100n, dustDone) }, balance: () => 0n },
  }) as unknown as FacadeState;

describe('formatSyncProgress', () => {
  it('keeps a completed component visible instead of hiding it', () => {
    const line = formatSyncProgress(fakeState(true, true, false));
    expect(line).toContain('shielded 100% ✓');
    expect(line).toContain('dust 38%');
    expect(line).not.toContain('dust 38% ✓');
  });

  it('reads unshielded progress from its own field names instead of printing undefined/NaN', () => {
    const line = formatSyncProgress(fakeState(true, false, false));
    expect(line).toContain('unshielded 70%');
    expect(line).not.toContain('NaN');
    expect(line).not.toContain('undefined');
  });
});

const noopLogger = { debug: () => {}, warn: () => {}, error: () => {} } as unknown as Logger;

describe('syncWallet', () => {
  it('rejects with SyncTimeoutError instead of hanging when sync never completes', async () => {
    // A source that never emits a synced state (and never completes) — mirrors a wallet whose
    // unshielded progress never reaches the exact zero-gap match isStrictlyComplete() requires.
    const fakeWallet = { state: () => Rx.NEVER } as unknown as Parameters<typeof syncWallet>[1];

    await expect(syncWallet(noopLogger, fakeWallet, 0, undefined, 20)).rejects.toBeInstanceOf(SyncTimeoutError);
  });
});
