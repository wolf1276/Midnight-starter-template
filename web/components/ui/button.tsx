import React from 'react';
import { cn } from '@/lib/utils';

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement>;

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    className={cn(
      'rounded-md bg-white/90 px-4 py-2 text-sm font-medium text-black transition-colors',
      'hover:bg-white disabled:pointer-events-none disabled:opacity-40',
      className,
    )}
    {...props}
  />
));
Button.displayName = 'Button';
