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
import type { AssetDataLookup, SessionYearInput, TeamState, YearAdvanceResult } from "../engine/yearAdvance";
import { getSupabaseServerClient } from "./supabaseServer";

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
 * Phase 3 has no team investments yet (team_investments is written by
 * Phase 4), so every team's `investments` list is empty here — this proves
 * the session/team/intervention machinery works end-to-end against real
 * data, but no money actually moves yet unless an intervention's effect
 * happens to touch something. That's expected, not a bug.
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

  const teams: TeamState[] = (teamRows.data ?? []).map((row) => ({
    teamId: row.id,
    balance: Number(row.balance),
    investments: [],
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
