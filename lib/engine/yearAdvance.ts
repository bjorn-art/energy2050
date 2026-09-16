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

    const financials = lookup.financialsFor(investment.assetId, year);
    const production = lookup.productionFor(investment.assetId, year);
    const offtake = investment.offtakeOptionId ? lookup.offtakeOptionById(investment.offtakeOptionId) : undefined;
    const yearsSinceAcquired = year - investment.acquiredYear + 1;

    const priceForArea = (areaId: string): number => {
      const marketPrice = market.prices.get(areaId) ?? 0;
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

      const taxType = lookup.taxTypeFor(investment.assetId);
      const taxRate = taxType ? market.taxRatesByAssetTaxType.get(taxType) ?? 0 : 0;
      const tax = round2(cashFlow.revenue * taxRate);

      record("revenue", investment.assetId, cashFlow.revenue);
      record("tax", investment.assetId, -tax);
      record("opex", investment.assetId, -cashFlow.opex);
      record("devex", investment.assetId, -cashFlow.devex);
      record("capex", investment.assetId, -cashFlow.capex);

      if (financing) {
        const acquisitionFinancials = lookup.financialsFor(investment.assetId, investment.acquiredYear);
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

function round2(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? 0 : rounded; // normalize -0
}

/** Re-exported so callers building a full session loop don't need to import from prices.ts separately just to seed the first year's `basePrices`. */
export type { Area };
