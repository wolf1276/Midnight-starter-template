'use client';

import React from 'react';

interface ErrorBoundaryState {
  error?: Error;
}

/** Catches rendering errors anywhere below it and shows a friendly fallback instead of a blank page. */
export class ErrorBoundary extends React.Component<React.PropsWithChildren, ErrorBoundaryState> {
  state: ErrorBoundaryState = {};

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('Unhandled UI error:', error, info.componentStack);
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-black p-6 text-center text-white">
          <p className="text-lg font-medium">Something went wrong.</p>
          <p className="max-w-md text-sm text-white/60">{this.state.error.message}</p>
          <button
            type="button"
            className="rounded-md bg-white/90 px-4 py-2 text-sm font-medium text-black hover:bg-white"
            onClick={() => this.setState({ error: undefined })}
          >
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
