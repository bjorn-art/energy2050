/**
 * A Supabase client for the browser (Client Components only — never
 * imported by a Server Component, Server Action, or anything in
 * supabaseServer.ts/repository.ts). Uses the PUBLISHABLE/anon key, which is
 * safe to ship to the browser (unlike the service-role key in
 * supabaseServer.ts).
 *
 * Only used for Realtime subscriptions (see components/RealtimeRefresh.tsx)
 * — this client never reads or writes data directly, it just listens for
 * postgres_changes and tells the page to refetch through the normal
 * Server Component path. That keeps exactly one code path
 * (lib/db/repository.ts) responsible for shaping data out of the database.
 *
 * No RLS policies exist on any table yet (see supabaseServer.ts's
 * doc comment — same deliberate MVP tradeoff, confirmed with Bjorn as fine
 * while nothing sensitive is at stake). That means the anon key used here
 * can read the same rows the service-role key can. Worth revisiting before
 * a real public pilot if that ever changes.
 *
 * Returns null (rather than throwing) when the anon key isn't configured
 * yet, so a page that hasn't had NEXT_PUBLIC_SUPABASE_ANON_KEY set in
 * Vercel still works normally — it just needs a manual refresh instead of
 * updating live, same as before this existed.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cachedClient: SupabaseClient | null | undefined;

export function getSupabaseBrowserClient(): SupabaseClient | null {
  if (cachedClient !== undefined) return cachedClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    cachedClient = null;
    return null;
  }

  cachedClient = createClient(url, anonKey, {
    auth: { persistSession: false },
  });
  return cachedClient;
}
