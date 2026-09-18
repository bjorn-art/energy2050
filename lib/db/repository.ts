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
import { applyCsrChoice, type CsrChoiceType } from "../engine/csr";
import type {
  Area,
  AssetFinancingOption,
  AssetIntervention,
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
  photoPath: string | null;
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
   * Charged immediately, in full, the moment a team clicks "Invest" —
   * separate from (and in addition to) capex, which isn't charged until the
   * facilitator next advances the year. Confirmed with Bjorn (2026-09-17).
   */
  accessCost: number;
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
    .select("id, name, subject, message, photo_path")
    .in("id", ids);
  if (error) throw new Error(`Failed to load interventions: ${error.message}`);
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    subject: row.subject,
    message: row.message,
    photoPath: row.photo_path,
  }));
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
      .select("id, name, asset_type, capacity, capacity_factor, risk, tax_type, description, minimum_access_cost")
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
        accessCost: round2(Number(row.minimum_access_cost)),
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
 * Records a team's decision to invest in an asset, and charges that asset's
 * `minimum_access_cost` as an immediate fee (confirmed with Bjorn, 2026-09-17
 * — see the three flagged Phase 4 assumptions in the project's architecture
 * doc). This is the one exception to "only advanceSessionYear ever moves a
 * team's balance": the access cost is charged right here, at the moment of
 * investing, not deferred to the next "Advance year." Every OTHER money
 * movement (down payment, loan payments, revenue, tax, opex, devex) still
 * stays exclusively inside lib/engine's advanceYear, run by
 * advanceSessionYear below.
 *
 * `acquired_year` is set to the session's *next* year (currentYear + 1) —
 * the year that will be advanced to next — since that's the first year
 * yearAdvance.ts will actually charge this investment's capex. The access
 * cost transaction is logged against the session's *current* year (not
 * yet-advanced), since it happens now, before that next year exists.
 *
 * Not wrapped in a database transaction, same caveat as advanceSessionYear —
 * PostgREST/supabase-js doesn't expose one from this client. If the balance
 * update or history insert fails after the investment row is written, the
 * investment is recorded but the fee wasn't charged; safe to re-run manually
 * (there's no fee double-charge risk since a re-invest attempt on an
 * already-owned asset isn't possible — see the exclusivity check below).
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
    .select("id, session_id, balance")
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

  const accessCost = round2(Number(assetRow.minimum_access_cost));

  const { error: insertError } = await supabase.from("team_investments").insert({
    team_id: input.teamId,
    asset_id: input.assetId,
    acquired_year: session.currentYear + 1,
    capacity: Number(assetRow.capacity),
    access_cost: accessCost,
    financing_option_id: input.financingOptionId,
    offtake_option_id: input.offtakeOptionId,
  });
  if (insertError) throw new Error(`Failed to record investment: ${insertError.message}`);

  if (accessCost !== 0) {
    const balanceBefore = Number(teamRow.balance);
    const balanceAfter = round2(balanceBefore - accessCost);

    const { error: balanceError } = await supabase
      .from("teams")
      .update({ balance: balanceAfter })
      .eq("id", input.teamId);
    if (balanceError) throw new Error(`Failed to charge access cost: ${balanceError.message}`);

    const { error: historyError } = await supabase.from("team_balance_history").insert({
      team_id: input.teamId,
      year: session.currentYear,
      delta: round2(-accessCost),
      balance_after: balanceAfter,
      reason: "access_cost",
    });
    if (historyError) throw new Error(`Failed to log access cost charge: ${historyError.message}`);
  }
}

// ---------------------------------------------------------------------------
// Phase 5: CSR choices
// ---------------------------------------------------------------------------

export type CsrChoiceOption = {
  id: string;
  text: string;
  choiceType: CsrChoiceType;
  requiresAmount: boolean;
};

export type PendingCsrPrompt = {
  interventionEffectId: string;
  interventionId: string;
  interventionName: string;
  photoPath: string | null;
  /** The game year this event actually fired in this session. */
  year: number;
  choices: CsrChoiceOption[];
};

