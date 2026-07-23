'use client';

import React, { useEffect, useState } from 'react';
import { type Observable } from 'rxjs';
import { MainLayout } from '@/components/layout/main-layout';
import { Board } from '@/components/board/board';
import { useDeployedBoardContext } from '@/hooks/use-deployed-board-context';
import type { BoardDeployment } from '@/services/midnight';

/**
 * The bulletin board home page.
 *
 * Renders one card per known board deployment, plus a trailing card that lets the user create
 * or join another board. Requires a `<BoardProvider />` ancestor (see the root layout).
 */
export default function HomePage() {
  const boardApiProvider = useDeployedBoardContext();
  const [boardDeployments, setBoardDeployments] = useState<Array<Observable<BoardDeployment>>>([]);

  useEffect(() => {
    const subscription = boardApiProvider.boardDeployments$.subscribe(setBoardDeployments);
    return () => subscription.unsubscribe();
  }, [boardApiProvider]);

  return (
    <MainLayout>
      {boardDeployments.map((boardDeployment, idx) => (
        <div data-testid={`board-${idx}`} key={`board-${idx}`}>
          <Board boardDeployment$={boardDeployment} />
        </div>
      ))}
      <div data-testid="board-start">
        <Board />
      </div>
    </MainLayout>
  );
}
