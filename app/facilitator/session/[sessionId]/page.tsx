import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getInterventionsByIds,
  getSession,
  getYearLog,
  listTeams,
  PRICE_HORIZON_YEARS,
} from "../../../../lib/db/repository";
import { addTeamAction, advanceYearAction } from "../../actions";
import { eventPhotoUrl, stripInlineStyles } from "../../../../lib/format/eventHtml";
import { RealtimeRefresh } from "../../../../components/RealtimeRefresh";

export const dynamic = "force-dynamic";

export default async function SessionPage({ params }: { params: { sessionId: string } }) {
  const session = await getSession(params.sessionId);
  if (!session) notFound();

  const [teams, yearLog] = await Promise.all([listTeams(session.id), getYearLog(session.id)]);

  const allFiredIds = [...new Set(yearLog.flatMap((entry) => entry.firedInterventionIds))];
  const interventions = await getInterventionsByIds(allFiredIds);
  const interventionById = new Map(interventions.map((iv) => [iv.id, iv]));

  const canAdvance = session.currentYear < PRICE_HORIZON_YEARS;

  return (
    <main className="min-h-screen p-8 max-w-3xl mx-auto space-y-8">
      <RealtimeRefresh
        channelName={`facilitator-session-${session.id}`}
        watch={[
          { table: "game_sessions", filter: `id=eq.${session.id}` },
          { table: "teams", filter: `session_id=eq.${session.id}` },
          { table: "session_year_log", filter: `session_id=eq.${session.id}` },
        ]}
      />

      <div>
        <Link href="/facilitator" className="text-sm text-slate-400 hover:text-slate-200 transition">
          &larr; All sessions
        </Link>
        <h1 className="text-2xl font-semibold mt-1">{session.name}</h1>
        <p className="text-slate-400">
          Year {session.currentYear} of {PRICE_HORIZON_YEARS} &middot; {session.status}
        </p>
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-lg font-medium text-slate-200">Teams</h2>
          <div className="flex items-center gap-3">
            <a
              href={`/results/${session.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-slate-400 hover:text-emerald-400 transition underline"
              title="Open a live leaderboard view — good for a shared screen or projector"
            >
              Results view &#8599;
            </a>
            <form action={advanceYearAction}>
              <input type="hidden" name="sessionId" value={session.id} />
              <button
                type="submit"
                disabled={!canAdvance}
                className="rounded bg-emerald-600 px-4 py-2 font-medium hover:bg-emerald-500 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Advance to year {session.currentYear + 1}
              </button>
            </form>
          </div>
        </div>

        {teams.length === 0 ? (
          <p className="text-slate-400 text-sm">No teams yet &mdash; add one below.</p>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-sm text-slate-400">
                <th className="py-2 font-normal">Team</th>
                <th className="py-2 font-normal">Join code</th>
                <th className="py-2 font-normal text-right">Balance</th>
                <th className="py-2 font-normal text-right">Reputation</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((team) => (
                <tr key={team.id} className="border-b border-slate-900">
                  <td className="py-2">{team.name}</td>
                  <td className="py-2 font-mono text-slate-300">
                    <a
                      href={`/play/${team.joinCode}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline hover:text-emerald-400 transition"
                      title="Open this team's screen in a new tab"
                    >
                      {team.joinCode}
                    </a>
                  </td>
                  <td className="py-2 text-right">{team.balance.toLocaleString()}</td>
                  <td className="py-2 text-right">{team.reputation.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <form action={addTeamAction} className="flex gap-2">
          <input type="hidden" name="sessionId" value={session.id} />
          <input
            type="text"
            name="name"
            placeholder="Team name"
            required
            className="flex-1 rounded border border-slate-600 bg-slate-900 px-3 py-2"
          />
          <button type="submit" className="rounded bg-slate-700 px-4 py-2 hover:bg-slate-600 transition">
            Add team
          </button>
        </form>

        <p className="text-xs text-slate-500">
          Give each team their join code &mdash; that&apos;s how they&apos;ll find their screen once the team app
          exists (Phase 4). Balances won&apos;t move on their own yet either: investing is also Phase 4, so for now
          Advance Year mainly proves the session mechanics and any scheduled events work against the real data.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium text-slate-200">Year history</h2>
        {yearLog.length === 0 ? (
          <p className="text-slate-400 text-sm">No years advanced yet.</p>
        ) : (
          <ol className="space-y-4">
            {[...yearLog].reverse().map((entry) => (
              <li key={entry.year} className="rounded border border-slate-800 p-4">
                <p className="font-medium">Year {entry.year}</p>
                {entry.firedInterventionIds.length === 0 ? (
                  <p className="text-sm text-slate-500 mt-1">No scheduled events this year.</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {entry.firedInterventionIds.map((id) => {
                      const intervention = interventionById.get(id);
                      if (!intervention) return null;
                      const photoUrl = eventPhotoUrl(intervention.photoPath);
                      return (
                        <li key={id} className="text-sm">
                          <p className="font-medium text-emerald-400">{intervention.name}</p>
                          {photoUrl && (
                            // eslint-disable-next-line @next/next/no-img-element -- a handful of small template photos, not worth next/image's config for this
                            <img
                              src={photoUrl}
                              alt=""
                              className="mt-2 max-h-48 rounded border border-slate-800 object-cover"
                            />
                          )}
                          {intervention.subject && (
                            <div
                              className="text-slate-300 [&_p]:my-1"
                              dangerouslySetInnerHTML={{ __html: stripInlineStyles(intervention.subject) }}
                            />
                          )}
                          {intervention.message && (
                            <div
                              className="text-slate-400 [&_p]:my-1"
                              dangerouslySetInnerHTML={{ __html: stripInlineStyles(intervention.message) }}
                            />
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {entry.unmodeledEffectTypes.length > 0 && (
                  <p className="mt-2 text-xs text-amber-400">
                    Fired but needs a manual follow-up (not automatically applied): {entry.unmodeledEffectTypes.join(", ")}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}
