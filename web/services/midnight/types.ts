import type { DeployedBBoardAPI } from '@midnight-ntwrk/bboard-api';
import type { ContractAddress } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import type { Observable } from 'rxjs';

/** A bulletin board deployment that is currently being deployed or joined. */
export interface InProgressBoardDeployment {
  readonly status: 'in-progress';
}

/** A bulletin board deployment that has successfully resolved to a contract on-chain. */
export interface DeployedBoardDeployment {
  readonly status: 'deployed';
  readonly api: DeployedBBoardAPI;
}

/** A bulletin board deployment that failed to deploy or join. */
export interface FailedBoardDeployment {
  readonly status: 'failed';
  readonly error: Error;
}

/** The lifecycle states of a bulletin board deployment. */
export type BoardDeployment = InProgressBoardDeployment | DeployedBoardDeployment | FailedBoardDeployment;

/** Provides access to bulletin board deployments in the current session. */
export interface DeployedBoardAPIProvider {
  /**
   * An observable set of board deployments. Each item is itself observable, emitting further
   * state transitions (e.g. `in-progress` -> `deployed`) for that specific board.
   */
  readonly boardDeployments$: Observable<Array<Observable<BoardDeployment>>>;

  /**
   * Joins the bulletin board contract at `contractAddress`, or deploys a new one if omitted.
   */
  readonly resolve: (contractAddress?: ContractAddress) => Observable<BoardDeployment>;
}
