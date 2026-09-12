/**
 * Team play screen — placeholder.
 *
 * Phase 4 of the roadmap builds this out: live market view, browse and
 * invest in assets, portfolio and balance view. `teamCode` identifies which
 * team/session this screen belongs to.
 */
export default function PlayPage({
  params,
}: {
  params: { teamCode: string };
}) {
  return (
    <main className="min-h-screen p-8">
      <h1 className="text-2xl font-semibold mb-2">Team screen</h1>
      <p className="text-slate-300">
        Team code: <span className="font-mono">{params.teamCode}</span>
      </p>
      <p className="text-slate-400 mt-4">
        Coming in Phase 4: market prices, asset investment, and portfolio view.
      </p>
    </main>
  );
}
