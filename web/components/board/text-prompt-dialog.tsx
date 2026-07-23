'use client';

import React, { useState } from 'react';
import { Dialog, DialogActions, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export interface TextPromptDialogProps {
  /** The prompt to display to the user. */
  prompt: string;
  /** `true` to render the dialog opened; otherwise closed. */
  isOpen: boolean;
  /** Called if the user cancels the dialog. */
  onCancel: () => void;
  /** Called when the user submits their inputted text. */
  onSubmit: (text: string) => void;
}

/** A simple modal dialog that prompts the user for a single piece of textual data. */
export const TextPromptDialog: React.FC<Readonly<TextPromptDialogProps>> = ({ prompt, isOpen, onCancel, onSubmit }) => {
  const [text, setText] = useState('');

  return (
    <Dialog open={isOpen} onClose={onCancel}>
      <DialogTitle>
        <span data-testid="textprompt-dialog-title">{prompt}</span>
      </DialogTitle>
      <DialogContent>
        <input
          id="text-prompt"
          data-testid="textprompt-dialog-text-prompt"
          autoComplete="off"
          autoFocus
          className="w-full rounded-md border border-white/20 bg-white px-3 py-2 text-sm text-black outline-none focus:border-white"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </DialogContent>
      <DialogActions>
        <Button data-testid="textprompt-dialog-cancel-btn" onClick={onCancel}>
          Cancel
        </Button>
        <Button data-testid="textprompt-dialog-ok-btn" disabled={!text.length} onClick={() => onSubmit(text)}>
          OK
        </Button>
      </DialogActions>
    </Dialog>
  );
};
