import { Buffer } from 'buffer';

/**
 * The Midnight SDK (and some of its transitive dependencies, e.g. Apollo Client) expect a
 * Node-like global environment even when running in the browser. This module must be imported
 * once, before any Midnight SDK code runs on the client.
 */
export const installBrowserPolyfills = (): void => {
  if (typeof window === 'undefined') {
    return;
  }

  if (!('Buffer' in window)) {
    // @ts-expect-error -- Buffer isn't part of the DOM lib types, but third-party libs expect it globally.
    window.Buffer = Buffer;
  }

  if (!('process' in window)) {
    // @ts-expect-error -- minimal process shim, third-party libs only read `process.env.NODE_ENV`.
    window.process = { env: { NODE_ENV: process.env.NODE_ENV } };
  }
};
