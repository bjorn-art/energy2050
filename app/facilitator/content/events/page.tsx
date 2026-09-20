import Link from "next/link";
import { listEditableInterventions } from "../../../../lib/db/repository";
import { updateInterventionAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function EditEventsPage() {
  const interventions = await listEditableInterventions();

  return (
    <main className="min-h-screen p-8 max-w-3xl mx-auto space-y-6">
      <div>
        <Link href="/facilitator/content" className="text-sm text-slate-400 hover:text-slate-200 transition">
          &larr; Edit content
        </Link>
        <h1 className="text-2xl font-semibold mt-1">Event text</h1>
        <p className="text-slate-400 mt-2 text-sm">
          Subject is the short headline shown at the top of an event; message is the longer body text. Plain text is
          fine &mdash; type over what&apos;s there. (The stored text can technically hold HTML formatting from the
          original import; typing plain text here replaces that with plain paragraphs, which is expected.)
        </p>
      </div>

      {interventions.length === 0 ? (
        <p className="text-slate-400 text-sm">No scheduled events found.</p>
      ) : (
        <div className="space-y-4">
          {interventions.map((iv) => (
            <details key={iv.id} className="rounded border border-slate-800 p-4" open={false}>
              <summary className="cursor-pointer font-medium">
                Year {iv.year} &middot; {iv.name}
              </summary>
              <form action={updateInterventionAction} className="mt-4 space-y-3 text-sm">
                <input type="hidden" name="id" value={iv.id} />
                <div className="space-y-1">
                  <label className="text-slate-400" htmlFor={`subject-${iv.id}`}>
                    Subject
                  </label>
                  <textarea
                    id={`subject-${iv.id}`}
                    name="subject"
                    defaultValue={iv.subject ?? ""}
                    rows={2}
                    className="w-full rounded border border-slate-600 bg-slate-900 px-3 py-2"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-slate-400" htmlFor={`message-${iv.id}`}>
                    Message
                  </label>
                  <textarea
                    id={`message-${iv.id}`}
                    name="message"
                    defaultValue={iv.message ?? ""}
                    rows={5}
                    className="w-full rounded border border-slate-600 bg-slate-900 px-3 py-2"
                  />
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
