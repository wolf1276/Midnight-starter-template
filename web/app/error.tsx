'use client';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[#464655] p-6 text-center text-white">
      <p className="text-lg font-medium">Something went wrong.</p>
      <p className="max-w-md text-sm text-white/60">{error.message}</p>
      <button
        type="button"
        className="rounded-md bg-white/90 px-4 py-2 text-sm font-medium text-black hover:bg-white"
        onClick={reset}
      >
        Try again
      </button>
    </div>
  );
}
