export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-3xl font-semibold">New Energy 2050</h1>
      <p className="max-w-xl text-slate-300">
        This is the scaffold for the rewritten energy asset investment
        simulation. The facilitator console and team play screens are placeholders
        for now &mdash; Phase 2 builds the simulation engine that will drive them.
      </p>
      <div className="flex gap-4 mt-4">
        <a
          href="/facilitator"
          className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 transition"
        >
          Facilitator console
        </a>
        <a
          href="/play/demo"
          className="px-4 py-2 rounded bg-slate-700 hover:bg-slate-600 transition"
        >
          Team play screen (demo)
        </a>
      </div>
    </main>
  );
}
