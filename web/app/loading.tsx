import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center gap-4 bg-[#464655]">
      <Skeleton className="h-[300px] w-[275px] rounded-xl" />
    </div>
  );
}
