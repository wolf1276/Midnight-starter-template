import { BBoardAPI } from '@midnight-ntwrk/bboard-api';
import { type ContractAddress } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { BehaviorSubject, type Observable } from 'rxjs';
import { type Logger } from 'pino';
import { initializeProviders } from './providers';
import type { BoardDeployment, DeployedBoardAPIProvider } from './types';
import type { BBoardProviders } from '@midnight-ntwrk/bboard-api';

/**
 * A {@link DeployedBoardAPIProvider} that manages bulletin board deployments in a browser setting.
 *
 * @remarks
 * Configures and manages a connection to the Midnight wallet, plus the collection of providers
 * (proof, indexer, private state, etc.) required to deploy or join bulletin board contracts.
 * Providers are initialized lazily, once, and cached so concurrent deploy/join calls share the
 * same wallet connection.
 */
export class BrowserDeployedBoardManager implements DeployedBoardAPIProvider {
  readonly #boardDeploymentsSubject: BehaviorSubject<Array<BehaviorSubject<BoardDeployment>>>;
  #initializedProviders: Promise<BBoardProviders> | undefined;

  constructor(private readonly logger: Logger) {
    this.#boardDeploymentsSubject = new BehaviorSubject<Array<BehaviorSubject<BoardDeployment>>>([]);
    this.boardDeployments$ = this.#boardDeploymentsSubject;
  }

  readonly boardDeployments$: Observable<Array<Observable<BoardDeployment>>>;

  resolve(contractAddress?: ContractAddress): Observable<BoardDeployment> {
    const deployments = this.#boardDeploymentsSubject.value;
    let deployment = deployments.find(
      (deployment) =>
        deployment.value.status === 'deployed' && deployment.value.api.deployedContractAddress === contractAddress,
    );

    if (deployment) {
      return deployment;
    }

    deployment = new BehaviorSubject<BoardDeployment>({ status: 'in-progress' });

    if (contractAddress) {
      void this.joinDeployment(deployment, contractAddress);
    } else {
      void this.deployDeployment(deployment);
    }

    this.#boardDeploymentsSubject.next([...deployments, deployment]);

    return deployment;
  }

  private getProviders(): Promise<BBoardProviders> {
    return (this.#initializedProviders ??= initializeProviders(this.logger));
  }

  private async deployDeployment(deployment: BehaviorSubject<BoardDeployment>): Promise<void> {
    try {
      const providers = await this.getProviders();
      const api = await BBoardAPI.deploy(providers, this.logger);
      deployment.next({ status: 'deployed', api });
    } catch (error: unknown) {
      deployment.next({ status: 'failed', error: error instanceof Error ? error : new Error(String(error)) });
    }
  }

  private async joinDeployment(
    deployment: BehaviorSubject<BoardDeployment>,
    contractAddress: ContractAddress,
  ): Promise<void> {
    try {
      const providers = await this.getProviders();
      const api = await BBoardAPI.join(providers, contractAddress, this.logger);
      deployment.next({ status: 'deployed', api });
    } catch (error: unknown) {
      deployment.next({ status: 'failed', error: error instanceof Error ? error : new Error(String(error)) });
    }
  }
}
