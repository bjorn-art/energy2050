"use client";

/**
 * Catches errors thrown by this page or its server actions (addTeamAction,
 * advanceYearAction) — e.g. a Supabase hiccup, or advancing past the
 * PRICE_HORIZON_YEARS limit — and shows something a non-coder can read and
 * act on, instead of a blank crash. Must be a Client Component; this is
 * the one file in the facilitator console that has to be.
 */
export default function SessionError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="min-h-screen p-8 max-w-2xl mx-auto space-y-4">
      <h1 className="text-xl font-semibold text-red-400">Something went wrong</h1>
      <p className="text-slate-300">{error.message}</p>
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