/**
 * CSR_INTERVENTION effects that have fired in this team's session (per
 * session_year_log) but this team hasn't answered yet (no team_csr_responses
 * row for it). The real Renewable Template only has 3 of these across the
 * whole game, so in practice this is a short list, if not empty.
 */
export async function listPendingCsrPrompts(sessionId: string, teamId: string): Promise<PendingCsrPrompt[]> {
  const supabase = getSupabaseServerClient();

  const { data: logRows, error: logError } = await supabase
    .from("session_year_log")
    .select("year, fired_intervention_ids")
    .eq("session_id", sessionId);
  if (logError) throw new Error(`Failed to load year log: ${logError.message}`);

  const yearByInterventionId = new Map<string, number>();
  for (const row of logRows ?? []) {
    for (const id of row.fired_intervention_ids ?? []) {
      yearByInterventionId.set(id, row.year);
    }
  }
  const firedInterventionIds = [...yearByInterventionId.keys()];
  if (firedInterventionIds.length === 0) return [];

  const [effectsRes, respondedRes] = await Promise.all([
    supabase
      .from("intervention_effects")
      .select("id, intervention_id")
      .eq("effect_type", "CSR_INTERVENTION")
      .in("intervention_id", firedInterventionIds),
    supabase.from("team_csr_responses").select("intervention_effect_id").eq("team_id", teamId),
  ]);
  if (effectsRes.error) throw new Error(`Failed to load CSR effects: ${effectsRes.error.message}`);
  if (respondedRes.error) throw new Error(`Failed to load CSR responses: ${respondedRes.error.message}`);

  const respondedIds = new Set((respondedRes.data ?? []).map((row) => row.intervention_effect_id as string));
  const pendingEffects = (effectsRes.data ?? []).filter((row) => !respondedIds.has(row.id as string));
  if (pendingEffects.length === 0) return [];

  const interventionIds = [...new Set(pendingEffects.map((row) => row.intervention_id as string))];
  const effectIds = pendingEffects.map((row) => row.id as string);

  const [interventionsRes, choicesRes] = await Promise.all([
    supabase.from("interventions").select("id, name, photo_path").in("id", interventionIds),
    supabase
      .from("intervention_effect_choices")
      .select("id, effect_id, text, choice_type, requires_amount")
      .in("effect_id", effectIds),
  ]);
  if (interventionsRes.error) throw new Error(`Failed to load interventions: ${interventionsRes.error.message}`);
  if (choicesRes.error) throw new Error(`Failed to load CSR choices: ${choicesRes.error.message}`);

  const nameByIntervention = new Map<string, string>((interventionsRes.data ?? []).map((row) => [row.id, row.name]));
  const photoByIntervention = new Map<string, string | null>(
    (interventionsRes.data ?? []).map((row) => [row.id, row.photo_path]),
  );

  const choicesByEffect = new Map<string, CsrChoiceOption[]>();
  for (const row of choicesRes.data ?? []) {
    const option: CsrChoiceOption = {
      id: row.id,
      text: row.text,
      choiceType: row.choice_type as CsrChoiceType,
      requiresAmount: row.requires_amount,
    };
    if (!choicesByEffect.has(row.effect_id)) choicesByEffect.set(row.effect_id, []);
    choicesByEffect.get(row.effect_id)!.push(option);
  }

  return pendingEffects
    .map(
      (row): PendingCsrPrompt => ({
        interventionEffectId: row.id,
        interventionId: row.intervention_id,
        interventionName: nameByIntervention.get(row.intervention_id) ?? "Untitled event",
        photoPath: photoByIntervention.get(row.intervention_id) ?? null,
        year: yearByInterventionId.get(row.intervention_id) ?? 0,
        choices: choicesByEffect.get(row.id) ?? [],
      }),
    )
    .sort((a, b) => a.year - b.year);
}

/**
 * Records a team's answer to a CSR_INTERVENTION prompt and applies its
 * balance/reputation effect immediately (lib/engine/csr.ts's
 * applyCsrChoice) — the one other exception, alongside Phase 4's
 * access-cost fee, to "only advanceSessionYear moves a team's balance."
 * Check-then-insert against team_csr_responses' unique
 * (team_id, intervention_effect_id) pair guards against answering the same
 * prompt twice (same caveat as every other check-then-insert in this file:
 * good enough for a facilitated live session, not a real transaction).
 */
