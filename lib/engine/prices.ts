/**
 * Market price simulation.
 *
 * IMPORTANT — this formula is Claude's own design, not a recovered copy of
 * whatever the original platform used internally (that logic wasn't
 * available anywhere in the export — only its *outputs*, the price
 * parameters on each area). Treat the shape of this model as a reasonable
 * starting point to react to and tune, not a fact about how the old game
 * worked.
 *
 * The model, in plain terms: each area starts at its `priceMean` (which
 * equals `merchantPrice` for every area in the Renewable Template — the
 * two are redundant in the source data). Every following year, the price
 * drifts by `priceDrift + priceInflation` (both are small fractional rates
 * in the source data, e.g. 0.026 = 2.6%/year) applied to the previous
 * year's price, then — only for areas with `randomizePrice: true` — a
 * random shock is added, drawn from a normal distribution with standard
 * deviation `priceStandardDeviation`. That field's values in the source
 * data (2.03 for Oil at a ~75 price level, 14.06 for Natural Gas at ~400)
 * are absolute currency units, not a percentage, so the shock is applied
 * as an absolute add, not a multiplier. The result is clamped to
 * [minPrice, maxPrice] every year, matching those bounds existing on every
 * area in the source data.
 */

import type { Area } from "./types";
import { randomNormal, type Rng } from "./rng";

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Generate a year-by-year price path for one area, years 1..count inclusive
 * (year 1 = the game's starting price, matching the `year` convention used
 * throughout the schema: array index 0 in the returned array is year 1).
 */
export function generatePricePath(area: Area, years: number, rng: Rng): number[] {
  if (years < 1) return [];
  const path: number[] = [];
  let price = area.priceMean;
  path.push(round2(clamp(price, area.minPrice, area.maxPrice)));

  for (let year = 2; year <= years; year++) {
    const trendRate = area.priceDrift + area.priceInflation;
    const trend = price * trendRate;
    const shock = area.randomizePrice ? randomNormal(rng) * area.priceStandardDeviation : 0;
    price = clamp(price + trend + shock, area.minPrice, area.maxPrice);
    path.push(round2(price));
  }

  return path;
}

/**
 * Generate price paths for every area in a template at once, keyed by
 * area id. Each area gets its own draw from the shared `rng`, so the
 * overall path is fully determined by the seed the caller used to create
 * that `rng`.
 */
export function generateAllPricePaths(
  areas: Area[],
  years: number,
  rng: Rng,
): Map<string, number[]> {
  const result = new Map<string, number[]>();
  for (const area of areas) {
    result.set(area.id, generatePricePath(area, years, rng));
  }
  return result;
}
