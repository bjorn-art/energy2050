import { joinAction } from "./actions";

/**
 * Where a team starts: type the join code their facilitator gave them.
 * There's no password/account here beyond the code itself — same "the code
 * is the credential" model the facilitator console's README already
 * describes. Validation (does this code match a real team?) happens on
 * /play/[teamCode] itself, which shows a friendly "not found" message
 * rather than a generic 404 if the code doesn't match.
 */
export default function PlayJoinPage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 p-8">
      <div className="max-w-sm w-full space-y-4">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-semibold">Join your team</h1>
          <p className="text-slate-400 text-sm">Enter the team code your facilitator gave you.</p>
        </div>
        <form action={joinAction} className="flex flex-col gap-3">
          <input
            type="text"
            name="code"
            placeholder="Team code"
            required
            autoFocus
            autoCapitalize="characters"
            className="rounded border border-slate-600 bg-slate-900 px-3 py-3 text-center font-mono text-lg uppercase tracking-widest"
          />
          <button
            type="submit"
            className="rounded bg-emerald-600 px-4 py-2 font-medium hover:bg-emerald-500 transition"
          >
            Go
          </button>
        </form>
      </div>
    </main>
  );
}