export async function respondToCsr(input: {
  teamId: string;
  interventionEffectId: string;
  choiceId: string;
  amount: number;
}): Promise<void> {
  const supabase = getSupabaseServerClient();

  const { data: teamRow, error: teamError } = await supabase
    .from("teams")
    .select("id, session_id, balance, reputation")
    .eq("id", input.teamId)
    .maybeSingle();
  if (teamError) throw new Error(`Failed to load team: ${teamError.message}`);
  if (!teamRow) throw new Error("Team not found.");

  const { data: existing, error: existingError } = await supabase
    .from("team_csr_responses")
    .select("id")
    .eq("team_id", input.teamId)
    .eq("intervention_effect_id", input.interventionEffectId)
    .maybeSingle();
  if (existingError) throw new Error(`Failed to check for an existing response: ${existingError.message}`);
  if (existing) throw new Error("This team has already answered this prompt.");

  const { data: effectRow, error: effectError } = await supabase
    .from("intervention_effects")
    .select("id, intervention_id, effect_type")
    .eq("id", input.interventionEffectId)
    .maybeSingle();
  if (effectError) throw new Error(`Failed to load the CSR effect: ${effectError.message}`);
  if (!effectRow || effectRow.effect_type !== "CSR_INTERVENTION") throw new Error("This isn't a CSR prompt.");

  const { data: choiceRow, error: choiceError } = await supabase
    .from("intervention_effect_choices")
    .select("id, effect_id, choice_type, requires_amount")
    .eq("id", input.choiceId)
    .maybeSingle();
  if (choiceError) throw new Error(`Failed to load the chosen option: ${choiceError.message}`);
  if (!choiceRow || choiceRow.effect_id !== input.interventionEffectId) {
    throw new Error("That option doesn't belong to this prompt.");
  }

  // Which year this intervention actually fired in this team's session, for
  // the audit trail (team_csr_responses.year / team_balance_history.year).
  const { data: logRows, error: logError } = await supabase
    .from("session_year_log")
    .select("year, fired_intervention_ids")
    .eq("session_id", teamRow.session_id);
  if (logError) throw new Error(`Failed to load year log: ${logError.message}`);
  const firedYear = (logRows ?? []).find((row) =>
    (row.fired_intervention_ids ?? []).includes(effectRow.intervention_id),
  )?.year;
  if (firedYear === undefined) throw new Error("This event hasn't fired in this session yet.");

  const choiceType = choiceRow.choice_type as CsrChoiceType;
  const amount = choiceRow.requires_amount ? Math.max(0, round2(Number(input.amount))) : 0;
  const { balanceDelta, reputationDelta } = applyCsrChoice(choiceType, amount);

  const balanceAfter = round2(Number(teamRow.balance) + balanceDelta);
  const reputationAfter = round2(Number(teamRow.reputation) + reputationDelta);

  const { error: teamUpdateError } = await supabase
    .from("teams")
    .update({ balance: balanceAfter, reputation: reputationAfter })
    .eq("id", input.teamId);
  if (teamUpdateError) throw new Error(`Failed to update team: ${teamUpdateError.message}`);

  if (balanceDelta !== 0) {
    const { error: historyError } = await supabase.from("team_balance_history").insert({
      team_id: input.teamId,
      year: firedYear,
      delta: balanceDelta,
      balance_after: balanceAfter,
      reason: "csr",
    });
    if (historyError) throw new Error(`Failed to log the CSR spend: ${historyError.message}`);
  }

  const { error: insertError } = await supabase.from("team_csr_responses").insert({
    team_id: input.teamId,
    intervention_effect_id: input.interventionEffectId,
    choice_id: input.choiceId,
    choice_type: choiceType,
    amount,
    balance_delta: balanceDelta,
    reputation_delta: reputationDelta,
    year: firedYear,
  });
  if (insertError) throw new Error(`Failed to record the response: ${insertError.message}`);
}

// ---------------------------------------------------------------------------
// Phase 5: per-asset decision points
// ---------------------------------------------------------------------------

export type AssetDecisionOption = {
  assetInterventionId: string;
  choiceText: string | null;
  photoPath: string | null;
};

