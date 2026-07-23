import { useContext } from 'react';
import { DeployedBoardContext } from '@/components/providers/board-provider';
import type { DeployedBoardAPIProvider } from '@/services/midnight';

/** Retrieves the currently in-scope deployed boards provider. */
export const useDeployedBoardContext = (): DeployedBoardAPIProvider => {
  const context = useContext(DeployedBoardContext);

  if (!context) {
    throw new Error('A <BoardProvider /> is required.');
  }

  return context;
};
