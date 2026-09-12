-- New Energy 2050 — initial schema (Phase 1)
--
-- This replaces the old export's positional-array design (capex[i] / opex[i]
-- / production[i], where the array index secretly means "year") with
-- explicit per-year rows. Every table that varies over the game's timeline
-- has a `year` column (1 = the game's first year, e.g. 2026 in the
-- RENEWABLE TEMPLATE) instead of relying on array position.
--
-- Run with the Supabase CLI (`supabase db push`) once a Supabase project
-- exists, or paste into the SQL editor in the Supabase dashboard.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Templates: a reusable scenario (e.g. "ENERGY 2050 - RENEWABLE TEMPLATE").
-- A template is content only; playing it creates a game_session (below).
-- ---------------------------------------------------------------------------
create table game_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  map_image text,
  theme text,
  field_optimization boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Areas: the tradeable commodity markets (Oil, Natural Gas, Electricity, ...)
-- and the parameters that drive their simulated price path.
-- ---------------------------------------------------------------------------
create table areas (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references game_templates(id) on delete cascade,
  name text not null,
  type text not null, -- e.g. 'oil', 'gas', 'co2', 'el', 'hydrogen'
  production_unit text not null, -- e.g. 'bbl', 'Sm3', 'MWh', 'ton'
  randomize_price boolean not null default false,
  price_drift numeric not null default 0,
  price_standard_deviation numeric not null default 0,
  price_inflation numeric not null default 0,
  price_mean numeric not null,
  min_price numeric not null default 0,
  max_price numeric not null,
  merchant_price numeric not null,
  co2_emitted_per_production numeric not null default 0
);

-- ---------------------------------------------------------------------------
-- Assets: the investable units (oil fields, wind farms, batteries, ...).
-- Static/descriptive fields live here; anything that varies by year or by
-- market lives in the child tables below.
-- ---------------------------------------------------------------------------
create table assets (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references game_templates(id) on delete cascade,
  name text not null,
  asset_type text not null, -- e.g. 'oil', 'onshore_wind', 'battery', 'ccs'
  x_coordinate numeric,
  y_coordinate numeric,
  capacity numeric not null default 1,
  capacity_factor numeric,
  risk numeric not null default 0,
  minimum_access_cost numeric not null default 0,
  minimum_bid numeric not null default 0,
  is_visible boolean not null default true,
  is_exploration boolean not null default false,
  tax_type text, -- 'onshore' | 'offshore' | 'renewable'
  royalty boolean not null default false,
  electrification_start numeric,
  available_from_year integer,
  icon_name text,
  capex_icon_name text,
  map_name text,
  description text[] not null default '{}'
);

-- Per-year cost schedule for an asset. One row per (asset, year).
create table asset_year_financials (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references assets(id) on delete cascade,
  year integer not null,
  capex numeric not null default 0,
  opex numeric not null default 0,
  devex numeric not null default 0,
  unique (asset_id, year)
);

-- Per-year, per-market production for an asset. Most assets only ever have
-- rows for one area (a wind farm only produces Electricity); an oil
-- platform like the old export's "Amura" can have rows for both Oil and
-- Natural Gas in the same year.
create table asset_production (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references assets(id) on delete cascade,
  area_id uuid not null references areas(id) on delete cascade,
  year integer not null,
  production numeric not null default 0,
  unique (asset_id, area_id, year)
);

-- Loan options a team can choose when financing an asset purchase.
create table asset_financing_options (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references assets(id) on delete cascade,
  lender text not null,
  interest_rate_percent numeric not null,
  financed_percent numeric not null,
  requires_support boolean not null default false,
  down_payment_years integer not null default 0
);

-- Offtake / power-purchase-agreement options available to an asset.
create table asset_offtake_options (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references assets(id) on delete cascade,
  name text not null,
  offtake_type text not null, -- e.g. 'Fixed', 'Merchant'
  support_period integer,
  support_price numeric
);

-- ---------------------------------------------------------------------------
-- Interventions: scripted narrative events broadcast to all teams in a
-- given year. Most are story-only; `depends_on` lets one intervention be
-- conditional on another having already fired (e.g. a "resolved" event
-- depending on the event that started it).
-- ---------------------------------------------------------------------------
create table interventions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references game_templates(id) on delete cascade,
  key text not null, -- short machine name, e.g. 'global_labor_shortage'
  name text not null,
  year integer, -- null = unscheduled / randomly triggered
  recipients text not null default 'ALL',
  subject text,
  message text,
  photo_path text, -- path under content/seed/photos, see import script
  depends_on text[] not null default '{}', -- keys of prerequisite interventions
  created_at timestamptz not null default now()
);