export type AssetDecision = {
  assetId: string;
  assetName: string;
  /** The game year this decision actually takes effect if picked now (owning team's acquiredYear + the decision's own relative year - 1). */
  fireYear: number;
  subject: string | null;
  message: string | null;
  options: AssetDecisionOption[];
};

/**
 * Per-asset decision points (asset_interventions) available for a team to
 * answer right now: tied to an asset this team owns, not yet answered, not
 * gated behind an earlier choice the team hasn't made, and due within the
 * next year. A "decision" is a group of asset_interventions rows sharing
 * the same (asset_id, year) — see the Phase 5 migration's comment on why
 * the source data represents a multi-option decision as sibling rows
 * instead of one row with a list.
 */
export async function listPendingAssetDecisions(session: SessionDetail, teamId: string): Promise<AssetDecision[]> {
  const supabase = getSupabaseServerClient();

  const { data: investmentRows, error: investmentsError } = await supabase
    .from("team_investments")
    .select("asset_id, acquired_year")
    .eq("team_id", teamId);
  if (investmentsError) throw new Error(`Failed to load team investments: ${investmentsError.message}`);
  const ownedAssets = investmentRows ?? [];
  if (ownedAssets.length === 0) return [];

  const acquiredYearByAsset = new Map<string, number>(
    ownedAssets.map((row) => [row.asset_id as string, row.acquired_year as number]),
  );
  const assetIds = [...acquiredYearByAsset.keys()];

  const [assetInterventionsRes, chosenRes] = await Promise.all([
    supabase
      .from("asset_interventions")
      .select("id, asset_id, asset_name, year, subject, message, choice_text, photo_path, dependency")
      .in("asset_id", assetIds),
    supabase.from("team_asset_intervention_choices").select("asset_intervention_id").eq("team_id", teamId),
  ]);
  if (assetInterventionsRes.error) {
    throw new Error(`Failed to load asset decisions: ${assetInterventionsRes.error.message}`);
  }
  if (chosenRes.error) throw new Error(`Failed to load chosen decisions: ${chosenRes.error.message}`);

  const chosenIds = new Set((chosenRes.data ?? []).map((row) => row.asset_intervention_id as string));
  const rows = (assetInterventionsRes.data ?? []).filter((row) => row.year != null);

  type GroupRow = (typeof rows)[number];
  const groups = new Map<string, GroupRow[]>();
  for (const row of rows) {
    const key = `${row.asset_id}|${row.year}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  const decisions: AssetDecision[] = [];
  for (const groupRows of groups.values()) {
    const first = groupRows[0];
    if (!first) continue;
    const assetId = first.asset_id as string;
    const acquiredYear = acquiredYearByAsset.get(assetId);
    if (acquiredYear == null) continue; // guards the type below; shouldn't happen since assetIds came from this same map
    const decisionYear = first.year as number;
    const fireYear = acquiredYear + decisionYear - 1;

    // Not due yet — shown starting one year ahead of when it actually takes
    // effect, matching how an investable asset's next-year capex is shown
    // before the team commits, so a decision isn't sprung on them the same
    // moment it's charged.
    if (fireYear > session.currentYear + 1) continue;

    // Already resolved — the team picked one of this group's options.
    if (groupRows.some((row) => chosenIds.has(row.id as string))) continue;

    // Gated behind a specific earlier option the team hasn't chosen yet
    // (see the Phase 5 delivery notes on the `dependency` field).
    const dependency = groupRows.find((row) => row.dependency)?.dependency as string | null | undefined;
    if (dependency && !chosenIds.has(dependency)) continue;

    const subjectRow = groupRows.find((row) => row.subject);
    const messageRow = groupRows.find((row) => row.message);
    const photoRow = groupRows.find((row) => row.photo_path);

    decisions.push({
      assetId,
      assetName: first.asset_name ?? "Unknown asset",
      fireYear,
      subject: subjectRow?.subject ?? null,
      message: messageRow?.message ?? null,
      options: [...groupRows]
        .sort((a, b) => (a.choice_text ?? "").localeCompare(b.choice_text ?? ""))
        .map((row) => ({
          assetInterventionId: row.id as string,
          choiceText: row.choice_text,
          photoPath: row.photo_path ?? photoRow?.photo_path ?? null,
        })),
    });
  }

  return decisions.sort((a, b) => a.fireYear - b.fireYear);
}

/**
 * Records a team's pick for a per-asset decision point. Doesn't touch the
 * team's balance directly, same spirit as Phase 4's investment choice: the
 * actual capex/opex/devex/production/price effect only starts counting the
 * next time the facilitator advances the year (see resolveAssetYear in
 * lib/engine/yearAdvance.ts), and even then only from the decision's own
 * fire year on, which can be later than the year it was picked in.
 */
export async function chooseAssetIntervention(input: { teamId: string; assetInterventionId: string }): Promise<void> {
  const supabase = getSupabaseServerClient();

  const { data: decisionRow, error: decisionError } = await supabase
    .from("asset_interventions")
    .select("id, asset_id, year, dependency")
    .eq("id", input.assetInterventionId)
    .maybeSingle();
  if (decisionError) throw new Error(`Failed to load the decision: ${decisionError.message}`);
  if (!decisionRow) throw new Error("Decision not found.");

  const { data: investmentRow, error: investmentError } = await supabase
    .from("team_investments")
    .select("id")
    .eq("team_id", input.teamId)
    .eq("asset_id", decisionRow.asset_id)
    .maybeSingle();
  if (investmentError) throw new Error(`Failed to verify ownership: ${investmentError.message}`);
  if (!investmentRow) throw new Error("This team doesn't own that asset.");

  // Check-then-insert against the whole (asset_id, year) group, not just
  // this row — a team can only pick ONE option for a given decision (same
  // caveat as every other check-then-insert in this file: good enough for a
  // facilitated live session, not a real transaction).
  const { data: groupRows, error: groupError } = await supabase
    .from("asset_interventions")
    .select("id")
    .eq("asset_id", decisionRow.asset_id)
    .eq("year", decisionRow.year);
  if (groupError) throw new Error(`Failed to check this decision's options: ${groupError.message}`);
  const groupIds = (groupRows ?? []).map((row) => row.id as string);

  const { data: alreadyChosen, error: chosenError } = await supabase
    .from("team_asset_intervention_choices")
    .select("asset_intervention_id")
    .eq("team_id", input.teamId)
    .in("asset_intervention_id", groupIds);
  if (chosenError) throw new Error(`Failed to check for an existing choice: ${chosenError.message}`);
  if ((alreadyChosen ?? []).length > 0) throw new Error("This team already picked an option for this decision.");

  if (decisionRow.dependency) {
    const { data: dependencyChoice, error: dependencyError } = await supabase
      .from("team_asset_intervention_choices")
      .select("id")
      .eq("team_id", input.teamId)
      .eq("asset_intervention_id", decisionRow.dependency)
      .maybeSingle();
    if (dependencyError) throw new Error(`Failed to check this decision's prerequisite: ${dependencyError.message}`);
    if (!dependencyChoice) throw new Error("This decision isn't unlocked yet.");
  }

  const { error: insertError } = await supabase.from("team_asset_intervention_choices").insert({
    team_id: input.teamId,
    asset_intervention_id: input.assetInterventionId,
  });
  if (insertError) throw new Error(`Failed to record the choice: ${insertError.message}`);
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

  // Per-asset decision points (Phase 5) — loaded by template, same as
  // everything else here, since which ones a team has actually CHOSEN is
  // team-specific state carried separately on each TeamInvestmentState
  // (see loadTeamInvestments), not something this shared lookup needs to
  // know.
  const { data: assetInterventionRows, error: assetInterventionsError } = await supabase
    .from("asset_interventions")
    .select(
      "id, template_id, asset_id, asset_name, name, year, subject, message, choice_text, photo_path, is_additive, capacity, capacity_factor, tax_type, royalty, electrification_time, simulate_alternatives, dependency",
    )
    .eq("template_id", templateId);
  if (assetInterventionsError) {
    throw new Error(`Failed to load asset interventions: ${assetInterventionsError.message}`);
  }
  const assetInterventionIds = (assetInterventionRows ?? []).map((row) => row.id as string);

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
      assetInterventionById: () => undefined,
      assetInterventionFinancialsFor: () => undefined,
      assetInterventionProductionFor: () => [],
      assetInterventionPriceDiffs: () => new Map(),
    };
  }

  const [financialsRes, productionRes, financingRes, offtakeRes, aiFinancialsRes, aiProductionRes, aiPriceEffectsRes] =
    await Promise.all([
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
      assetInterventionIds.length === 0
        ? Promise.resolve({ data: [], error: null })
        : supabase
            .from("asset_intervention_year_financials")
            .select("asset_intervention_id, year, capex, opex, devex")
            .in("asset_intervention_id", assetInterventionIds),
      assetInterventionIds.length === 0
        ? Promise.resolve({ data: [], error: null })
        : supabase
            .from("asset_intervention_production")
            .select("asset_intervention_id, area_id, year, production")
            .in("asset_intervention_id", assetInterventionIds),
      assetInterventionIds.length === 0
        ? Promise.resolve({ data: [], error: null })
        : supabase
            .from("asset_intervention_price_effects")
            .select("asset_intervention_id, area_id, price_diff")
            .in("asset_intervention_id", assetInterventionIds),
    ]);
  if (financialsRes.error) throw new Error(`Failed to load asset financials: ${financialsRes.error.message}`);
  if (productionRes.error) throw new Error(`Failed to load asset production: ${productionRes.error.message}`);
  if (financingRes.error) throw new Error(`Failed to load financing options: ${financingRes.error.message}`);
  if (offtakeRes.error) throw new Error(`Failed to load offtake options: ${offtakeRes.error.message}`);
  if (aiFinancialsRes.error) {
    throw new Error(`Failed to load asset intervention financials: ${aiFinancialsRes.error.message}`);
  }
  if (aiProductionRes.error) {
    throw new Error(`Failed to load asset intervention production: ${aiProductionRes.error.message}`);
  }
  if (aiPriceEffectsRes.error) {
    throw new Error(`Failed to load asset intervention price effects: ${aiPriceEffectsRes.error.message}`);
  }

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

  const assetInterventionById = new Map<string, AssetIntervention>(
    (assetInterventionRows ?? []).map((row) => [
      row.id,
      {
        id: row.id,
        templateId: row.template_id,
        assetId: row.asset_id,
        assetName: row.asset_name,
        name: row.name,
        year: row.year,
        subject: row.subject,
        message: row.message,
        choiceText: row.choice_text,
        photoPath: row.photo_path,
        isAdditive: row.is_additive,
        capacity: row.capacity == null ? null : Number(row.capacity),
        capacityFactor: row.capacity_factor == null ? null : Number(row.capacity_factor),
        taxType: row.tax_type,
        royalty: row.royalty,
        electrificationTime: row.electrification_time == null ? null : Number(row.electrification_time),
        simulateAlternatives: row.simulate_alternatives,
        dependency: row.dependency,
      } satisfies AssetIntervention,
    ]),
  );

  const aiFinancialsByIdYear = new Map<string, Map<number, AssetYearFinancials>>();
  for (const row of aiFinancialsRes.data ?? []) {
    const financials: AssetYearFinancials = {
      assetId: assetInterventionById.get(row.asset_intervention_id)?.assetId ?? "",
      year: row.year,
      capex: Number(row.capex),
      opex: Number(row.opex),
      devex: Number(row.devex),
    };
    if (!aiFinancialsByIdYear.has(row.asset_intervention_id)) {
      aiFinancialsByIdYear.set(row.asset_intervention_id, new Map());
    }
    aiFinancialsByIdYear.get(row.asset_intervention_id)!.set(row.year, financials);
  }

  const aiProductionByIdYear = new Map<string, Map<number, AssetProduction[]>>();
  for (const row of aiProductionRes.data ?? []) {
    const production: AssetProduction = {
      assetId: assetInterventionById.get(row.asset_intervention_id)?.assetId ?? "",
      areaId: row.area_id,
      year: row.year,
      production: Number(row.production),
    };
    if (!aiProductionByIdYear.has(row.asset_intervention_id)) {
      aiProductionByIdYear.set(row.asset_intervention_id, new Map());
    }
    const byYear = aiProductionByIdYear.get(row.asset_intervention_id)!;
    if (!byYear.has(row.year)) byYear.set(row.year, []);
    byYear.get(row.year)!.push(production);
  }

  const aiPriceDiffsById = new Map<string, Map<string, number>>();
  for (const row of aiPriceEffectsRes.data ?? []) {
    if (!aiPriceDiffsById.has(row.asset_intervention_id)) aiPriceDiffsById.set(row.asset_intervention_id, new Map());
    aiPriceDiffsById.get(row.asset_intervention_id)!.set(row.area_id, Number(row.price_diff));
  }

  return {
    financialsFor: (assetId, year) => financialsByAssetYear.get(assetId)?.get(year),
    productionFor: (assetId, year) => productionByAssetYear.get(assetId)?.get(year) ?? [],
    financingOptionById: (id) => financingById.get(id),
    offtakeOptionById: (id) => offtakeById.get(id),
    taxTypeFor: (assetId) => taxTypeByAsset.get(assetId) ?? null,
    assetInterventionById: (id) => assetInterventionById.get(id),
    assetInterventionFinancialsFor: (id, relativeYear) => aiFinancialsByIdYear.get(id)?.get(relativeYear),
    assetInterventionProductionFor: (id, relativeYear) => aiProductionByIdYear.get(id)?.get(relativeYear) ?? [],
    assetInterventionPriceDiffs: (id) => aiPriceDiffsById.get(id) ?? new Map(),
  };
}

