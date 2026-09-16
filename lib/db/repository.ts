/**
 * Data access for the facilitator console — the only place in the app that
 * talks to Supabase. Everything here runs server-side only (see
 * supabaseServer.ts) and translates between the database's snake_case rows
 * and the camelCase shapes lib/engine/*.ts expects.
 *
 * IMPORTANT for reading this file: Postgres `numeric` columns come back
 * from Supabase/PostgREST as JSON strings, not numbers (PostgREST does
 * this everywhere to avoid silently losing precision on values a JS number
 * can't represent exactly). Every numeric column is wrapped in `Number()`
 * below for that reason — `integer`/`bigint`-as-safe-range columns (year,
 * current_year, down_payment_years, support_period) don't need it.
 */

import { createRng } from "../engine/rng";
import { generateAllPricePaths } from "../engine/prices";
import { advanceYear } from "../engine/yearAdvance";
import type {
  Area,
  AssetFinancingOption,
  AssetOfftakeOption,
  AssetProduction,
  AssetYearFinancials,
  InterventionEffect,
} from "../engine/types";
import type {
  AssetDataLookup,
  SessionYearInput,
  TeamInvestmentState,
  TeamState,
  YearAdvanceResult,
} from "../engine/yearAdvance";
import { getSupabaseServerClient } from "./supabaseServer";

function round2(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? 0 : rounded; // normalize -0, matching lib/engine's convention
}

/**
 * How many years of prices to simulate up front for a session. Generous
 * relative to the Renewable Template's data (its longest asset schedule is
 * 25 years) so a session never runs out of room mid-play.
 */
export const PRICE_HORIZON_YEARS = 30;

/**
 * TODO(Bjorn): placeholder starting balance for every team — pick whatever
 * number makes sense for how you want early-game investing to feel. Easy
 * to change here (or move to a per-session setting later) without
 * touching anything else.
 */
export const STARTING_BALANCE = 1000;

export type SessionSummary = {
  id: string;
  name: string;
  status: string;
  currentYear: number;
  createdAt: string;
};

export type SessionDetail = {
  id: string;
  name: string;
  status: string;
  currentYear: number;
  templateId: string;
  priceSeed: number;
  capexMultiplier: number;
  taxRates: Record<string, number>;
};

export type TeamSummary = {
  id: string;
  name: string;
  joinCode: string;
  balance: number;
  reputation: number;
};

export type FiredIntervention = {
  id: string;
  name: string;
  subject: string | null;
  message: string | null;
};

export type AdvanceYearResult = {
  year: number;
  teams: YearAdvanceResult["teams"];
  firedInterventions: FiredIntervention[];
  /** Effect types that fired but aren't automatically applied yet (e.g. CSR_INTERVENTION — see lib/engine/csr.ts). Worth showing the facilitator so nothing silently vanishes. */
  unmodeledEffectTypes: string[];
};

// ---------------------------------------------------------------------------
// Phase 4: team play screen types
// ---------------------------------------------------------------------------

export type TeamWithSession = {
  team: TeamSummary;
  session: SessionDetail;
};

export type OwnedInvestment = {
  investmentId: string;
  assetId: string;
  assetName: string;
  assetType: string;
  acquiredYear: number;
  financingOptionId: string | null;
  offtakeOptionId: string | null;
};

export type InvestableAsset = {
  id: string;
  name: string;
  assetType: string;
  capacity: number;
  capacityFactor: number | null;
  risk: number;
  description: string[];
  taxType: string | null;
  /**
   * Capex for the year this investment would take effect (session's current
   * year + 1), adjusted for the session's current capexMultiplier — the
   * same formula lib/engine/yearAdvance.ts uses. Shown so a team isn't
   * investing blind, but it's an estimate: an intervention firing between
   * now and the actual "Advance year" click could still change
   * capexMultiplier before the real charge happens. Null if this asset has
   * no financials row for that year (e.g. its schedule hasn't started yet).
   */
  estimatedCapex: number | null;
  financingOptions: AssetFinancingOption[];
  offtakeOptions: AssetOfftakeOption[];
};

export type AreaPrice = {
  areaId: string;
  name: string;
  productionUnit: string;
  price: number;
};

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

