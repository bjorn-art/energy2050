/**
 * Per-asset, per-year cash flow: turn a year's production, prices, and
 * cost schedule into revenue, costs, and a net number. This is the
 * arithmetic core the rest of the engine (loans, offtakes, year-advance)
 * builds on — it deliberately knows nothing about financing, market
 * simulation, or interventions, so it can be tested and trusted in
 * isolation.
 */

import type { AssetYearFinancials, AssetProduction } from "./types";

export type AssetYearCashFlow = {
  year: number;
  revenue: number;
  opex: number;
  capex: number;
  devex: number;
  /** revenue - opex - capex - devex. Can be negative (a build year). */
  netCashFlow: number;
  /** revenue broken out by area, for display ("this much from Oil, this much from Natural Gas"). */
  revenueByArea: Map<string, number>;
};

/**
 * @param financials this asset's capex/opex/devex row for the year in question
 * @param production this asset's production rows for the year in question (one per area it produces into)
 * @param priceForArea resolves the price/unit to use for a given area id in
 *   this year — pass a plain market-price lookup, or one that accounts for
 *   an offtake agreement (see offtake.ts) when the asset has one
 */
export function computeAssetYearCashFlow(
  financials: AssetYearFinancials,
  production: AssetProduction[],
  priceForArea: (areaId: string) => number,
): AssetYearCashFlow {
  const revenueByArea = new Map<string, number>();
  let revenue = 0;

  for (const row of production) {
    const price = priceForArea(row.areaId);
    const areaRevenue = row.production * price;
    revenue += areaRevenue;
    revenueByArea.set(row.areaId, (revenueByArea.get(row.areaId) ?? 0) + areaRevenue);
  }

  const { opex, capex, devex } = financials;
  const netCashFlow = revenue - opex - capex - devex;

  return {
    year: financials.year,
    revenue: round2(revenue),
    opex,
    capex,
    devex,
    netCashFlow: round2(netCashFlow),
    revenueByArea,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