/**
 * Every team's investments in a session, grouped by team_id — used to
 * populate TeamState.investments for advanceSessionYear. Also loads each
 * team's chosen per-asset decisions (team_asset_intervention_choices,
 * Phase 5) and attaches them to the matching investment as
 * chosenAssetInterventionIds, ordered by when they were chosen — see
 * TeamInvestmentState's own doc comment on why that order matters.
 */
async function loadTeamInvestments(teamIds: string[]): Promise<Map<string, TeamInvestmentState[]>> {
  const result = new Map<string, TeamInvestmentState[]>();
  if (teamIds.length === 0) return result;

  const supabase = getSupabaseServerClient();
  const [investmentsRes, choicesRes] = await Promise.all([
    supabase
      .from("team_investments")
      .select("id, team_id, asset_id, acquired_year, financing_option_id, offtake_option_id")
      .in("team_id", teamIds),
    supabase
      .from("team_asset_intervention_choices")
      .select("team_id, asset_intervention_id, created_at")
      .in("team_id", teamIds)
      .order("created_at", { ascending: true }),
  ]);
  if (investmentsRes.error) throw new Error(`Failed to load team investments: ${investmentsRes.error.message}`);
  if (choicesRes.error) throw new Error(`Failed to load asset decision choices: ${choicesRes.error.message}`);

  const chosenIdsByTeam = new Map<string, string[]>();
  for (const row of choicesRes.data ?? []) {
    if (!chosenIdsByTeam.has(row.team_id)) chosenIdsByTeam.set(row.team_id, []);
    chosenIdsByTeam.get(row.team_id)!.push(row.asset_intervention_id);
  }

  for (const row of investmentsRes.data ?? []) {
    const investment: TeamInvestmentState = {
      investmentId: row.id,
      assetId: row.asset_id,
      acquiredYear: row.acquired_year,
      financingOptionId: row.financing_option_id,
      offtakeOptionId: row.offtake_option_id,
      // A team's chosen decisions aren't stored per-investment, only per-
      // team — but since assets are exclusive per session (Phase 4), a
      // team only ever has one investment for a given asset, so every
      // chosen decision belongs unambiguously to at most one of its
      // investments. listPendingAssetDecisions/chooseAssetIntervention only
      // ever let a team choose a decision for an asset THEY own, so this
      // blanket assignment across all of a team's investments is safe: a
      // decision id here that doesn't belong to this investment's asset
      // simply won't match anything in resolveAssetYear's lookup calls.
      chosenAssetInterventionIds: chosenIdsByTeam.get(row.team_id) ?? [],
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
    .select("id, name, subject, message, photo_path")
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
    photoPath: iv.photo_path,
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
