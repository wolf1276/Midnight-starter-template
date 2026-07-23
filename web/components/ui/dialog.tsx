'use client';

import React, { useEffect, useRef } from 'react';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

/** A minimal, accessible modal built on the native `<dialog>` element. */
export const Dialog: React.FC<DialogProps> = ({ open, onClose, children }) => {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      className="w-full max-w-sm rounded-xl border border-white/10 bg-[#2a2a35] p-0 text-white backdrop:bg-black/60"
    >
      {children}
    </dialog>
  );
};

export const DialogTitle: React.FC<React.PropsWithChildren> = ({ children }) => (
  <div className="border-b border-white/10 px-6 py-4 text-base font-medium">{children}</div>
);

export const DialogContent: React.FC<React.PropsWithChildren> = ({ children }) => (
  <div className="px-6 py-4">{children}</div>
);

export const DialogActions: React.FC<React.PropsWithChildren> = ({ children }) => (
  <div className="flex justify-end gap-2 border-t border-white/10 px-6 py-3">{children}</div>
);
