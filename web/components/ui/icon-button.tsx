import React from 'react';
import { cn } from '@/lib/utils';

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  title: string;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, title, ...props }, ref) => (
    <button
      ref={ref}
      title={title}
      aria-label={title}
      type="button"
      className={cn(
        'inline-flex h-9 w-9 items-center justify-center rounded-full text-white/80 transition-colors',
        'hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-30',
        className,
      )}
      {...props}
    />
  ),
);
IconButton.displayName = 'IconButton';
