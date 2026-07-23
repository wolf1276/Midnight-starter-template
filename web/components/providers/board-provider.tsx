'use client';

import React, { createContext, useMemo, type PropsWithChildren } from 'react';
import { type Logger } from 'pino';
import { BrowserDeployedBoardManager, type DeployedBoardAPIProvider } from '@/services/midnight';

export const DeployedBoardContext = createContext<DeployedBoardAPIProvider | undefined>(undefined);

export type BoardProviderProps = PropsWithChildren<{
  logger: Logger;
}>;

/**
 * Sets a {@link BrowserDeployedBoardManager} as the currently in-scope deployed board provider.
 * Must be a client component: it touches `window.midnight` and browser-only Midnight SDK code.
 */
export const BoardProvider: React.FC<Readonly<BoardProviderProps>> = ({ logger, children }) => {
  const manager = useMemo(() => new BrowserDeployedBoardManager(logger), [logger]);

  return <DeployedBoardContext.Provider value={manager}>{children}</DeployedBoardContext.Provider>;
};
