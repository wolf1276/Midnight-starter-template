import React from 'react';
import { cn } from '@/lib/utils';

export const Card: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div
    className={cn(
      'relative flex h-[300px] w-[275px] min-w-[275px] min-h-[300px] flex-col rounded-xl',
      'border border-white/10 bg-white/5 shadow-lg backdrop-blur-sm',
      className,
    )}
    {...props}
  />
);

export const CardHeader: React.FC<{
  avatar?: React.ReactNode;
  title: React.ReactNode;
  action?: React.ReactNode;
}> = ({ avatar, title, action }) => (
  <div className="flex items-center gap-3 px-4 pt-4">
    <div className="shrink-0">{avatar}</div>
    <div className="flex-1 truncate text-sm font-medium text-white/70">{title}</div>
    <div className="shrink-0">{action}</div>
  </div>
);

export const CardContent: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div className={cn('flex-1 px-4 py-3', className)} {...props} />
);

export const CardActions: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div className={cn('flex items-center gap-1 px-2 pb-2', className)} {...props} />
);
