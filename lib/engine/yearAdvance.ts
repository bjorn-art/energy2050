/**
 * Year-advance orchestration: the function the app actually calls once per
 * game year. It ties together the four modules above —
 *
 *   prices.ts          -> this year's baseline market prices
 *   interventions.ts   -> what this year's scheduled interventions do to
 *                          those prices and to the capex multiplier
 *   assetEconomics.ts  -> each owned asset's revenue/opex/devex/capex for
 *                          the year
 *   financing.ts       -> loan payments and offtake pricing for each
 *                          owned asset
 *
 * — into one call: given a session's state at the start of a year, produce
 * its state at the end of that year (new prices, every team's balance
 * change itemized transaction-by-transaction, new balances).
 *
 * DESIGN ASSUMPTION — financed purchases (flagged here, like the
 * intervention-effect gaps in interventions.ts, as something to confirm
 * with Bjorn rather than something recovered from the source export, which
 * never specified how a loan interacts with the acquisition-year capex
 * charge):
 *
 *   When a team acquires an asset with a chosen financing option, this
 *   engine assumes only the UNFINANCED share of that year's capex
 *   (capex * (1 - financedPercent/100)) is paid immediately as a "down
 *   payment" transaction. The financed share becomes a loan (see
 *   financing.ts's generateLoanSchedule) whose annual payments are charged
 *   as their own 'loan_payment' transaction in every year the loan is
 *   still active, starting the same year as acquisition. Any capex in
 *   LATER years for the same asset (e.g. a second construction phase) is
 *   charged in full in the year it's incurred — financing is only assumed
 *   to apply to the acquisition-year capex.
 *
 * DESIGN ASSUMPTION — offtake pricing applies asset-wide: if a team picked
 * an offtake/PPA option for an asset, this engine uses the resolved
 * offtake price for every area that asset produces into. In the source
 * data this is a non-issue for the vast majority of assets (they produce
 * into a single area), but a multi-area asset (like an oil platform
 * producing both Oil and Natural Gas) with an offtake attached would have
 * that single price applied to both areas' production, which may not be
 * what the original platform did.
 *
 * TAX EFFECTS (SET_ONSHORE/OFFSHORE/RENEWABLES_TAX_PERCENTAGE, applied here
 * rather than in interventions.ts since it's the one module that knows both
 * a year's tax rates AND each asset's tax_type): CONFIRMED with Bjorn
 * (2026-09-16) these tax revenue — a flat percentage off the top, charged
 * as its own 'tax' transaction right after 'revenue', before opex/capex/
 * devex/loan payments.
 */

import type {
  Area,
  AssetFinancingOption,
  AssetIntervention,
  AssetOfftakeOption,
  AssetProduction,
  AssetYearFinancials,
  InterventionEffect,
} from "./types";
import { computeAssetYearCashFlow } from "./assetEconomics";
import { loanScheduleForFinancing, resolveOfftakePrice } from "./financing";
import { applyInterventionEffects, type MarketState, type UnmodeledEffect } from "./interventions";

export type TeamInvestmentState = {
  investmentId: string;
  assetId: string;
  /** The game year (1-indexed, matching every other `year` in this engine) this investment was made. */
  acquiredYear: number;
  financingOptionId: string | null;
  offtakeOptionId: string | null;
  /**
   * Per-asset decision points (Phase 5) this team has picked for this
   * investment, in the order they were chosen — which, because a decision's
   * `dependency` can only ever point at an earlier-chosen option (see
   * lib/db/repository.ts's listPendingAssetDecisions), is also chronological
   * order. That ordering matters: see resolveAssetYear below.
   */
  chosenAssetInterventionIds: string[];
};

export type TeamState = {
  teamId: string;
  balance: number;
  investments: TeamInvestmentState[];
};

/** One line of a team's balance-history log for the year, mirroring team_balance_history's shape. */
export type BalanceTransaction = {
  reason: "revenue" | "tax" | "opex" | "devex" | "capex" | "loan_payment";
  assetId: string;
  delta: number;
  balanceAfter: number;
};

export type TeamYearResult = {
  teamId: string;
  balanceBefore: number;
  balanceAfter: number;
  transactions: BalanceTransaction[];
};

