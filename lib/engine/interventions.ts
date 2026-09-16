/**
 * Applying an intervention's mechanical effects (intervention_effects rows)
 * to a year's market state.
 *
 * Effect types found in the Renewable Template export, and how each is
 * handled here:
 *
 *  MODELED — directly move a market price for the year:
 *   - OIL_PRICE_INCREASE / GAS_PRICE_INCREASE (percentage, applied to Oil / Natural Gas)
 *   - ELECTRICITY_PRICE_INCREASE / ELECTRICITY_PRICE_DECREASE (percentage, applied to Electricity)
 *   - PRICE_CHANGE_PERCENTAGE (percentage, applied to whatever area the effect names)
 *   - NEW_CO2_CREDITS_PRICE / SET_CO2_TAX_AMOUNT (sets the CO2 Credits price directly to `amount`)
 *     Both source effect types only ever targeted CO2 Credits in the export
 *     and look like two names for the same knob, so they're treated
 *     identically here — worth confirming with Bjorn if the original
 *     platform actually distinguished a "CO2 tax" from the "CO2 credit
 *     price" as separate numbers, since this collapses them into one.
 *
 *  MODELED — a global multiplier applied to every asset's capex that year:
 *   - GLOBAL_CAPEX_INCREASE / REVERSE_GLOBAL_CAPEX_INCREASE (percentage, additive to the multiplier)
 *
 *  NOT YET MODELED — recorded on the intervention but not mechanically
 *  applied anywhere yet, because doing so needs a game-design decision
 *  this engine shouldn't make silently:
 *   - SET_OFFSHORE_TAX_PERCENTAGE / SET_ONSHORE_TAX_PERCENTAGE / SET_RENEWABLES_TAX_PERCENTAGE
 *     (would need a decision on gross-vs-net profit, how it stacks with
 *     royalty, etc.)
 *   - CSR_INTERVENTION (presents a team a choice of spend with a
 *     POSITIVE/NEGATIVE/NONE label per choice — the spend itself is just a
 *     balance transaction, but what NEGATIVE/POSITIVE actually *do* beyond
 *     that, e.g. some reputation mechanic, was never specified anywhere in
 *     the source export)
 */

import type { InterventionEffect } from "./types";

export type MarketState = {
  /** area id -> current price */
  prices: Map<string, number>;
  /** additive multiplier applied to every asset's capex this year, e.g. 0.1 = +10% */
  capexMultiplier: number;
};

const PERCENTAGE_EFFECT_AREA_NAME: Record<string, string> = {
  OIL_PRICE_INCREASE: "Oil",
  GAS_PRICE_INCREASE: "Natural Gas",
  ELECTRICITY_PRICE_INCREASE: "Electricity",
  ELECTRICITY_PRICE_DECREASE: "Electricity",
};

const DECREASE_TYPES = new Set(["ELECTRICITY_PRICE_DECREASE"]);

export type UnmodeledEffect = { effectType: string; amount: number };

/**
 * Applies every effect in `effects` to `market` in place, and returns the
 * list of effects this function deliberately didn't act on (so a caller —
 * or a test — can surface them rather than have them silently vanish).
 *
 * @param areaIdByName needed because several effect types name an area by
 *   its display name rather than carrying an area_id directly
 */
export function applyInterventionEffects(
  market: MarketState,
  effects: InterventionEffect[],
  areaIdByName: Map<string, string>,
): UnmodeledEffect[] {
  const unmodeled: UnmodeledEffect[] = [];

  for (const effect of effects) {
    if (effect.effectType === "GLOBAL_CAPEX_INCREASE") {
      market.capexMultiplier += effect.amount;
      continue;
    }
    if (effect.effectType === "REVERSE_GLOBAL_CAPEX_INCREASE") {
      market.capexMultiplier -= effect.amount;
      continue;
    }
    if (effect.effectType === "NEW_CO2_CREDITS_PRICE" || effect.effectType === "SET_CO2_TAX_AMOUNT") {
      const areaId = effect.areaId ?? areaIdByName.get("CO2 Credits");
      if (areaId) market.prices.set(areaId, effect.amount);
      else unmodeled.push({ effectType: effect.effectType, amount: effect.amount });
      continue;
    }
    if (effect.effectType in PERCENTAGE_EFFECT_AREA_NAME) {
      const areaName = PERCENTAGE_EFFECT_AREA_NAME[effect.effectType]!;
      const areaId = areaIdByName.get(areaName);
      applyPercentageShift(market, areaId, effect.amount, DECREASE_TYPES.has(effect.effectType));
      continue;
    }
    if (effect.effectType === "PRICE_CHANGE_PERCENTAGE") {
      const areaId = effect.areaId ?? undefined;
      applyPercentageShift(market, areaId, effect.amount, false);
      continue;
    }

    unmodeled.push({ effectType: effect.effectType, amount: effect.amount });
  }

  return unmodeled;
}

function applyPercentageShift(
  market: MarketState,
  areaId: string | undefined,
  amount: number,
  forceDecrease: boolean,
) {
  if (!areaId) return;
  const current = market.prices.get(areaId);
  if (current == null) return;
  const signedAmount = forceDecrease ? -Math.abs(amount) : amount;
  market.prices.set(areaId, round2(current * (1 + signedAmount)));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
