-- Phase 6: polish.

-- Starting balance becomes a per-session setting, picked on the "Create
-- session" form, instead of a hardcoded constant in the code (see the
-- TODO that used to sit next to STARTING_BALANCE in lib/db/repository.ts).
-- Existing sessions get the same 1000 default every team has always
-- started with, so nothing changes for sessions already in progress.
alter table game_sessions
  add column starting_balance numeric not null default 1000;

-- Realtime: lets the browser subscribe directly to these tables (through
-- the publishable/anon key) so the facilitator console, a team's screen,
-- and the results view update live instead of needing a manual refresh.
-- No RLS policies exist on any table yet (a deliberate MVP choice made
-- back in Phase 3 — see supabaseServer.ts's doc comment), so the anon key
-- can already read everything the service-role key can; this migration
-- doesn't change that, it only turns on the live-update feed for tables
-- that change during a session.
--
-- Each ADD TABLE is wrapped in its own exception handler so this migration
-- is safe to run more than once (re-adding a table already in the
-- publication would otherwise error the whole script).
do $$
begin
  begin
    alter publication supabase_realtime add table public.game_sessions;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.teams;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.session_year_log;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.team_balance_history;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.team_csr_responses;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.team_asset_intervention_choices;
  exception when duplicate_object then null;
  end;
end $$;
