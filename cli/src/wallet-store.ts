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

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Networks that get their own persistent deployment wallet. */
export type DeploymentNetwork = 'preview' | 'preprod';

const currentDir = path.resolve(new URL(import.meta.url).pathname, '..');
const walletStoreDir = path.resolve(currentDir, '..', '..', 'contracts', '.midnight');

interface StoredWallet {
  seed: string;
}

const walletFilePath = (network: DeploymentNetwork): string => path.resolve(walletStoreDir, `${network}-wallet.json`);

/** Reads the persisted seed for `network`, or `undefined` if no wallet has been created yet. */
export const loadDeploymentWalletSeed = (network: DeploymentNetwork): string | undefined => {
  const file = walletFilePath(network);
  if (!existsSync(file)) {
    return undefined;
  }
  const parsed = JSON.parse(readFileSync(file, 'utf-8')) as StoredWallet;
  return parsed.seed;
};

/** Persists `seed` as the deployment wallet for `network`, creating contracts/.midnight/ if needed. */
export const saveDeploymentWalletSeed = (network: DeploymentNetwork, seed: string): string => {
  mkdirSync(walletStoreDir, { recursive: true });
  const file = walletFilePath(network);
  writeFileSync(file, JSON.stringify({ seed }, null, 2) + '\n', { mode: 0o600 });
  return file;
};

/** Deletes the persisted wallet for `network`, if any. Returns whether a wallet was actually removed. */
export const resetDeploymentWallet = (network: DeploymentNetwork): boolean => {
  const file = walletFilePath(network);
  if (!existsSync(file)) {
    return false;
  }
  rmSync(file);
  return true;
};

/** Path (for display purposes) of the wallet file for `network`, relative to the repo root. */
export const walletFileDisplayPath = (network: DeploymentNetwork): string =>
  path.join('contracts', '.midnight', `${network}-wallet.json`);
