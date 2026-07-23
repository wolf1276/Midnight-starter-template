/**
 * Replaces `isomorphic-ws` in the browser bundle.
 *
 * The upstream package's `browser.js` only has a default export, but
 * `@midnight-ntwrk/midnight-js-indexer-public-data-provider` does `import * as ws from
 * 'isomorphic-ws'` and reads `ws.WebSocket`, which doesn't exist on that shape. This shim
 * exposes the browser's native `WebSocket` under both the default and named export so either
 * access pattern works.
 */
export const WebSocket = globalThis.WebSocket;
export default WebSocket;
