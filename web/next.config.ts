import path from 'node:path';
import type { NextConfig } from 'next';

/**
 * The Midnight SDK ships WebAssembly modules (the ZK proving/compact runtime) that rely on
 * top-level await. These only ever run in the browser, but Next.js still needs to know how to
 * bundle them for both the client build and Turbopack dev server.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '..'),
  transpilePackages: ['@midnight-ntwrk/bboard-api', '@midnight-ntwrk/bboard-contract'],
  turbopack: {
    // See lib/isomorphic-ws-browser-shim.ts for why this alias is needed. Turbopack (used by
    // `next dev`) doesn't read the `webpack()` config below, so it needs its own alias entry.
    resolveAlias: {
      'isomorphic-ws': './lib/isomorphic-ws-browser-shim.ts',
    },
  },
  webpack: (config, { isServer }) => {
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      layers: true,
    };

    if (isServer) {
      // The wallet-connector flow only ever runs client-side; keep server bundles free of it.
      config.externals = [...(config.externals ?? []), '@midnight-ntwrk/dapp-connector-api'];
    } else {
      // See lib/isomorphic-ws-browser-shim.ts for why this alias is needed.
      config.resolve.alias = {
        ...config.resolve.alias,
        'isomorphic-ws': path.resolve(__dirname, 'lib/isomorphic-ws-browser-shim.ts'),
      };
    }

    return config;
  },
};

export default nextConfig;
