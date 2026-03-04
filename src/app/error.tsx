"use client";

import { useEffect } from "react";
import { GlassCard } from "@/components/ui";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset?: () => void;
}) {
  const handleRetry = () => {
    if (typeof reset === "function") {
      reset();
      return;
    }

    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  useEffect(() => {
    console.error("[app/error] boundary caught", {
      message: error?.message,
      digest: error?.digest,
      stack: error?.stack,
    });
  }, [error]);

  return (
    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
      <GlassCard className="max-w-xl w-full p-6 space-y-4 border border-white/10">
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="text-sm text-white/70">
          The page hit an unexpected server-render error.
        </p>
        {error?.digest ? (
          <p className="text-xs text-white/50">Error digest: {error.digest}</p>
        ) : null}
        <button
          type="button"
          onClick={handleRetry}
          className="bg-blue-500 hover:bg-blue-400 text-white px-4 py-2 rounded-xl text-sm font-semibold"
        >
          Try again
        </button>
      </GlassCard>
    </div>
  );
}
