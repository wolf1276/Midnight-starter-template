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

import path from 'node:path';
import {
  EnvironmentConfiguration,
  IndexerClient,
  LocalTestConfiguration,
  NodeClient,
  ProofServerClient,
  RemoteTestEnvironment,
  TestEnvironment,
} from '@midnight-ntwrk/testkit-js';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { Logger } from 'pino';
import { MidnightWalletProvider } from './midnight-wallet-provider.js';

/** Ports of the local Docker stack started by infra/scripts/lib/infra.mjs (docker-compose.yml). */
const LOCAL_STACK_PORTS = { node: 9944, indexer: 8088, proofServer: 6300 };

/**
 * Points at the local node/indexer/proof-server already started by
 * infra/scripts/lib/infra.mjs's `ensureLocalMidnightServices`, rather than spinning up testkit-js's
 * own throwaway containers (which expect a `compose.yml` this template doesn't ship). Shutdown is a
 * no-op — the stack is shared with `npm run dev` and stays up across CLI invocations.
 */
class LocalStandaloneTestEnvironment extends TestEnvironment {
  private environmentConfiguration!: EnvironmentConfiguration;

  getEnvironmentConfiguration(): EnvironmentConfiguration {
    return new LocalTestConfiguration(LOCAL_STACK_PORTS);
  }

  start = async (): Promise<EnvironmentConfiguration> => {
    this.logger.info('Using local Midnight stack (node/indexer/proof-server) started by npm run deploy...');
    this.environmentConfiguration = this.getEnvironmentConfiguration();
    // infra.mjs's own pre-flight checks only confirm each container is reachable, not that it has
    // finished its own startup work — the indexer's /ready keeps 503ing until it catches up with the
    // node's chain height, and on a cold volume the proof server can still be mid-download of its ZK
    // proving/verifying keys (~20MB from S3) after its port is already accepting TCP connections. Both
    // race a single immediate health check, so poll all three the same way (90s/2s, matching infra.mjs).
    await this.waitForHealthy('node', () => new NodeClient(this.environmentConfiguration.node, this.logger).health());
    await this.waitForHealthy('indexer', () =>
      new IndexerClient(this.environmentConfiguration.indexer, this.logger).health(),
    );
    await this.waitForHealthy('proof server', () =>
      new ProofServerClient(this.environmentConfiguration.proofServer, this.logger).health(),
    );
    return this.environmentConfiguration;
  };

  private waitForHealthy = async (name: string, healthCheck: () => Promise<unknown>): Promise<void> => {
    const timeoutMs = 90_000;
    const pollIntervalMs = 2_000;
    const deadline = Date.now() + timeoutMs;
    while (true) {
      try {
        await healthCheck();
        return;
      } catch (e) {
        if (Date.now() >= deadline) throw e;
        this.logger.info(`Waiting for ${name} to become healthy...`);
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
    }
  };

  shutdown = async (): Promise<void> => {};

  startMidnightWalletProviders = async (amount = 1, seeds?: string[]): Promise<MidnightWalletProvider[]> => {
    const config = this.getEnvironmentConfiguration();
    const providers = await Promise.all(
      Array.from({ length: amount }, (_, i) => MidnightWalletProvider.build(this.logger, config, seeds?.[i])),
    );
    await Promise.all(providers.map((provider) => provider.start()));
    return providers;
  };
}

export interface Config {
  readonly privateStateStoreName: string;
  readonly logDir: string;
  readonly zkConfigPath: string;
  getEnvironment(logger: Logger): TestEnvironment;
  readonly generateDust: boolean;
  /** Base URL for the block explorer, with {contractAddress} placeholder. */
  readonly explorerUrl: string;
}

export const currentDir = path.resolve(new URL(import.meta.url).pathname, '..');

/** Well-known seed pre-funded in the local devnet's genesis block — used instead of a faucet. */
export const GENESIS_MINT_WALLET_SEED = '0000000000000000000000000000000000000000000000000000000000000001';

export class StandaloneConfig implements Config {
  getEnvironment(logger: Logger): TestEnvironment {
    setNetworkId('undeployed');
    return new LocalStandaloneTestEnvironment(logger);
  }
  privateStateStoreName = 'bboard-private-state';
  logDir = path.resolve(currentDir, '..', 'logs', 'standalone', `${new Date().toISOString()}.log`);
  zkConfigPath = path.resolve(currentDir, '..', '..', 'contracts', 'src', 'managed', 'bboard');
  generateDust = false;
  explorerUrl = '';
}

export class PreviewRemoteConfig implements Config {
  getEnvironment(logger: Logger): TestEnvironment {
    setNetworkId('preview');
    return new PreviewTestEnvironment(logger);
  }
  privateStateStoreName = 'bboard-private-state';
  logDir = path.resolve(currentDir, '..', 'logs', 'preview-remote', `${new Date().toISOString()}.log`);
  zkConfigPath = path.resolve(currentDir, '..', '..', 'contracts', 'src', 'managed', 'bboard');
  generateDust = true;
  explorerUrl = 'https://explorer.preview.midnight.network/contracts/stream/{contractAddress}';
}

export class PreprodRemoteConfig implements Config {
  getEnvironment(logger: Logger): TestEnvironment {
    setNetworkId('preprod');
    return new PreprodTestEnvironment(logger);
  }
  privateStateStoreName = 'bboard-private-state';
  logDir = path.resolve(currentDir, '..', 'logs', 'preprod-remote', `${new Date().toISOString()}.log`);
  zkConfigPath = path.resolve(currentDir, '..', '..', 'contracts', 'src', 'managed', 'bboard');
  generateDust = true;
  explorerUrl = 'https://explorer.preprod.midnight.network/contracts/stream/{contractAddress}';
}

export class PreviewTestEnvironment extends RemoteTestEnvironment {
  constructor(logger: Logger) {
    super(logger);
  }

  private getProofServerUrl(): string {
    const container = this.proofServerContainer as { getUrl(): string } | undefined;
    if (!container) {
      throw new Error('Proof server container is not available.');
    }
    return container.getUrl();
  }

  getEnvironmentConfiguration(): EnvironmentConfiguration {
    return {
      walletNetworkId: 'preview',
      networkId: 'preview',
      indexer: 'https://indexer.preview.midnight.network/api/v4/graphql',
      indexerWS: 'wss://indexer.preview.midnight.network/api/v4/graphql/ws',
      node: 'https://rpc.preview.midnight.network',
      nodeWS: 'wss://rpc.preview.midnight.network',
      faucet: 'https://midnight-tmnight-preview.nethermind.dev/',
      proofServer: this.getProofServerUrl(),
    };
  }
}

export class PreprodTestEnvironment extends RemoteTestEnvironment {
  constructor(logger: Logger) {
    super(logger);
  }

  private getProofServerUrl(): string {
    const container = this.proofServerContainer as { getUrl(): string } | undefined;
    if (!container) {
      throw new Error('Proof server container is not available.');
    }
    return container.getUrl();
  }

  getEnvironmentConfiguration(): EnvironmentConfiguration {
    return {
      walletNetworkId: 'preprod',
      networkId: 'preprod',
      indexer: 'https://indexer.preprod.midnight.network/api/v4/graphql',
      indexerWS: 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws',
      node: 'https://rpc.preprod.midnight.network',
      nodeWS: 'wss://rpc.preprod.midnight.network',
      faucet: 'https://midnight-tmnight-preprod.nethermind.dev/',
      proofServer: this.getProofServerUrl(),
    };
  }
}