/** There's only one template loaded for now (the Renewable Template) — this returns it. */
export async function getDefaultTemplate(): Promise<{ id: string; name: string } | null> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("game_templates")
    .select("id, name")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Failed to load template: ${error.message}`);
  return data;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export async function listSessions(): Promise<SessionSummary[]> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("game_sessions")
    .select("id, name, status, current_year, created_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Failed to load sessions: ${error.message}`);
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    currentYear: row.current_year,
    createdAt: row.created_at,
  }));
}

export async function createSession(name: string): Promise<string> {
  const supabase = getSupabaseServerClient();
  const template = await getDefaultTemplate();
  if (!template) throw new Error("No template loaded yet — run the import script first.");

  const priceSeed = Math.floor(Math.random() * 2 ** 31);

  const { data, error } = await supabase
    .from("game_sessions")
    .insert({
      template_id: template.id,
      name,
      status: "active",
      current_year: 0,
      price_seed: priceSeed,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Failed to create session: ${error.message}`);
  return data.id as string;
}

export async function getSession(sessionId: string): Promise<SessionDetail | null> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("game_sessions")
    .select("id, name, status, current_year, template_id, price_seed, capex_multiplier, tax_rates")
    .eq("id", sessionId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load session: ${error.message}`);
  if (!data) return null;
  return {
    id: data.id,
    name: data.name,
    status: data.status,
    currentYear: data.current_year,
    templateId: data.template_id,
    priceSeed: Number(data.price_seed),
    capexMultiplier: Number(data.capex_multiplier),
    taxRates: (data.tax_rates ?? {}) as Record<string, number>,
  };
}

export async function listTeams(sessionId: string): Promise<TeamSummary[]> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("teams")
    .select("id, name, join_code, balance, reputation")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Failed to load teams: ${error.message}`);
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    joinCode: row.join_code,
    balance: Number(row.balance),
    reputation: Number(row.reputation),
  }));
}

export type YearLogEntry = {
  year: number;
  firedInterventionIds: string[];
  unmodeledEffectTypes: string[];
};

export async function getYearLog(sessionId: string): Promise<YearLogEntry[]> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("session_year_log")
    .select("year, fired_intervention_ids, unmodeled_effect_types")
    .eq("session_id", sessionId)
    .order("year", { ascending: true });
  if (error) throw new Error(`Failed to load year log: ${error.message}`);
  return (data ?? []).map((row) => ({
    year: row.year,
    firedInterventionIds: row.fired_intervention_ids ?? [],
    unmodeledEffectTypes: row.unmodeled_effect_types ?? [],
  }));
}

export async function getInterventionsByIds(ids: string[]): Promise<FiredIntervention[]> {
  if (ids.length === 0) return [];
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("interventions")
    .select("id, name, subject, message")
    .in("id", ids);
  if (error) throw new Error(`Failed to load interventions: ${error.message}`);
  return (data ?? []).map((row) => ({ id: row.id, name: row.name, subject: row.subject, message: row.message }));
}

/**
 * Excludes visually-ambiguous characters (0/O, 1/I/L) so teams can read a
 * code off a screen or whiteboard without mixing them up. join_code is
 * globally unique across every session (schema constraint), so addTeam
 * retries a few times on collision before giving up.
 */
function generateJoinCode(): string {
  const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i++) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return code;
}

export async function addTeam(sessionId: string, name: string): Promise<TeamSummary> {
  const supabase = getSupabaseServerClient();

  for (let attempt = 0; attempt < 5; attempt++) {
    const joinCode = generateJoinCode();
    const { data, error } = await supabase
      .from("teams")
      .insert({
        session_id: sessionId,
        name,
        join_code: joinCode,
        starting_balance: STARTING_BALANCE,
        balance: STARTING_BALANCE,
      })
      .select("id, name, join_code, balance, reputation")
      .single();

    if (!error && data) {
      return {
        id: data.id,
        name: data.name,
        joinCode: data.join_code,
        balance: Number(data.balance),
        reputation: Number(data.reputation),
      };
    }
    // 23505 = Postgres unique_violation (join_code collision) — retry with a new code. Anything else is a real error.
    if (error && error.code !== "23505") {
      throw new Error(`Failed to add team: ${error.message}`);
    }
  }
  throw new Error("Couldn't generate a unique join code after several attempts — try again.");
}

// ---------------------------------------------------------------------------
// Phase 4: team play screen
// ---------------------------------------------------------------------------

/** Looks up a team by the join code printed on its facilitator-issued card. Case-insensitive (join codes are generated uppercase, but typed input shouldn't have to match case exactly). */
export async function getTeamByJoinCode(joinCode: string): Promise<TeamWithSession | null> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("teams")
    .select("id, name, join_code, balance, reputation, session_id")
    .eq("join_code", joinCode.toUpperCase())
    .maybeSingle();
  if (error) throw new Error(`Failed to look up team: ${error.message}`);
  if (!data) return null;

  const session = await getSession(data.session_id);
  if (!session) return null; // shouldn't happen (foreign key), but don't crash the team's screen over it

  return {
    team: {
      id: data.id,
      name: data.name,
      joinCode: data.join_code,
      balance: Number(data.balance),
      reputation: Number(data.reputation),
    },
    session,
  };
}

export async function getTeamPortfolio(teamId: string): Promise<OwnedInvestment[]> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("team_investments")
    .select("id, asset_id, acquired_year, financing_option_id, offtake_option_id")
    .eq("team_id", teamId)
    .order("acquired_year", { ascending: true });
  if (error) throw new Error(`Failed to load portfolio: ${error.message}`);
  const investments = data ?? [];
  if (investments.length === 0) return [];

  const assetIds = [...new Set(investments.map((row) => row.asset_id as string))];
  const { data: assetRows, error: assetsError } = await supabase
    .from("assets")
    .select("id, name, asset_type")
    .in("id", assetIds);
  if (assetsError) throw new Error(`Failed to load asset names: ${assetsError.message}`);
  const assetById = new Map<string, { name: string; asset_type: string }>(
    (assetRows ?? []).map((row) => [row.id, { name: row.name, asset_type: row.asset_type }]),
  );

  return investments.map((row): OwnedInvestment => {
    const asset = assetById.get(row.asset_id);
    return {
      investmentId: row.id,
      assetId: row.asset_id,
      assetName: asset?.name ?? "Unknown asset",
      assetType: asset?.asset_type ?? "",
      acquiredYear: row.acquired_year,
      financingOptionId: row.financing_option_id,
      offtakeOptionId: row.offtake_option_id,
    };
  });
}

/**
 * Asset ids already claimed by any team in this session (not just the
 * calling team) — Phase 4's MVP assumption is that an asset is exclusive
 * within a session, first team to invest gets it, matching "browse and
 * invest" rather than the competitive-bidding mechanic the source data's
 * `minimum_bid`/`bid` columns hint the original platform had. Worth
 * confirming with Bjorn whether that's actually the intended mechanic; easy
 * to relax later since nothing else depends on exclusivity.
 */
async function listInvestedAssetIds(sessionId: string): Promise<Set<string>> {
  const supabase = getSupabaseServerClient();
  const teamRows = await supabase.from("teams").select("id").eq("session_id", sessionId);
  if (teamRows.error) throw new Error(`Failed to load teams: ${teamRows.error.message}`);
  const teamIds = (teamRows.data ?? []).map((row) => row.id as string);
  if (teamIds.length === 0) return new Set();

  const { data, error } = await supabase.from("team_investments").select("asset_id").in("team_id", teamIds);
  if (error) throw new Error(`Failed to load existing investments: ${error.message}`);
  return new Set((data ?? []).map((row) => row.asset_id as string));
}

/**
 * Assets a team can currently invest in: visible ones (`is_visible` — the
 * source data hides most oil assets from teams by default) from this
 * session's template, minus anything already claimed by any team in the
 * session (see listInvestedAssetIds).
 */
export async function listInvestableAssets(session: SessionDetail): Promise<InvestableAsset[]> {
  const supabase = getSupabaseServerClient();
  const nextYear = session.currentYear + 1;

  const [assetsRes, investedIds] = await Promise.all([
    supabase
      .from("assets")
      .select("id, name, asset_type, capacity, capacity_factor, risk, tax_type, description")
      .eq("template_id", session.templateId)
      .eq("is_visible", true),
    listInvestedAssetIds(session.id),
  ]);
  if (assetsRes.error) throw new Error(`Failed to load assets: ${assetsRes.error.message}`);

  const assets = (assetsRes.data ?? []).filter((row) => !investedIds.has(row.id as string));
  if (assets.length === 0) return [];

  const assetIds = assets.map((row) => row.id as string);

  const [financialsRes, financingRes, offtakeRes] = await Promise.all([
    supabase.from("asset_year_financials").select("asset_id, capex").in("asset_id", assetIds).eq("year", nextYear),
    supabase
      .from("asset_financing_options")
      .select("id, asset_id, lender, interest_rate_percent, financed_percent, requires_support, down_payment_years")
      .in("asset_id", assetIds),
    supabase
      .from("asset_offtake_options")
      .select("id, asset_id, name, offtake_type, support_period, support_price")
      .in("asset_id", assetIds),
  ]);
  if (financialsRes.error) throw new Error(`Failed to load asset financials: ${financialsRes.error.message}`);
  if (financingRes.error) throw new Error(`Failed to load financing options: ${financingRes.error.message}`);
  if (offtakeRes.error) throw new Error(`Failed to load offtake options: ${offtakeRes.error.message}`);

  const nextYearCapexByAsset = new Map<string, number>();
  for (const row of financialsRes.data ?? []) {
    nextYearCapexByAsset.set(row.asset_id, Number(row.capex));
  }

  const financingByAsset = new Map<string, AssetFinancingOption[]>();
  for (const row of financingRes.data ?? []) {
    const option: AssetFinancingOption = {
      id: row.id,
      assetId: row.asset_id,
      lender: row.lender,
      interestRatePercent: Number(row.interest_rate_percent),
      financedPercent: Number(row.financed_percent),
      requiresSupport: row.requires_support,
      downPaymentYears: row.down_payment_years,
    };
    if (!financingByAsset.has(row.asset_id)) financingByAsset.set(row.asset_id, []);
    financingByAsset.get(row.asset_id)!.push(option);
  }

  const offtakeByAsset = new Map<string, AssetOfftakeOption[]>();
  for (const row of offtakeRes.data ?? []) {
    const option: AssetOfftakeOption = {
      id: row.id,
      assetId: row.asset_id,
      name: row.name,
      offtakeType: row.offtake_type,
      supportPeriod: row.support_period,
      supportPrice: row.support_price == null ? null : Number(row.support_price),
    };
    if (!offtakeByAsset.has(row.asset_id)) offtakeByAsset.set(row.asset_id, []);
    offtakeByAsset.get(row.asset_id)!.push(option);
  }

  return assets
    .map((row): InvestableAsset => {
      const rawCapex = nextYearCapexByAsset.get(row.id as string);
      return {
        id: row.id,
        name: row.name,
        assetType: row.asset_type,
        capacity: Number(row.capacity),
        capacityFactor: row.capacity_factor == null ? null : Number(row.capacity_factor),
        risk: Number(row.risk),
        description: row.description ?? [],
        taxType: row.tax_type,
        estimatedCapex: rawCapex == null ? null : round2(rawCapex * (1 + session.capexMultiplier)),
        financingOptions: financingByAsset.get(row.id) ?? [],
        offtakeOptions: offtakeByAsset.get(row.id) ?? [],
      };
    })
    .sort((a, b) => a.assetType.localeCompare(b.assetType) || a.name.localeCompare(b.name));
}

/**
 * This year's reference market prices, for the team screen to show
 * alongside the asset list — the last year actually advanced (or year 1's
 * starting price, before anything has been advanced yet). Recomputed from
 * the session's price_seed rather than read from a stored table, same
 * approach advanceSessionYear uses (see the file header for why: no
 * session_area_prices table, prices regenerate deterministically from the
 * seed every time they're needed).
 */
export async function getCurrentAreaPrices(session: SessionDetail): Promise<AreaPrice[]> {
  const areas = await loadAreas(session.templateId);
  const rng = createRng(session.priceSeed);
  const pricePaths = generateAllPricePaths(areas, PRICE_HORIZON_YEARS, rng);
  const yearIndex = Math.max(session.currentYear, 1) - 1;
  return areas
    .map(
      (area): AreaPrice => ({
        areaId: area.id,
        name: area.name,
        productionUnit: area.productionUnit,
        price: pricePaths.get(area.id)?.[yearIndex] ?? area.priceMean,
      }),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Records a team's decision to invest in an asset. This ONLY writes a
 * team_investments row — it does not touch the team's balance or write any
 * team_balance_history rows. Every actual money movement (the down payment,
 * loan payments, revenue, tax, opex, devex) stays exclusively inside
 * lib/engine's advanceYear, run by advanceSessionYear below, so there's a
 * single place that ever moves a team's balance. Concretely: investing now
 * records the choice; nothing is charged until the facilitator next clicks
 * "Advance year," same as the acquisition-year capex/down-payment/loan
 * mechanics already implemented in yearAdvance.ts.
 *
 * `acquired_year` is set to the session's *next* year (currentYear + 1) —
 * the year that will be advanced to next — since that's the first year
 * yearAdvance.ts will actually charge this investment's capex.
 *
 * NOTE for Bjorn: `assets.minimum_access_cost` is recorded on the row (for
 * later use / bookkeeping) but not charged here or anywhere yet — whether
 * it should be an immediate fee on investing, folded into capex, or dropped
 * entirely is a game-design call, not something the source export's raw
 * column name settles on its own.
 */
export async function createInvestment(input: {
  teamId: string;
  assetId: string;
  financingOptionId: string | null;
  offtakeOptionId: string | null;
}): Promise<void> {
  const supabase = getSupabaseServerClient();

  const { data: teamRow, error: teamError } = await supabase
    .from("teams")
    .select("id, session_id")
    .eq("id", input.teamId)
    .maybeSingle();
  if (teamError) throw new Error(`Failed to load team: ${teamError.message}`);
  if (!teamRow) throw new Error("Team not found.");

  const session = await getSession(teamRow.session_id);
  if (!session) throw new Error("Session not found.");
  if (session.status !== "active") throw new Error("This session isn't active — investing is turned off.");

  // Check-then-insert, not a hard database guarantee (team_investments.asset_id
  // isn't session-scoped in the schema, since the same asset can legitimately
  // belong to different teams across different sessions) — good enough for a
  // facilitated live session where two teams clicking "Invest" on the same
  // asset in the same instant is unlikely, and this client has no way to run
  // a real transaction anyway (see advanceSessionYear's own note on this).
  const alreadyInvested = await listInvestedAssetIds(session.id);
  if (alreadyInvested.has(input.assetId)) {
    throw new Error("Another team has already invested in this asset.");
  }

  const { data: assetRow, error: assetError } = await supabase
    .from("assets")
    .select("id, capacity, minimum_access_cost, template_id")
    .eq("id", input.assetId)
    .maybeSingle();
  if (assetError) throw new Error(`Failed to load asset: ${assetError.message}`);
  if (!assetRow) throw new Error("Asset not found.");
  if (assetRow.template_id !== session.templateId) {
    throw new Error("This asset doesn't belong to this session's template.");
  }

  const { error: insertError } = await supabase.from("team_investments").insert({
    team_id: input.teamId,
    asset_id: input.assetId,
    acquired_year: session.currentYear + 1,
    capacity: Number(assetRow.capacity),
    access_cost: Number(assetRow.minimum_access_cost),
    financing_option_id: input.financingOptionId,
    offtake_option_id: input.offtakeOptionId,
  });
  if (insertError) throw new Error(`Failed to record investment: ${insertError.message}`);
}

// ---------------------------------------------------------------------------
// Template content, loaded into the shapes lib/engine expects
// ---------------------------------------------------------------------------

async function loadAreas(templateId: string): Promise<Area[]> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.from("areas").select("*").eq("template_id", templateId);
  if (error) throw new Error(`Failed to load areas: ${error.message}`);
  return (data ?? []).map(
    (row): Area => ({
      id: row.id,
      templateId: row.template_id,
      name: row.name,
      type: row.type,
      productionUnit: row.production_unit,
      randomizePrice: row.randomize_price,
      priceDrift: Number(row.price_drift),
      priceStandardDeviation: Number(row.price_standard_deviation),
      priceInflation: Number(row.price_inflation),
      priceMean: Number(row.price_mean),
      minPrice: Number(row.min_price),
      maxPrice: Number(row.max_price),
      merchantPrice: Number(row.merchant_price),
      co2EmittedPerProduction: Number(row.co2_emitted_per_production),
    }),
  );
}

/**
 * Loads every asset's year financials/production/financing/offtake/tax_type
 * for a template into memory, and wraps it as the AssetDataLookup interface
 * lib/engine/yearAdvance.ts expects. Built once per Advance Year request and
 * reused across every team, since the underlying content is the same for
 * all of them — a template doesn't vary by team.
 */
async function loadAssetDataLookup(templateId: string): Promise<AssetDataLookup> {
  const supabase = getSupabaseServerClient();

  const { data: assets, error: assetsError } = await supabase
    .from("assets")
    .select("id, tax_type")
    .eq("template_id", templateId);
  if (assetsError) throw new Error(`Failed to load assets: ${assetsError.message}`);

  const assetIds = (assets ?? []).map((a) => a.id as string);
  const taxTypeByAsset = new Map<string, string | null>((assets ?? []).map((a) => [a.id, a.tax_type]));

  if (assetIds.length === 0) {
    // No assets for this template — return an always-empty lookup rather
    // than sending `.in("asset_id", [])` queries (some PostgREST/postgrest-js
    // versions turn an empty `in` list into invalid SQL).
    return {
      financialsFor: () => undefined,
      productionFor: () => [],
      financingOptionById: () => undefined,
      offtakeOptionById: () => undefined,
      taxTypeFor: () => null,
    };
  }

  const [financialsRes, productionRes, financingRes, offtakeRes] = await Promise.all([
    supabase.from("asset_year_financials").select("asset_id, year, capex, opex, devex").in("asset_id", assetIds),
    supabase.from("asset_production").select("asset_id, area_id, year, production").in("asset_id", assetIds),
    supabase
      .from("asset_financing_options")
      .select("id, asset_id, lender, interest_rate_percent, financed_percent, requires_support, down_payment_years")
      .in("asset_id", assetIds),
    supabase
      .from("asset_offtake_options")
      .select("id, asset_id, name, offtake_type, support_period, support_price")
      .in("asset_id", assetIds),
  ]);
  if (financialsRes.error) throw new Error(`Failed to load asset financials: ${financialsRes.error.message}`);
  if (productionRes.error) throw new Error(`Failed to load asset production: ${productionRes.error.message}`);
  if (financingRes.error) throw new Error(`Failed to load financing options: ${financingRes.error.message}`);
  if (offtakeRes.error) throw new Error(`Failed to load offtake options: ${offtakeRes.error.message}`);

  const financialsByAssetYear = new Map<string, Map<number, AssetYearFinancials>>();
  for (const row of financialsRes.data ?? []) {
    const financials: AssetYearFinancials = {
      assetId: row.asset_id,
      year: row.year,
      capex: Number(row.capex),
      opex: Number(row.opex),
      devex: Number(row.devex),
    };
    if (!financialsByAssetYear.has(row.asset_id)) financialsByAssetYear.set(row.asset_id, new Map());
    financialsByAssetYear.get(row.asset_id)!.set(row.year, financials);
  }

  const productionByAssetYear = new Map<string, Map<number, AssetProduction[]>>();
  for (const row of productionRes.data ?? []) {
    const production: AssetProduction = {
      assetId: row.asset_id,
      areaId: row.area_id,
      year: row.year,
      production: Number(row.production),
    };
    if (!productionByAssetYear.has(row.asset_id)) productionByAssetYear.set(row.asset_id, new Map());
    const byYear = productionByAssetYear.get(row.asset_id)!;
    if (!byYear.has(row.year)) byYear.set(row.year, []);
    byYear.get(row.year)!.push(production);
  }

  const financingById = new Map<string, AssetFinancingOption>();
  for (const row of financingRes.data ?? []) {
    financingById.set(row.id, {
      id: row.id,
      assetId: row.asset_id,
      lender: row.lender,
      interestRatePercent: Number(row.interest_rate_percent),
      financedPercent: Number(row.financed_percent),
      requiresSupport: row.requires_support,
      downPaymentYears: row.down_payment_years,
    });
  }

  const offtakeById = new Map<string, AssetOfftakeOption>();
  for (const row of offtakeRes.data ?? []) {
    offtakeById.set(row.id, {
      id: row.id,
      assetId: row.asset_id,
      name: row.name,
      offtakeType: row.offtake_type,
      supportPeriod: row.support_period,
      supportPrice: row.support_price == null ? null : Number(row.support_price),
    });
  }

  return {
    financialsFor: (assetId, year) => financialsByAssetYear.get(assetId)?.get(year),
    productionFor: (assetId, year) => productionByAssetYear.get(assetId)?.get(year) ?? [],
    financingOptionById: (id) => financingById.get(id),
    offtakeOptionById: (id) => offtakeById.get(id),
    taxTypeFor: (assetId) => taxTypeByAsset.get(assetId) ?? null,
  };
}

/** Every team's investments in a session, grouped by team_id — used to populate TeamState.investments for advanceSessionYear. */
async function loadTeamInvestments(teamIds: string[]): Promise<Map<string, TeamInvestmentState[]>> {
  const result = new Map<string, TeamInvestmentState[]>();
  if (teamIds.length === 0) return result;

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("team_investments")
    .select("id, team_id, asset_id, acquired_year, financing_option_id, offtake_option_id")
    .in("team_id", teamIds);
  if (error) throw new Error(`Failed to load team investments: ${error.message}`);

  for (const row of data ?? []) {
    const investment: TeamInvestmentState = {
      investmentId: row.id,
      assetId: row.asset_id,
      acquiredYear: row.acquired_year,
      financingOptionId: row.financing_option_id,
      offtakeOptionId: row.offtake_option_id,
    };
    if (!result.has(row.team_id)) result.set(row.team_id, []);
    result.get(row.team_id)!.push(investment);
  }
  return result;
}

async function loadInterventionsForYear(
  templateId: string,
  year: number,
): Promise<{ firedInterventions: FiredIntervention[]; effects: InterventionEffect[] }> {
  const supabase = getSupabaseServerClient();
  const { data: interventions, error } = await supabase
    .from("interventions")
    .select("id, name, subject, message")
    .eq("template_id", templateId)
    .eq("year", year);
  if (error) throw new Error(`Failed to load interventions: ${error.message}`);
  if (!interventions || interventions.length === 0) return { firedInterventions: [], effects: [] };

  const interventionIds = interventions.map((iv) => iv.id as string);
  const { data: effectRows, error: effectsError } = await supabase
    .from("intervention_effects")
    .select("id, intervention_id, effect_type, amount, area_id")
    .in("intervention_id", interventionIds);
  if (effectsError) throw new Error(`Failed to load intervention effects: ${effectsError.message}`);

  const effects: InterventionEffect[] = (effectRows ?? []).map((row) => ({
    id: row.id,
    interventionId: row.intervention_id,
    effectType: row.effect_type,
    amount: Number(row.amount),
    areaId: row.area_id,
  }));

  const firedInterventions: FiredIntervention[] = interventions.map((iv) => ({
    id: iv.id,
    name: iv.name,
    subject: iv.subject,
    message: iv.message,
  }));

  return { firedInterventions, effects };
}

// ---------------------------------------------------------------------------
// Advancing a year
// ---------------------------------------------------------------------------

/**
 * Runs the engine's advanceYear for every team in a session and persists
 * the result: new session state (year, capex multiplier, tax rates), new
 * team balances, a team_balance_history row per transaction, and a
 * session_year_log row recording which interventions fired.
 *
 * As of Phase 4, each team's real team_investments rows are loaded and
 * passed in (see loadTeamInvestments), so this is where an investment made
 * on the team screen actually starts moving money: the first "Advance year"
 * click at or after an investment's acquired_year charges its down payment/
 * full capex, and every year after that charges opex/devex/revenue/tax/loan
 * payments per lib/engine/yearAdvance.ts. Before Phase 4, this list was
 * always empty, which is why nothing moved money in the Phase 3 delivery.
 */
export async function advanceSessionYear(sessionId: string): Promise<AdvanceYearResult> {
  const supabase = getSupabaseServerClient();

  const session = await getSession(sessionId);
  if (!session) throw new Error("Session not found.");

  const targetYear = session.currentYear + 1;
  if (targetYear > PRICE_HORIZON_YEARS) {
    throw new Error(`This session has reached its ${PRICE_HORIZON_YEARS}-year horizon and can't advance further.`);
  }

  const [areas, lookup, interventionData, teamRows] = await Promise.all([
    loadAreas(session.templateId),
    loadAssetDataLookup(session.templateId),
    loadInterventionsForYear(session.templateId, targetYear),
    supabase.from("teams").select("id, balance").eq("session_id", sessionId),
  ]);
  if (teamRows.error) throw new Error(`Failed to load teams: ${teamRows.error.message}`);

  const rng = createRng(session.priceSeed);
  const pricePaths = generateAllPricePaths(areas, PRICE_HORIZON_YEARS, rng);
  const basePrices = new Map<string, number>();
  for (const area of areas) {
    basePrices.set(area.id, pricePaths.get(area.id)?.[targetYear - 1] ?? area.priceMean);
  }

  const areaIdByName = new Map(areas.map((a) => [a.name, a.id] as const));

  const teamIds = (teamRows.data ?? []).map((row) => row.id as string);
  const investmentsByTeam = await loadTeamInvestments(teamIds);

  const teams: TeamState[] = (teamRows.data ?? []).map((row) => ({
    teamId: row.id,
    balance: Number(row.balance),
    investments: investmentsByTeam.get(row.id) ?? [],
  }));

  const input: SessionYearInput = {
    year: targetYear,
    basePrices,
    capexMultiplier: session.capexMultiplier,
    taxRatesByAssetTaxType: new Map(Object.entries(session.taxRates)),
    interventionEffects: interventionData.effects,
    areaIdByName,
    teams,
  };

  const result = advanceYear(input, lookup);

  // Not wrapped in a database transaction (PostgREST/supabase-js doesn't
  // expose one from the client). If something fails partway through, the
  // session row's current_year/capex_multiplier/tax_rates are the source
  // of truth for "did this year actually advance" — re-running the whole
  // advance is safe up to that point since advanceYear() itself is a pure
  // computation and doesn't touch the database.
  const taxRatesObject = Object.fromEntries(result.taxRatesByAssetTaxType);

  const { error: sessionUpdateError } = await supabase
    .from("game_sessions")
    .update({
      current_year: targetYear,
      capex_multiplier: result.capexMultiplier,
      tax_rates: taxRatesObject,
    })
    .eq("id", sessionId);
  if (sessionUpdateError) throw new Error(`Failed to save session state: ${sessionUpdateError.message}`);

  for (const teamResult of result.teams) {
    const { error: teamUpdateError } = await supabase
      .from("teams")
      .update({ balance: teamResult.balanceAfter })
      .eq("id", teamResult.teamId);
    if (teamUpdateError) throw new Error(`Failed to save team balance: ${teamUpdateError.message}`);

    if (teamResult.transactions.length > 0) {
      const { error: historyError } = await supabase.from("team_balance_history").insert(
        teamResult.transactions.map((t) => ({
          team_id: teamResult.teamId,
          year: targetYear,
          delta: t.delta,
          balance_after: t.balanceAfter,
          reason: t.reason,
        })),
      );
      if (historyError) throw new Error(`Failed to save balance history: ${historyError.message}`);
    }
  }

  const unmodeledEffectTypes = [...new Set(result.unmodeledEffects.map((e) => e.effectType))];

  const { error: logError } = await supabase.from("session_year_log").insert({
    session_id: sessionId,
    year: targetYear,
    fired_intervention_ids: interventionData.firedInterventions.map((iv) => iv.id),
    unmodeled_effect_types: unmodeledEffectTypes,
  });
  if (logError) throw new Error(`Failed to save year log: ${logError.message}`);

  return {
    year: targetYear,
    teams: result.teams,
    firedInterventions: interventionData.firedInterventions,
    unmodeledEffectTypes,
  };
}
