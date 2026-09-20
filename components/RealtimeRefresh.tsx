"use client";

/**
 * Mount this once per page that should update live instead of needing a
 * manual browser refresh — the facilitator's session page, a team's play
 * page, and the public results page. It renders nothing; it just listens
 * for database changes on the given tables (via Supabase Realtime) and
 * calls router.refresh() so Next.js re-runs the page's normal Server
 * Component data-fetching path. This deliberately doesn't try to patch
 * state in the browser — one source of truth (the server render), same as
 * every other page in this app.
 *
 * If NEXT_PUBLIC_SUPABASE_ANON_KEY isn't set yet (see
 * lib/db/supabaseBrowser.ts), this silently does nothing — the page still
 * works exactly as it did before, just without the live updates.
 */

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "../lib/db/supabaseBrowser";

export type RealtimeWatch = {
  table: string;
  /** A PostgREST-style filter, e.g. `id=eq.${sessionId}` — narrows the subscription to just the rows this page cares about. */
  filter?: string;
};

export function RealtimeRefresh({ channelName, watch }: { channelName: string; watch: RealtimeWatch[] }) {
  const router = useRouter();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return; // anon key not configured — no-op, page still works with a manual refresh

    let channel = supabase.channel(channelName);
    for (const w of watch) {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: w.table, filter: w.filter },
        () => {
          // Advancing a year (or answering a CSR/decision prompt) touches
          // several tables in one go — wait a beat and refresh once rather
          // than once per row change.
          if (debounceRef.current) clearTimeout(debounceRef.current);
          debounceRef.current = setTimeout(() => router.refresh(), 400);
        },
      );
    }
    channel.subscribe();

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      supabase.removeChannel(channel);
    };
    // channelName/watch are constructed fresh from stable ids each render;
    // re-subscribing on every render would thrash the socket for no reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelName]);

  return null;
}