export type YearAdvanceResult = {
  year: number;
  /** Market prices after this year's interventions have been applied. */
  prices: Map<string, number>;
  capexMultiplier: number;
  /** Revenue tax rate per asset tax_type, after this year's interventions — carry this into next year's `SessionYearInput.taxRatesByAssetTaxType`, same as `capexMultiplier`. */
  taxRatesByAssetTaxType: Map<string, number>;
  unmodeledEffects: UnmodeledEffect[];
  teams: TeamYearResult[];
};

/** Everything the orchestration needs to look up about the template's content. Implement this over whatever's actually loaded (a Supabase query result, an in-memory Map from a test, etc.) — this module doesn't care where the data comes from. */
export type AssetDataLookup = {
  financialsFor(assetId: string, year: number): AssetYearFinancials | undefined;
  productionFor(assetId: string, year: number): AssetProduction[];
  financingOptionById(id: string): AssetFinancingOption | undefined;
  offtakeOptionById(id: string): AssetOfftakeOption | undefined;
  /** The asset's tax_type ('onshore' | 'offshore' | 'renewable'), or null/undefined if it has none — used to look up this year's revenue tax rate, if any. */
  taxTypeFor(assetId: string): string | null | undefined;
  /** A chosen per-asset decision's own record (year, isAdditive, taxType, ...), or undefined if the id doesn't exist. */
  assetInterventionById(id: string): AssetIntervention | undefined;
  /**
   * A chosen decision's own capex/opex/devex for `relativeYear` — 1-indexed
   * from the decision's OWN fire year (relativeYear 1 = the year the
   * decision fires), matching how asset_intervention_year_financials.year
   * was written by the import script (see the DESIGN ASSUMPTION note below
   * resolveAssetYear).
   */
  assetInterventionFinancialsFor(assetInterventionId: string, relativeYear: number): AssetYearFinancials | undefined;
  /** Same relative-year convention as assetInterventionFinancialsFor, for the decision's own production rows. */
  assetInterventionProductionFor(assetInterventionId: string, relativeYear: number): AssetProduction[];
  /** A chosen decision's flat per-area price adjustments (asset_intervention_price_effects), not year-indexed — applies every year once the decision is active. */
  assetInterventionPriceDiffs(assetInterventionId: string): Map<string, number>;
};

export type SessionYearInput = {
  /** The game year being advanced TO (1-indexed). */
  year: number;
  /** This year's simulated baseline price per area id, before intervention effects — one entry from generateAllPricePaths's output per area. */
  basePrices: Map<string, number>;
  /** The capex multiplier carried in from all prior years' interventions (0 = no adjustment). */
  capexMultiplier: number;
  /** Revenue tax rate per asset tax_type, carried in from all prior years' interventions (empty = no tax anywhere yet). */
  taxRatesByAssetTaxType: Map<string, number>;
  /** Effects of every intervention scheduled to fire this year. */
  interventionEffects: InterventionEffect[];
  areaIdByName: Map<string, string>;
  teams: TeamState[];
};

export function advanceYear(input: SessionYearInput, lookup: AssetDataLookup): YearAdvanceResult {
  const market: MarketState = {
    prices: new Map(input.basePrices),
    capexMultiplier: input.capexMultiplier,
    taxRatesByAssetTaxType: new Map(input.taxRatesByAssetTaxType),
  };
  const unmodeledEffects = applyInterventionEffects(market, input.interventionEffects, input.areaIdByName);

  const teams = input.teams.map((team) => advanceTeamYear(team, input.year, market, lookup));

  return {
    year: input.year,
    prices: market.prices,
    capexMultiplier: market.capexMultiplier,
    taxRatesByAssetTaxType: market.taxRatesByAssetTaxType,
    unmodeledEffects,
    teams,
  };
}

