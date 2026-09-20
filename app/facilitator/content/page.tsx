import Link from "next/link";

export const dynamic = "force-dynamic";

/**
 * Phase 6's lightweight content-editing path — a deliberately small slice
 * of what could be editable. See the README's Phase 6 section for exactly
 * what is and isn't covered and why.
 */
export default function ContentIndexPage() {
  return (
    <main className="min-h-screen p-8 max-w-2xl mx-auto space-y-8">
      <div>
        <Link href="/facilitator" className="text-sm text-slate-400 hover:text-slate-200 transition">
          &larr; Facilitator console
        </Link>
        <h1 className="text-2xl font-semibold mt-1">Edit content</h1>
        <p className="text-slate-400 mt-2">
          Changes here affect every session using the default template, including ones already in progress that
          haven&apos;t reached that event/asset yet. There&apos;s no undo &mdash; if you want to keep the original
          wording, copy it somewhere before changing it.
        </p>
      </div>

      <ul className="divide-y divide-slate-800 rounded border border-slate-800">
        <li>
          <Link
            href="/facilitator/content/events"
            className="flex items-center justify-between px-4 py-3 hover:bg-slate-900 transition"
          >
            <span>Event text</span>
            <span className="text-sm text-slate-400">Narrative shown when a broadcast event fires</span>
          </Link>
        </li>
        <li>
          <Link
            href="/facilitator/content/assets"
            className="flex items-center justify-between px-4 py-3 hover:bg-slate-900 transition"
          >
            <span>Asset basics</span>
            <span className="text-sm text-slate-400">Name, description, risk, access fee</span>
          </Link>
        </li>
      </ul>

      <p className="text-xs text-slate-500">
        Not editable here yet: per-year capex/opex/production numbers, financing and offtake options, and per-asset
        decision points &mdash; those stay a code change for now. Worth revisiting if hand-tuning those turns out to
        matter for balancing.
      </p>
    </main>
  );
}
