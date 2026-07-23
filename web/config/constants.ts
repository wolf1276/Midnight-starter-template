/** Semver range of Midnight DApp Connector APIs this app knows how to talk to. */
export const COMPATIBLE_CONNECTOR_API_VERSION = '4.x';

/** How often (ms) to poll `window.midnight` while waiting for a wallet extension to appear. */
export const WALLET_DISCOVERY_POLL_INTERVAL_MS = 100;

/** Time budget (ms) to find a compatible wallet before giving up. */
export const WALLET_DISCOVERY_TIMEOUT_MS = 1_000;

/** Time budget (ms) for the wallet extension to respond once a connection is requested. */
export const WALLET_CONNECT_TIMEOUT_MS = 5_000;