-- A mechanical effect an intervention applies when it fires (as opposed to
-- the narrative subject/message, which is display-only). The old export
-- used a small vocabulary of effect types (SET_CO2_TAX_AMOUNT,
-- GLOBAL_CAPEX_INCREASE, OIL_PRICE_INCREASE, CSR_INTERVENTION, ...) with a
-- numeric amount and an optional target area. The engine (Phase 2) is what
-- gives these types real meaning; this table just stores them faithfully.
create table intervention_effects (
  id uuid primary key default gen_random_uuid(),
  intervention_id uuid not null references interventions(id) on delete cascade,
  effect_type text not null,
  amount numeric not null default 0,
  area_id uuid references areas(id)
);

-- CSR_INTERVENTION effects present the facilitator/team with a menu of
-- choices (e.g. "Long-Term Infrastructure Projects") rather than applying a
-- single fixed amount.
create table intervention_effect_choices (
  id uuid primary key default gen_random_uuid(),
  effect_id uuid not null references intervention_effects(id) on delete cascade,
  text text not null,
  choice_type text not null, -- 'POSITIVE' | 'NEGATIVE' | 'NONE'
  requires_amount boolean not null default false
);

-- ---------------------------------------------------------------------------
-- Asset interventions: per-asset decision points. Unlike interventions
-- these carry real financial effects when a team picks a choice, so they
-- get their own year-keyed financial/production child tables, same shape
-- as the asset tables above.
-- ---------------------------------------------------------------------------
create table asset_interventions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references game_templates(id) on delete cascade,
  asset_id uuid references assets(id) on delete set null,
  asset_name text, -- kept even if asset_id is null, for display/debugging
  name text not null,
  year integer,
  subject text,
  message text,
  choice_text text,
  photo_path text,
  is_additive boolean,
  capacity numeric,
  capacity_factor numeric,
  tax_type text,
  royalty boolean,
  electrification_time numeric,
  simulate_alternatives boolean not null default true,
  dependency text
);

create table asset_intervention_year_financials (
  id uuid primary key default gen_random_uuid(),
  asset_intervention_id uuid not null references asset_interventions(id) on delete cascade,
  year integer not null,
  capex numeric not null default 0,
  opex numeric not null default 0,
  devex numeric not null default 0,
  unique (asset_intervention_id, year)
);

create table asset_intervention_production (
  id uuid primary key default gen_random_uuid(),
  asset_intervention_id uuid not null references asset_interventions(id) on delete cascade,
  area_id uuid not null references areas(id) on delete cascade,
  year integer not null,
  production numeric not null default 0,
  unique (asset_intervention_id, area_id, year)
);

-- A choice can also shift a market price (the old export's "priceDiff").
create table asset_intervention_price_effects (
  id uuid primary key default gen_random_uuid(),
  asset_intervention_id uuid not null references asset_interventions(id) on delete cascade,
  area_id uuid not null references areas(id) on delete cascade,
  price_diff numeric not null,
  unique (asset_intervention_id, area_id)
);

-- ---------------------------------------------------------------------------
-- Sessions: one live, facilitated play-through of a template. Teams and
-- their state belong to a session, not to the template, so the same
-- template can be replayed many times.
-- ---------------------------------------------------------------------------
create table game_sessions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references game_templates(id) on delete restrict,
  name text not null,
  status text not null default 'setup', -- 'setup' | 'active' | 'completed'
  current_year integer not null default 0,
  created_at timestamptz not null default now()
);

create table teams (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references game_sessions(id) on delete cascade,
  name text not null,
  join_code text not null unique, -- short code teams use to reach their play screen
  starting_balance numeric not null default 0,
  balance numeric not null default 0,
  created_at timestamptz not null default now()
);

-- A team's stake in an asset within a session: what they bid, how it's
-- financed, and which offtake agreement they picked.
create table team_investments (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  asset_id uuid not null references assets(id) on delete restrict,
  acquired_year integer not null,
  capacity numeric,
  access_cost numeric not null default 0,
  bid numeric,
  local_content boolean not null default false,
  financing_option_id uuid references asset_financing_options(id),
  offtake_option_id uuid references asset_offtake_options(id),
  created_at timestamptz not null default now()
);

-- An auditable log of every balance change, so a team's cash position at
-- any past year can be reconstructed (and so the facilitator can debug a
-- disputed number live, mid-session).
create table team_balance_history (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  year integer not null,
  delta numeric not null,
  balance_after numeric not null,
  reason text not null, -- e.g. 'opex', 'capex', 'revenue', 'loan_interest'
  created_at timestamptz not null default now()
);

create index idx_areas_template on areas(template_id);
create index idx_assets_template on assets(template_id);
create index idx_asset_year_financials_asset on asset_year_financials(asset_id);
create index idx_asset_production_asset on asset_production(asset_id);
create index idx_interventions_template on interventions(template_id);
create index idx_intervention_effects_intervention on intervention_effects(intervention_id);
create index idx_asset_interventions_template on asset_interventions(template_id);
create index idx_asset_interventions_asset on asset_interventions(asset_id);
create index idx_teams_session on teams(session_id);
create index idx_team_investments_team on team_investments(team_id);
create index idx_team_balance_history_team on team_balance_history(team_id, year);
