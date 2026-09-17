import Link from "next/link";
import {
  getCurrentAreaPrices,
  getTeamByJoinCode,
  getTeamPortfolio,
  listInvestableAssets,
  listPendingAssetDecisions,
  listPendingCsrPrompts,
} from "../../../lib/db/repository";
import { eventPhotoUrl, stripInlineStyles } from "../../../lib/format/eventHtml";
import { chooseAssetInterventionAction, investAction, respondCsrAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function PlayPage({ params }: { params: { teamCode: string } }) {
  const found = await getTeamByJoinCode(params.teamCode);

  if (!found) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 text-center">
        <h1 className="text-xl font-semibold">Team not found</h1>
        <p className="text-slate-400 max-w-sm">
          &ldquo;{params.teamCode}&rdquo; doesn&apos;t match any team &mdash; double-check the code your facilitator
          gave you.
        </p>
        <Link href="/play" className="text-emerald-400 hover:text-emerald-300 transition">
          &larr; Try again
        </Link>
      </main>
    );
  }

  const { team, session } = found;
  const isActive = session.status === "active";

  const [portfolio, marketAssets, prices, pendingCsrPrompts, pendingAssetDecisions] = await Promise.all([
    getTeamPortfolio(team.id),
    isActive ? listInvestableAssets(session) : Promise.resolve([]),
    getCurrentAreaPrices(session),
    listPendingCsrPrompts(session.id, team.id),
    listPendingAssetDecisions(session, team.id),
  ]);

  return (
    <main className="min-h-screen p-6 md:p-8 max-w-4xl mx-auto space-y-8">
      <div>
        <p className="text-slate-400 text-sm">
          {session.name} &middot; Year {session.currentYear} &middot; {session.status}
        </p>
        <h1 className="text-2xl font-semibold mt-1">{team.name}</h1>
        <div className="flex gap-6 mt-2 text-sm">
          <p>
            Balance: <span className="font-mono text-lg">{team.balance.toLocaleString()}</span>
          </p>
          <p>
            Reputation: <span className="font-mono text-lg">{team.reputation.toLocaleString()}</span>
          </p>
        </div>
      </div>

      {!isActive && (
        <p className="rounded border border-amber-800 bg-amber-950/40 text-amber-300 text-sm p-3">
          This session is {session.status}, so investing is turned off. You can still see your portfolio below.
        </p>
      )}

      {pendingCsrPrompts.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-lg font-medium text-slate-200">Community response needed</h2>
          {pendingCsrPrompts.map((prompt) => {
            const photoUrl = eventPhotoUrl(prompt.photoPath);
            return (
            <div key={prompt.interventionEffectId} className="rounded border border-emerald-800 bg-emerald-950/20 p-4 space-y-3">
              <div>
                <p className="font-medium">{prompt.interventionName}</p>
                <p className="text-xs text-slate-400">Year {prompt.year} &middot; pick how your team responds</p>
              </div>
              {photoUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- a handful of small template photos, not worth next/image's config for this
                <img src={photoUrl} alt="" className="max-h-48 rounded border border-slate-800 object-cover" />
              )}
              <form action={respondCsrAction} className="space-y-3 text-sm">
                <input type="hidden" name="teamId" value={team.id} />
                <input type="hidden" name="teamCode" value={team.joinCode} />
                <input type="hidden" name="interventionEffectId" value={prompt.interventionEffectId} />
                <div className="space-y-1">
                  {prompt.choices.map((choice) => (
                    <label key={choice.id} className="flex items-start gap-2">
                      <input type="radio" name="choiceId" value={choice.id} required className="mt-1" />
                      <span>
                        {choice.text}
                        {choice.requiresAmount && (
                          <span className="text-slate-500"> &mdash; requires an amount below</span>
                        )}
                      </span>
                    </label>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-slate-400" htmlFor={`amount-${prompt.interventionEffectId}`}>
                    Amount (only if you picked an option that needs one):
                  </label>
                  <input
                    id={`amount-${prompt.interventionEffectId}`}
                    type="number"
                    name="amount"
                    min="0"
                    step="0.01"
                    className="w-32 rounded border border-slate-600 bg-slate-900 px-2 py-1"
                  />
                </div>
                <button
                  type="submit"
                  className="rounded bg-emerald-600 px-4 py-2 font-medium hover:bg-emerald-500 transition"
                >
                  Submit response
                </button>
              </form>
            </div>
            );
          })}
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-lg font-medium text-slate-200">Market prices</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
          {prices.map((p) => (
            <div key={p.areaId} className="rounded border border-slate-800 px-3 py-2">
              <p className="text-slate-400">{p.name}</p>
              <p className="font-mono">
                {p.price.toLocaleString()} / {p.productionUnit}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium text-slate-200">Your portfolio</h2>
        {portfolio.length === 0 ? (
          <p className="text-slate-400 text-sm">No investments yet &mdash; browse the market below.</p>
        ) : (
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400">
                <th className="py-2 font-normal">Asset</th>
                <th className="py-2 font-normal">Type</th>
                <th className="py-2 font-normal text-right">Acquired year</th>
              </tr>
            </thead>
            <tbody>
              {portfolio.map((inv) => (
                <tr key={inv.investmentId} className="border-b border-slate-900">
                  <td className="py-2">{inv.assetName}</td>
                  <td className="py-2 text-slate-400">{inv.assetType}</td>
                  <td className="py-2 text-right">{inv.acquiredYear}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {pendingAssetDecisions.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-lg font-medium text-slate-200">Decisions on your assets</h2>
          {pendingAssetDecisions.map((decision) => {
            const photoUrl = eventPhotoUrl(decision.options.find((o) => o.photoPath)?.photoPath ?? null);
            return (
              <div
                key={`${decision.assetId}-${decision.fireYear}`}
                className="rounded border border-amber-800 bg-amber-950/20 p-4 space-y-3"
              >
                <div>
                  <p className="font-medium">{decision.assetName}</p>
                  <p className="text-xs text-slate-400">
                    Takes effect year {decision.fireYear}
                    {decision.fireYear > session.currentYear ? " (next advance or later)" : ""}
                  </p>
                </div>
                {photoUrl && (
                  // eslint-disable-next-line @next/next/no-img-element -- a handful of small template photos, not worth next/image's config for this
                  <img src={photoUrl} alt="" className="max-h-48 rounded border border-slate-800 object-cover" />
                )}
                {decision.subject && (
                  <div
                    className="text-slate-300 text-sm [&_p]:my-1"
                    dangerouslySetInnerHTML={{ __html: stripInlineStyles(decision.subject) }}
                  />
                )}
                {decision.message && (
                  <div
                    className="text-slate-400 text-sm [&_p]:my-1"
                    dangerouslySetInnerHTML={{ __html: stripInlineStyles(decision.message) }}
                  />
                )}
                <form action={chooseAssetInterventionAction} className="space-y-2 text-sm">
                  <input type="hidden" name="teamId" value={team.id} />
                  <input type="hidden" name="teamCode" value={team.joinCode} />
                  <div className="space-y-1">
                    {decision.options.map((option) => (
                      <label key={option.assetInterventionId} className="flex items-start gap-2">
                        <input
                          type="radio"
                          name="assetInterventionId"
                          value={option.assetInterventionId}
                          required
                          className="mt-1"
                        />
                        <span>{option.choiceText ?? "(no description)"}</span>
                      </label>
                    ))}
                  </div>
                  <button
                    type="submit"
                    className="rounded bg-amber-700 px-4 py-2 font-medium hover:bg-amber-600 transition"
                  >
                    Confirm choice
                  </button>
                </form>
              </div>
            );
          })}
        </section>
      )}

      {isActive && (
        <section className="space-y-4">
          <h2 className="text-lg font-medium text-slate-200">Market &mdash; available assets</h2>
          <p className="text-xs text-slate-500">
            Estimated capex is for year {session.currentYear + 1}, the year your investment would take effect if you
            invest now. The actual charge is finalized when the facilitator advances the year, and can change if an
            event between now and then adjusts costs session-wide. An asset&apos;s access fee, if it has one, is
            different: it&apos;s deducted from your balance immediately when you click &ldquo;Invest,&rdquo; not at
            the next Advance year.
          </p>

          {marketAssets.length === 0 ? (
            <p className="text-slate-400 text-sm">No assets available to invest in right now.</p>
          ) : (
            <div className="space-y-4">
              {marketAssets.map((asset) => (
                <div key={asset.id} className="rounded border border-slate-800 p-4 space-y-3">
                  <div className="flex items-baseline justify-between gap-4 flex-wrap">
                    <div>
                      <p className="font-medium">{asset.name}</p>
                      <p className="text-xs text-slate-400">
                        {asset.assetType} &middot; capacity {asset.capacity.toLocaleString()}
                        {asset.capacityFactor != null &&
                          ` · ${(asset.capacityFactor * 100).toFixed(0)}% capacity factor`}
                      </p>
                    </div>
                    <div className="text-right">
                      {asset.estimatedCapex != null && (
                        <p className="text-sm font-mono text-slate-300">
                          Est. capex: {asset.estimatedCapex.toLocaleString()}
                        </p>
                      )}
                      {asset.accessCost > 0 && (
                        <p className="text-xs font-mono text-amber-400">
                          + {asset.accessCost.toLocaleString()} access fee, charged now
                        </p>
                      )}
                    </div>
                  </div>

                  {asset.description.map((paragraph, i) => (
                    <div
                      key={i}
                      className="text-sm text-slate-400 [&_p]:my-1"
                      dangerouslySetInnerHTML={{ __html: stripInlineStyles(paragraph) }}
                    />
                  ))}

                  <form action={investAction} className="space-y-2 text-sm">
                    <input type="hidden" name="teamId" value={team.id} />
                    <input type="hidden" name="teamCode" value={team.joinCode} />
                    <input type="hidden" name="assetId" value={asset.id} />

                    <div>
                      <p className="text-slate-400 mb-1">Financing</p>
                      <label className="flex items-center gap-2">
                        <input type="radio" name="financingOptionId" value="" defaultChecked />
                        No financing (pay full capex up front)
                      </label>
                      {asset.financingOptions.map((f) => (
                        <label key={f.id} className="flex items-center gap-2">
                          <input type="radio" name="financingOptionId" value={f.id} />
                          {f.lender}: {f.financedPercent}% financed at {f.interestRatePercent}% interest
                          {f.requiresSupport ? " (requires an offtake agreement)" : ""}
                        </label>
                      ))}
                    </div>

                    {asset.offtakeOptions.length > 0 && (
                      <div>
                        <p className="text-slate-400 mb-1">Offtake agreement</p>
                        <label className="flex items-center gap-2">
                          <input type="radio" name="offtakeOptionId" value="" defaultChecked />
                          None (sell at market price)
                        </label>
                        {asset.offtakeOptions.map((o) => (
                          <label key={o.id} className="flex items-center gap-2">
                            <input type="radio" name="offtakeOptionId" value={o.id} />
                            {o.name}
                            {o.supportPrice != null && ` — $${o.supportPrice}`}
                            {o.supportPeriod != null && ` for ${o.supportPeriod} years`}
                          </label>
                        ))}
                      </div>
                    )}

                    <button
                      type="submit"
                      className="rounded bg-emerald-600 px-4 py-2 font-medium hover:bg-emerald-500 transition"
                    >
                      Invest
                    </button>
                  </form>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
