'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { type ContractAddress } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { Lock, LockOpen, Trash2, PencilLine, ClipboardCopy, XCircle, LoaderCircle } from 'lucide-react';
import { type Observable } from 'rxjs';
import { State } from '@midnight-ntwrk/bboard-contract';
import { type BBoardDerivedState, type DeployedBBoardAPI } from '@midnight-ntwrk/bboard-api';
import { useDeployedBoardContext } from '@/hooks/use-deployed-board-context';
import type { BoardDeployment } from '@/services/midnight';
import { Card, CardActions, CardContent, CardHeader } from '@/components/ui/card';
import { IconButton } from '@/components/ui/icon-button';
import { Skeleton } from '@/components/ui/skeleton';
import { toShortContractAddress } from '@/lib/utils';
import { BoardEmptyContent } from './board-empty-content';

export interface BoardProps {
  /** The observable bulletin board deployment. Omit to render the create/join card. */
  boardDeployment$?: Observable<BoardDeployment>;
}

/**
 * Renders a deployed bulletin board contract, allowing messages to be posted or taken down
 * following the rules enforced by the underlying Compact contract.
 *
 * @remarks
 * With no `boardDeployment$`, renders a UI to create or join a board (delegated to
 * {@link BoardEmptyContent}). Requires a `<BoardProvider />` ancestor.
 */
export const Board: React.FC<Readonly<BoardProps>> = ({ boardDeployment$ }) => {
  const boardApiProvider = useDeployedBoardContext();
  const [boardDeployment, setBoardDeployment] = useState<BoardDeployment>();
  const [deployedBoardAPI, setDeployedBoardAPI] = useState<DeployedBBoardAPI>();
  const [errorMessage, setErrorMessage] = useState<string>();
  const [boardState, setBoardState] = useState<BBoardDerivedState>();
  const [messagePrompt, setMessagePrompt] = useState<string>();
  const [isWorking, setIsWorking] = useState(!!boardDeployment$);

  const onCreateBoard = useCallback(() => boardApiProvider.resolve(), [boardApiProvider]);
  const onJoinBoard = useCallback(
    (contractAddress: ContractAddress) => boardApiProvider.resolve(contractAddress),
    [boardApiProvider],
  );

  const onPostMessage = useCallback(async () => {
    if (!messagePrompt || !deployedBoardAPI) return;
    try {
      setIsWorking(true);
      await deployedBoardAPI.post(messagePrompt);
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsWorking(false);
    }
  }, [deployedBoardAPI, messagePrompt]);

  const onDeleteMessage = useCallback(async () => {
    if (!deployedBoardAPI) return;
    try {
      setIsWorking(true);
      await deployedBoardAPI.takeDown();
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsWorking(false);
    }
  }, [deployedBoardAPI]);

  const onCopyContractAddress = useCallback(async () => {
    if (deployedBoardAPI) {
      await navigator.clipboard.writeText(deployedBoardAPI.deployedContractAddress);
    }
  }, [deployedBoardAPI]);

  useEffect(() => {
    if (!boardDeployment$) return;
    const subscription = boardDeployment$.subscribe(setBoardDeployment);
    return () => subscription.unsubscribe();
  }, [boardDeployment$]);

  useEffect(() => {
    if (!boardDeployment || boardDeployment.status === 'in-progress') return;

    setIsWorking(false);

    if (boardDeployment.status === 'failed') {
      setErrorMessage(
        boardDeployment.error.message.length ? boardDeployment.error.message : 'Encountered an unexpected error.',
      );
      return;
    }

    setDeployedBoardAPI(boardDeployment.api);
    const subscription = boardDeployment.api.state$.subscribe(setBoardState);
    return () => subscription.unsubscribe();
  }, [boardDeployment]);

  return (
    <Card>
      {!boardDeployment$ && (
        <BoardEmptyContent onCreateBoardCallback={onCreateBoard} onJoinBoardCallback={onJoinBoard} />
      )}

      {boardDeployment$ && (
        <>
          {isWorking && (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-black/60">
              <LoaderCircle data-testid="board-working-indicator" className="h-8 w-8 animate-spin text-white" />
            </div>
          )}
          {!!errorMessage && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-xl bg-black/80 p-4 text-center text-red-400">
              <XCircle className="h-8 w-8" />
              <p data-testid="board-error-message" className="text-xs">
                {errorMessage}
              </p>
            </div>
          )}

          <CardHeader
            avatar={
              boardState ? (
                boardState.state === State.VACANT || (boardState.state === State.OCCUPIED && boardState.isOwner) ? (
                  <LockOpen data-testid="post-unlocked-icon" className="h-5 w-5 text-white/70" />
                ) : (
                  <Lock data-testid="post-locked-icon" className="h-5 w-5 text-white/70" />
                )
              ) : (
                <Skeleton variant="circular" className="h-5 w-5" />
              )
            }
            title={
              <span data-testid="board-address">
                {toShortContractAddress(deployedBoardAPI?.deployedContractAddress) ?? 'Loading...'}
              </span>
            }
            action={
              deployedBoardAPI?.deployedContractAddress ? (
                <IconButton title="Copy contract address" onClick={onCopyContractAddress}>
                  <ClipboardCopy className="h-4 w-4" />
                </IconButton>
              ) : (
                <Skeleton variant="circular" className="h-5 w-5" />
              )
            }
          />

          <CardContent>
            {boardState ? (
              boardState.state === State.OCCUPIED ? (
                <p
                  data-testid="board-posted-message"
                  className="min-h-[160px] whitespace-pre-wrap text-sm text-white/80"
                >
                  {boardState.message}
                </p>
              ) : (
                <textarea
                  id="message-prompt"
                  data-testid="board-message-prompt"
                  autoFocus
                  placeholder="Message to post"
                  className="h-[160px] w-full resize-none rounded-md border border-white/20 bg-white px-3 py-2 text-sm text-black outline-none focus:border-white"
                  onChange={(e) => setMessagePrompt(e.target.value)}
                />
              )
            ) : (
              <Skeleton className="h-[160px] w-full" />
            )}
          </CardContent>

          <CardActions>
            {deployedBoardAPI ? (
              <>
                <IconButton
                  title="Post message"
                  data-testid="board-post-message-btn"
                  disabled={boardState?.state === State.OCCUPIED || !messagePrompt?.length}
                  onClick={onPostMessage}
                >
                  <PencilLine className="h-5 w-5" />
                </IconButton>
                <IconButton
                  title="Take down message"
                  data-testid="board-take-down-message-btn"
                  disabled={
                    boardState?.state === State.VACANT || (boardState?.state === State.OCCUPIED && !boardState.isOwner)
                  }
                  onClick={onDeleteMessage}
                >
                  <Trash2 className="h-5 w-5" />
                </IconButton>
              </>
            ) : (
              <Skeleton className="h-5 w-20" />
            )}
          </CardActions>
        </>
      )}
    </Card>
  );
};
