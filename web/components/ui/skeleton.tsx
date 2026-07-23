import { cn } from '@/lib/utils';

export interface SkeletonProps {
  className?: string;
  variant?: 'circular' | 'rectangular';
}

export const Skeleton: React.FC<SkeletonProps> = ({ className, variant = 'rectangular' }) => (
  <div className={cn('animate-pulse bg-white/10', variant === 'circular' ? 'rounded-full' : 'rounded-md', className)} />
);
