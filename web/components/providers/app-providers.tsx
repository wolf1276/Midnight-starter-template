'use client';

import React, { useMemo } from 'react';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { networkId } from '@/config';
import { installBrowserPolyfills } from '@/lib/polyfills';
import { logger } from '@/lib/logger';
import { BoardProvider } from './board-provider';
import { ErrorBoundary } from './error-boundary';

installBrowserPolyfills();
setNetworkId(networkId);
logger.trace(`networkId = ${networkId}`);

/** Root client-side provider tree: browser polyfills, network id, error boundary, board context. */
export const AppProviders: React.FC<React.PropsWithChildren> = ({ children }) => {
  const appLogger = useMemo(() => logger, []);

  return (
    <ErrorBoundary>
      <BoardProvider logger={appLogger}>{children}</BoardProvider>
    </ErrorBoundary>
  );
};
