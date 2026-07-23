import { ConnectedAPI, type InitialAPI } from '@midnight-ntwrk/dapp-connector-api';
import semver from 'semver';
import { catchError, concatMap, filter, firstValueFrom, interval, map, take, tap, throwError, timeout } from 'rxjs';
import { pipe as fnPipe } from 'fp-ts/function';
import { type Logger } from 'pino';
import {
  COMPATIBLE_CONNECTOR_API_VERSION,
  WALLET_CONNECT_TIMEOUT_MS,
  WALLET_DISCOVERY_POLL_INTERVAL_MS,
  WALLET_DISCOVERY_TIMEOUT_MS,
} from '@/config';

/** Finds the first browser-injected wallet whose connector API is compatible with this app. */
const getFirstCompatibleWallet = (): InitialAPI | undefined => {
  if (typeof window === 'undefined' || !window.midnight) return undefined;
  return Object.values(window.midnight).find(
    (wallet): wallet is InitialAPI =>
      !!wallet &&
      typeof wallet === 'object' &&
      'apiVersion' in wallet &&
      semver.satisfies(wallet.apiVersion, COMPATIBLE_CONNECTOR_API_VERSION),
  );
};

/**
 * Discovers a compatible Midnight wallet extension (e.g. Lace, 1AM) and connects to it.
 *
 * @throws If no compatible wallet is found, the extension fails to respond, or the user
 * declines to authorize this application.
 */
export const connectToWallet = (logger: Logger, networkId: string): Promise<ConnectedAPI> =>
  firstValueFrom(
    fnPipe(
      interval(WALLET_DISCOVERY_POLL_INTERVAL_MS),
      map(() => getFirstCompatibleWallet()),
      tap((connectorAPI) => {
        logger.trace(connectorAPI, 'Checking for wallet connector API');
      }),
      filter((connectorAPI): connectorAPI is InitialAPI => !!connectorAPI),
      tap((connectorAPI) => {
        logger.info(connectorAPI, 'Compatible wallet connector API found. Connecting.');
      }),
      take(1),
      timeout({
        first: WALLET_DISCOVERY_TIMEOUT_MS,
        with: () =>
          throwError(() => {
            logger.error('Could not find wallet connector API');
            return new Error('Could not find a Midnight wallet. Is the extension installed?');
          }),
      }),
      concatMap(async (initialAPI) => {
        const connectedAPI = await initialAPI.connect(networkId);
        const connectionStatus = await connectedAPI.getConnectionStatus();
        logger.info(connectionStatus, 'Wallet connector API enabled status');
        return connectedAPI;
      }),
      timeout({
        first: WALLET_CONNECT_TIMEOUT_MS,
        with: () =>
          throwError(() => {
            logger.error('Wallet connector API failed to respond');
            return new Error('The Midnight wallet failed to respond. Is the extension enabled?');
          }),
      }),
      catchError((error, apis) =>
        error
          ? throwError(() => {
              logger.error({ error }, 'Unable to enable connector API');
              return new Error('Application is not authorized by the wallet.');
            })
          : apis,
      ),
    ),
  );
