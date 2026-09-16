import { loginAction } from "./actions";

export const dynamic = "force-dynamic";

export default function FacilitatorLoginPage({
  searchParams,
}: {
  searchParams: { error?: string; next?: string };
}) {
  const nextPath = searchParams.next ?? "/facilitator";

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <form action={loginAction} className="w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-semibold">Facilitator login</h1>
        <input type="hidden" name="next" value={nextPath} />
        <input
          type="password"
          name="password"
          placeholder="Facilitator password"
          autoFocus
          className="w-full rounded border border-slate-600 bg-slate-900 px-3 py-2 text-foreground"
        />
        {searchParams.error === "wrong-password" && (
          <p className="text-sm text-red-400">That password isn&apos;t right &mdash; try again.</p>
        )}
        {searchParams.error === "not-configured" && (
          <p className="text-sm text-red-400">
            No facilitator password is set yet. Add a <code>FACILITATOR_PASSWORD</code> environment variable in
            Vercel (Project Settings &rarr; Environment Variables) and redeploy.
          </p>
        )}
        <button
          type="submit"
          className="w-full rounded bg-emerald-600 px-3 py-2 font-medium hover:bg-emerald-500 transition"
        >
          Log in
        </button>
      </form>
    </main>
  );
}
