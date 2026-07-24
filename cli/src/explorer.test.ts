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
import { buildExplorerUrl } from './explorer.js';
import { PreviewRemoteConfig, PreprodRemoteConfig, StandaloneConfig } from './config.js';

const CONTRACT_ADDRESS = 'd1b0711dddb1b70cf9531ba37db74ab0acd8d94658b319bfb1fd1292763084c0';

describe('buildExplorerUrl', () => {
  it('substitutes the contract address into the placeholder', () => {
    expect(buildExplorerUrl('https://example.com/contracts/stream/{contractAddress}', CONTRACT_ADDRESS)).toBe(
      `https://example.com/contracts/stream/${CONTRACT_ADDRESS}`,
    );
  });

  it('returns an empty string when no explorer is configured', () => {
    expect(buildExplorerUrl('', CONTRACT_ADDRESS)).toBe('');
  });
});

// Verified against the live Night Scan explorer (explorer.preview.midnight.network): loading a
// known transaction's "Contract Address" link, and separately pasting a contract address into the
// site's own search bar, both land on /contracts/stream/{contractAddress} — NOT /contract/{address}.
describe('per-network explorer URL templates', () => {
  it('preview network uses the canonical Night Scan contract route', () => {
    const url = buildExplorerUrl(new PreviewRemoteConfig().explorerUrl, CONTRACT_ADDRESS);
    expect(url).toBe(`https://explorer.preview.midnight.network/contracts/stream/${CONTRACT_ADDRESS}`);
  });

  it('preprod network uses the canonical Night Scan contract route', () => {
    const url = buildExplorerUrl(new PreprodRemoteConfig().explorerUrl, CONTRACT_ADDRESS);
    expect(url).toBe(`https://explorer.preprod.midnight.network/contracts/stream/${CONTRACT_ADDRESS}`);
  });

  it('standalone network has no explorer configured', () => {
    expect(buildExplorerUrl(new StandaloneConfig().explorerUrl, CONTRACT_ADDRESS)).toBe('');
  });

  it('every configured explorer URL is well-formed: https, correct host, /contracts/stream/ path, ends with the address', () => {
    for (const config of [new PreviewRemoteConfig(), new PreprodRemoteConfig()]) {
      const url = buildExplorerUrl(config.explorerUrl, CONTRACT_ADDRESS);
      expect(url).toMatch(/^https:\/\/explorer\.(preview|preprod)\.midnight\.network\/contracts\/stream\/[0-9a-f]+$/);
      expect(url.endsWith(CONTRACT_ADDRESS)).toBe(true);
    }
  });
});