function advanceTeamYear(
  team: TeamState,
  year: number,
  market: MarketState,
  lookup: AssetDataLookup,
): TeamYearResult {
  let balance = team.balance;
  const transactions: BalanceTransaction[] = [];

  const record = (reason: BalanceTransaction["reason"], assetId: string, delta: number) => {
    if (delta === 0) return;
    balance = round2(balance + delta);
    transactions.push({ reason, assetId, delta, balanceAfter: balance });
  };

  for (const investment of team.investments) {
    if (investment.acquiredYear > year) continue; // not yet owned this year

    const resolved = resolveAssetYear(investment, year, lookup);
    const { financials, production, priceAdjustments } = resolved;
    const offtake = investment.offtakeOptionId ? lookup.offtakeOptionById(investment.offtakeOptionId) : undefined;
    const yearsSinceAcquired = year - investment.acquiredYear + 1;

    const priceForArea = (areaId: string): number => {
      const marketPrice = (market.prices.get(areaId) ?? 0) + (priceAdjustments.get(areaId) ?? 0);
      return resolveOfftakePrice(offtake, yearsSinceAcquired, marketPrice);
    };

    if (!financials) {
      // No cost/production data for this asset this year (e.g. between its
      // acquisition and construction financials rows) — nothing to charge.
    } else {
      const isAcquisitionYear = year === investment.acquiredYear;
      const financing = investment.financingOptionId
        ? lookup.financingOptionById(investment.financingOptionId)
        : undefined;

      const adjustedCapex = round2(financials.capex * (1 + market.capexMultiplier));
      let capexChargedNow = adjustedCapex;

      if (isAcquisitionYear && financing) {
        const financedShare = round2(adjustedCapex * (financing.financedPercent / 100));
        capexChargedNow = round2(adjustedCapex - financedShare);
      }

      const cashFlow = computeAssetYearCashFlow(
        { ...financials, capex: capexChargedNow },
        production,
        priceForArea,
      );

      const taxType = resolved.taxTypeOverride ?? lookup.taxTypeFor(investment.assetId);
      const taxRate = taxType ? market.taxRatesByAssetTaxType.get(taxType) ?? 0 : 0;
      const tax = round2(cashFlow.revenue * taxRate);

      record("revenue", investment.assetId, cashFlow.revenue);
      record("tax", investment.assetId, -tax);
      record("opex", investment.assetId, -cashFlow.opex);
      record("devex", investment.assetId, -cashFlow.devex);
      record("capex", investment.assetId, -cashFlow.capex);

      if (financing) {
        // Uses the RESOLVED acquisition-year financials (base plus/replaced
        // by whatever decision was already active at acquisition, e.g. a
        // brand-new-asset decision that fires the same year it's acquired)
        // as the loan principal basis, not the raw base schedule — a team
        // financing a decision-driven build should get a loan sized to what
        // they're actually paying, not to numbers the decision superseded.
        const acquisitionFinancials = resolveAssetYear(investment, investment.acquiredYear, lookup).financials;
        if (acquisitionFinancials) {
          const acquisitionCapex = round2(
            acquisitionFinancials.capex * (1 + market.capexMultiplier),
          );
          const schedule = loanScheduleForFinancing(financing, acquisitionCapex);
          const loanYearRow = schedule[yearsSinceAcquired - 1];
          if (loanYearRow) {
            record("loan_payment", investment.assetId, -loanYearRow.payment);
          }
        }
      }
    }
  }

  return {
    teamId: team.teamId,
    balanceBefore: team.balance,
    balanceAfter: balance,
    transactions,
  };
}

type ResolvedAssetYear = {
  financials: AssetYearFinancials | undefined;
  production: AssetProduction[];
  /** Additive per-area price shift from any chosen decision's price_diff, on top of the plain market price. */
  priceAdjustments: Map<string, number>;
  /** A chosen decision's tax_type, if any is set and active — overrides the base asset's own tax_type for this year. undefined = no override, fall back to the base asset. */
  taxTypeOverride: string | null | undefined;
};

