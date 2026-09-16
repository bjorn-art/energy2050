-- Phase 3 — facilitator console: fields and a small log table the
-- year-advance engine (lib/engine/yearAdvance.ts) needs to carry state
-- across requests for a live session.
--
-- Run this the same way you ran 00000000000001_init.sql: paste it into the
-- Supabase dashboard's SQL editor and run it (or `supabase db push` if
-- you're using the CLI). Safe to run once, after the Phase 1 schema.

-- A CSR_INTERVENTION choice (see lib/engine/csr.ts) moves this. Nothing
-- writes to it yet — that lands once the facilitator console can actually
-- present a CSR choice to a team.
alter table teams add column reputation numeric not null default 0;

-- The seed for this session's simulated price path (lib/engine/prices.ts).
-- Generated once when the session is created and never changes, so the
-- app can always regenerate the exact same price path for any year without
-- having to store every year's price for every area.
alter table game_sessions add column price_seed bigint;

-- Carried forward year to year by yearAdvance.ts's SessionYearInput /
-- YearAdvanceResult, same fields as lib/engine/interventions.ts's
-- MarketState: capex_multiplier is the running additive adjustment from
-- GLOBAL_CAPEX_INCREASE-type effects, tax_rates is a JSON object of
-- asset tax_type -> revenue tax rate (e.g. {"onshore": 0.05}).
alter table game_sessions add column capex_multiplier numeric not null default 0;
alter table game_sessions add column tax_rates jsonb not null default '{}'::jsonb;

-- Which interventions fired in which year of which session, so the
-- facilitator can scroll back through a session's history rather than
-- only ever seeing the result of the most recent "Advance Year" click.
create table session_year_log (
  session_id uuid not null references game_sessions(id) on delete cascade,
  year integer not null,
  fired_intervention_ids uuid[] not null default '{}',
  -- Effect types that fired this year but aren't automatically applied yet
  -- (currently just CSR_INTERVENTION — see lib/engine/csr.ts) so the
  -- facilitator can see "something happened here that needs a manual
  -- follow-up" instead of it silently vanishing from the history.
  unmodeled_effect_types text[] not null default '{}',
  created_at timestamptz not null default now(),
  primary key (session_id, year)
);
