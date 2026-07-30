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

/**
 * Builds a deep link to a contract on the Night Scan block explorer, from a
 * template URL containing a `{contractAddress}` placeholder (as configured
 * per network in config.ts). Returns '' if no explorer is configured for
 * the network (e.g. standalone).
 */
export function buildExplorerUrl(explorerUrlTemplate: string, contractAddress: string): string {
  if (!explorerUrlTemplate) return '';
  return explorerUrlTemplate.replace('{contractAddress}', contractAddress);
}

/**
 * Builds a deep link to a wallet address on the same explorer, by swapping the contract
 * template's `/contracts/stream/{contractAddress}` path for `/address/{address}`. Returns ''
 * if no explorer is configured, or the template doesn't match the expected shape.
 */
export function buildWalletExplorerUrl(explorerUrlTemplate: string, address: string): string {
  if (!explorerUrlTemplate.includes('/contracts/stream/{contractAddress}')) return '';
  return explorerUrlTemplate.replace('/contracts/stream/{contractAddress}', `/address/${address}`);
}
