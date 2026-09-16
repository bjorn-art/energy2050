/**
 * A Supabase client for server-only code (Server Components, Server
 * Actions, route handlers — never a Client Component, never anything that
 * ships to the browser).
 *
 * This uses the SECRET/service-role key, not the publishable/anon key —
 * deliberately, so the facilitator console's database access doesn't need
 * Row Level Security policies designed yet. The service-role key bypasses
 * RLS entirely, which is fine as long as every file that imports this one
 * only ever runs on the server (Next.js keeps server-only modules out of
 * the browser bundle as long as nothing marked "use client" imports them —
 * this file, lib/db/repository.ts, and the server actions that call it are
 * the only things that should ever touch this client).
 *
 * A new client per call is intentionally cheap here — there's no
 * connection pool to manage on the client side, @supabase/supabase-js just
 * wraps fetch().
 */

import { createClient } from "@supabase/supabase-js";

export function getSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Set both in your environment (.env.local locally, Project Settings -> Environment Variables on Vercel).",
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });
}
