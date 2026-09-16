import Link from "next/link";
import { listSessions } from "../../lib/db/repository";
import { createSessionAction } from "./actions";
import { logoutAction } from "./login/actions";

export const dynamic = "force-dynamic";

export default async function FacilitatorPage() {
  const sessions = await listSessions();

  return (
    <main className="min-h-screen p-8 max-w-2xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Facilitator console</h1>
        <form action={logoutAction}>
          <button type="submit" className="text-sm text-slate-400 hover:text-slate-200 transition">
            Log out
          </button>
        </form>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-medium text-slate-200">Start a new session</h2>
        <form action={createSessionAction} className="flex gap-2">
          <input
            type="text"
            name="name"
            placeholder="e.g. Thursday morning workshop"
            required
            className="flex-1 rounded border border-slate-600 bg-slate-900 px-3 py-2"
          />
          <button
            type="submit"
            className="rounded bg-emerald-600 px-4 py-2 font-medium hover:bg-emerald-500 transition"
          >
            Create session
          </button>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium text-slate-200">Existing sessions</h2>
        {sessions.length === 0 ? (
          <p className="text-slate-400 text-sm">No sessions yet &mdash; create one above to get started.</p>
        ) : (
          <ul className="divide-y divide-slate-800 rounded border border-slate-800">
            {sessions.map((session) => (
              <li key={session.id}>
                <Link
                  href={`/facilitator/session/${session.id}`}
                  className="flex items-center justify-between px-4 py-3 hover:bg-slate-900 transition"
                >
                  <span>{session.name}</span>
                  <span className="text-sm text-slate-400">
                    Year {session.currentYear} &middot; {session.status}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
