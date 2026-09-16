"use client";

/**
 * Catches errors thrown by this page or investAction (e.g. "Another team
 * has already invested in this asset," a Supabase hiccup) and shows
 * something a team can read and act on, instead of a blank crash. Mirrors
 * app/facilitator/session/[sessionId]/error.tsx.
 */
export default function PlayError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-xl font-semibold text-red-400">Something went wrong</h1>
      <p className="text-slate-300 max-w-sm">{error.message}</p>
      <button
        type="button"
        onClick={() => reset()}
        className="rounded bg-slate-700 px-4 py-2 hover:bg-slate-600 transition"
      >
        Try again
      </button>
    </main>
  );
}
