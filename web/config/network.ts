import { NetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { env } from './environment';

/** Maps the validated `NEXT_PUBLIC_NETWORK_ID` string to the SDK's `NetworkId` enum. */
export const networkId = env.NEXT_PUBLIC_NETWORK_ID as NetworkId;
