import Link from "next/link";
import { listEditableAssets } from "../../../../lib/db/repository";
import { updateAssetAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function EditAssetsPage() {
  const assets = await listEditableAssets();

  return (
    <main className="min-h-screen p-8 max-w-3xl mx-auto space-y-6">
      <div>
        <Link href="/facilitator/content" className="text-sm text-slate-400 hover:text-slate-200 transition">
          &larr; Edit content
        </Link>
        <h1 className="text-2xl font-semibold mt-1">Asset basics</h1>
        <p className="text-slate-400 mt-2 text-sm">
          Description: one paragraph per line &mdash; each line becomes its own paragraph on a team&apos;s market
          screen, blank lines are dropped. Risk is shown to teams as a plain number (whatever scale you&apos;ve been
          using). Access fee is charged immediately when a team invests, on top of capex.
        </p>
      </div>

      {assets.length === 0 ? (
        <p className="text-slate-400 text-sm">No assets found.</p>
      ) : (
        <div className="space-y-4">
          {assets.map((asset) => (
            <details key={asset.id} className="rounded border border-slate-800 p-4">
              <summary className="cursor-pointer font-medium">
                {asset.name} <span className="text-slate-500 font-normal">&middot; {asset.assetType}</span>
              </summary>
              <form action={updateAssetAction} className="mt-4 space-y-3 text-sm">
                <input type="hidden" name="id" value={asset.id} />
                <div className="space-y-1">
                  <label className="text-slate-400" htmlFor={`name-${asset.id}`}>
                    Name
                  </label>
                  <input
                    id={`name-${asset.id}`}
                    name="name"
                    type="text"
                    defaultValue={asset.name}
                    required
                    className="w-full rounded border border-slate-600 bg-slate-900 px-3 py-2"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-slate-400" htmlFor={`description-${asset.id}`}>
                    Description
                  </label>
                  <textarea
                    id={`description-${asset.id}`}
                    name="description"
                    defaultValue={asset.description.join("\n")}
                    rows={4}
                    className="w-full rounded border border-slate-600 bg-slate-900 px-3 py-2"
                  />
                </div>
                <div className="flex gap-4">
                  <div className="space-y-1">
                    <label className="text-slate-400" htmlFor={`risk-${asset.id}`}>
                      Risk
                    </label>
                    <input
                      id={`risk-${asset.id}`}
                      name="risk"
                      type="number"
                      step="0.01"
                      defaultValue={asset.risk}
                      className="w-32 rounded border border-slate-600 bg-slate-900 px-3 py-2"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-slate-400" htmlFor={`access-${asset.id}`}>
                      Access fee
                    </label>
                    <input
                      id={`access-${asset.id}`}
                      name="minimumAccessCost"
                      type="number"
                      step="0.01"
                      defaultValue={asset.minimumAccessCost}
                      className="w-40 rounded border border-slate-600 bg-slate-900 px-3 py-2"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  className="rounded bg-emerald-600 px-4 py-2 font-medium hover:bg-emerald-500 transition"
                >
                  Save
                </button>
              </form>
            </details>
          ))}
        </div>
      )}
    </main>
  );
}
