'use client';

import React, { useState } from 'react';
import { FilePlus2, CirclePlus, Link2 } from 'lucide-react';
import type { ContractAddress } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { CardActions, CardContent } from '@/components/ui/card';
import { IconButton } from '@/components/ui/icon-button';
import { TextPromptDialog } from './text-prompt-dialog';

export interface BoardEmptyContentProps {
  onCreateBoardCallback: () => void;
  onJoinBoardCallback: (contractAddress: ContractAddress) => void;
}

/** Rendered when there is no board deployment: lets the user create or join a bulletin board. */
export const BoardEmptyContent: React.FC<Readonly<BoardEmptyContentProps>> = ({
  onCreateBoardCallback,
  onJoinBoardCallback,
}) => {
  const [textPromptOpen, setTextPromptOpen] = useState(false);

  return (
    <>
      <CardContent className="flex flex-col items-center justify-center gap-3 text-center">
        <FilePlus2 className="h-10 w-10 text-white/40" />
        <p data-testid="board-posted-message" className="text-sm text-white/40">
          Create a new Board, or join an existing one...
        </p>
      </CardContent>
      <CardActions className="justify-center">
        <IconButton title="Create a new board" data-testid="board-deploy-btn" onClick={onCreateBoardCallback}>
          <CirclePlus className="h-5 w-5" />
        </IconButton>
        <IconButton title="Join an existing board" data-testid="board-join-btn" onClick={() => setTextPromptOpen(true)}>
          <Link2 className="h-5 w-5" />
        </IconButton>
      </CardActions>
      <TextPromptDialog
        prompt="Enter contract address"
        isOpen={textPromptOpen}
        onCancel={() => setTextPromptOpen(false)}
        onSubmit={(text) => {
          setTextPromptOpen(false);
          onJoinBoardCallback(text);
        }}
      />
    </>
  );
};
