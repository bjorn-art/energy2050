import { notFound } from "next/navigation";
import { countInvestmentsByTeam, getSession, listTeams } from "../../../lib/db/repository";
import { RealtimeRefresh } from "../../../components/RealtimeRefresh";

export const dynamic = "force-dynamic";

/**
 * A read-only results/leaderboard view, meant to be pulled up on a shared
 * screen or projector during a live session — no facilitator password
 * needed (unlike everything under /facilitator), same "the id in the URL
 * is the credential" model /play/[teamCode] already uses for join codes.
 * The facilitator's session page links here (see the "Results" link next
 * to Advance year).
 */
export default async function ResultsPage({ params }: { params: { sessionId: string } }) {
  const session = await getSession(params.sessionId);
  if (!session) notFound();

  const teams = await listTeams(session.id);
  const investmentCounts = await countInvestmentsByTeam(teams.map((t) => t.id));

  const ranked = [...teams].sort((a, b) => b.balance - a.balance);

  return (
    <main className="min-h-screen p-6 md:p-8 max-w-3xl mx-auto space-y-6">
      <RealtimeRefresh
        channelName={`results-${session.id}`}
        watch={[
          { table: "game_sessions", filter: `id=eq.${session.id}` },
          { table: "teams", filter: `session_id=eq.${session.id}` },
        ]}
      />

      <div className="text-center">
        <p className="text-slate-400 text-sm">
          Year {session.currentYear} &middot; {session.status}
        </p>
        <h1 className="text-3xl font-semibold mt-1">{session.name}</h1>
      </div>

      {ranked.length === 0 ? (
        <p className="text-slate-400 text-sm text-center">No teams yet.</p>
      ) : (
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-800 text-sm text-slate-400">
              <th className="py-2 font-normal">#</th>
              <th className="py-2 font-normal">Team</th>
              <th className="py-2 font-normal text-right">Balance</th>
              <th className="py-2 font-normal text-right">Reputation</th>
              <th className="py-2 font-normal text-right">Assets</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((team, i) => (
              <tr key={team.id} className="border-b border-slate-900">
                <td className="py-3 text-slate-400 font-mono">{i + 1}</td>
                <td className="py-3 text-lg font-medium">{team.name}</td>
                <td className="py-3 text-right font-mono text-lg">{team.balance.toLocaleString()}</td>
                <td className="py-3 text-right font-mono text-slate-300">{team.reputation.toLocaleString()}</td>
                <td className="py-3 text-right font-mono text-slate-300">
                  {investmentCounts.get(team.id) ?? 0}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="text-xs text-slate-500 text-center">
        Updates live while this page stays open &mdash; no need to refresh.
      </p>
    </main>
  );
}