/**
 * DESIGN ASSUMPTION — per-asset decision points (flagged here the same way
 * as the financing/offtake assumptions above, since the source export never
 * specified how a chosen decision's own numbers interact with an asset's
 * base schedule; this is Claude's own interpretation, not something to
 * treat as confirmed):
 *
 *   A chosen asset_intervention "fires" at game year
 *   `investment.acquiredYear + decision.year - 1` (decision.year is
 *   1-indexed relative to acquisition, matching how the import script wrote
 *   asset_intervention_year_financials/production: `year` 1 there means
 *   "the first year this decision's own schedule applies," counting from
 *   the decision's own fire year, not from game year 1). Once fired:
 *
 *   - `isAdditive: true` ADDS the decision's own capex/opex/devex and
 *     production (per matching area) on top of whatever the asset's base
 *     schedule already contributes that year.
 *   - `isAdditive: false` or `null` REPLACES the asset's base schedule
 *     outright with the decision's own — chosen for the `null` case because
 *     the real template data includes decisions (e.g. Midas's "3 export
 *     route" choice) whose options carry entirely different capex/opex
 *     numbers than the base asset row, clearly meant to supersede it rather
 *     than stack with it.
 *   - A decision's own capex/opex/devex/production schedule is assumed to
 *     run long enough to cover the rest of the game on its own (the real
 *     data's arrays are generally 15-20+ entries) — once its own schedule
 *     runs out for a given year, that decision contributes nothing further
 *     that year (falls back to "no financials," same as the existing "no
 *     row for this asset this year" case), rather than reverting to base.
 *   - A decision's price_diff (asset_intervention_price_effects) is applied
 *     as a flat per-area addition to the market price used for THIS
 *     team's asset only, not to the shared session-wide price every team
 *     sees — a private decision about one team's asset shouldn't move the
 *     market for everyone else.
 *   - A decision's tax_type, if set, overrides the base asset's tax_type
 *     from the decision's fire year on.
 *   - Multiple chosen decisions for the same investment are applied in the
 *     order they were chosen (chronological, per TeamInvestmentState's own
 *     doc comment), so a later decision's REPLACE always wins over an
 *     earlier one once both are active.
 *   - capacity/capacityFactor overrides and the `royalty`/`electrificationTime`
 *     fields are NOT applied anywhere (capacityFactor isn't consumed by the
 *     economics engine at all — it's display-only — and royalty was already
 *     an unmodeled asset field before this phase; electrification has no
 *     engine mechanic yet). A decision that only changes these has no
 *     financial effect in this engine, which matches the real data (none of
 *     the 174 real decisions set `capacity`, and only a handful set
 *     `capacityFactor`/`taxType`/`royalty` at all).
 */
function resolveAssetYear(investment: TeamInvestmentState, year: number, lookup: AssetDataLookup): ResolvedAssetYear {
  let financials = lookup.financialsFor(investment.assetId, year);
  let production = lookup.productionFor(investment.assetId, year);
  const priceAdjustments = new Map<string, number>();
  let taxTypeOverride: string | null | undefined;

  for (const decisionId of investment.chosenAssetInterventionIds) {
    const decision = lookup.assetInterventionById(decisionId);
    if (!decision || decision.year == null) continue;
    // A team's chosen-decision list is tracked per team, not per
    // investment (see loadTeamInvestments), so a team with more than one
    // owned asset sees every decision it has ever chosen here — skip any
    // that don't belong to THIS investment's asset, otherwise a decision
    // made for one asset would leak into another asset's economics.
    if (decision.assetId !== investment.assetId) continue;

    const fireYear = investment.acquiredYear + decision.year - 1;
    if (fireYear > year) continue; // chosen, but doesn't take effect until a later year

    const relativeYear = year - fireYear + 1;
    const decisionFinancials = lookup.assetInterventionFinancialsFor(decisionId, relativeYear);
    const decisionProduction = lookup.assetInterventionProductionFor(decisionId, relativeYear);

    if (decision.isAdditive === true) {
      financials = addFinancials(financials, decisionFinancials);
      production = addProduction(production, decisionProduction);
    } else {
      financials = decisionFinancials;
      production = decisionProduction;
    }

    for (const [areaId, diff] of lookup.assetInterventionPriceDiffs(decisionId)) {
      priceAdjustments.set(areaId, round2((priceAdjustments.get(areaId) ?? 0) + diff));
    }

    if (decision.taxType) taxTypeOverride = decision.taxType;
  }

  return { financials, production, priceAdjustments, taxTypeOverride };
}

function addFinancials(
  base: AssetYearFinancials | undefined,
  extra: AssetYearFinancials | undefined,
): AssetYearFinancials | undefined {
  if (!base && !extra) return undefined;
  return {
    assetId: base?.assetId ?? extra?.assetId ?? "",
    year: base?.year ?? extra?.year ?? 0,
    capex: round2((base?.capex ?? 0) + (extra?.capex ?? 0)),
    opex: round2((base?.opex ?? 0) + (extra?.opex ?? 0)),
    devex: round2((base?.devex ?? 0) + (extra?.devex ?? 0)),
  };
}

function addProduction(base: AssetProduction[], extra: AssetProduction[]): AssetProduction[] {
  const byArea = new Map<string, AssetProduction>();
  for (const row of base) byArea.set(row.areaId, { ...row });
  for (const row of extra) {
    const existing = byArea.get(row.areaId);
    if (existing) {
      existing.production = round2(existing.production + row.production);
    } else {
      byArea.set(row.areaId, { ...row });
    }
  }
  return [...byArea.values()];
}

function round2(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? 0 : rounded; // normalize -0
}

/** Re-exported so callers building a full session loop don't need to import from prices.ts separately just to seed the first year's `basePrices`. */
export type { Area };
