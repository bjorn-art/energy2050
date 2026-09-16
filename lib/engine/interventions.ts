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
 *     identically here. CONFIRMED with Bjorn (2026-09-16): keep them as one
 *     knob rather than splitting into a separate tax vs. credit-price
 *     mechanic.
 *
 *  MODELED — a global multiplier applied to every asset's capex that year:
 *   - GLOBAL_CAPEX_INCREASE / REVERSE_GLOBAL_CAPEX_INCREASE (percentage, additive to the multiplier)
 *
 *  MODELED — a per-asset-tax-type revenue tax, applied in yearAdvance.ts (not
 *  here, since it needs each asset's tax_type, which this module doesn't see):
 *   - SET_OFFSHORE_TAX_PERCENTAGE / SET_ONSHORE_TAX_PERCENTAGE / SET_RENEWABLES_TAX_PERCENTAGE
 *     CONFIRMED with Bjorn (2026-09-16): these tax REVENUE (a flat percentage
 *     off the top, before opex/capex/devex), not net profit. Each SET_*_TAX
 *     effect sets that tax type's rate directly (matching the "SET_"
 *     naming), so a later effect for the same tax type replaces rather than
 *     stacks with an earlier one in the same session. There's no separate
 *     royalty percentage anywhere in the source data (`assets.royalty` is
 *     just a boolean), so "how it stacks with royalty" turned out to be a
 *     non-issue.
 *
 *  NOT AUTOMATICALLY APPLIED HERE — CSR_INTERVENTION presents a team a
 *  choice (POSITIVE/NEGATIVE/NONE) with an amount they spend, which isn't a
 *  broadcast market effect like the ones above — it's a per-team decision
 *  that needs a UI to actually offer the choice (Phase 3+). CONFIRMED with
 *  Bjorn (2026-09-16): POSITIVE/NEGATIVE should move a team's reputation
 *  score, in addition to the spend. See csr.ts's `applyCsrChoice` — a small
 *  pure function ready for the facilitator console to call once a team
 *  picks a choice and an amount; not wired into applyInterventionEffects or
 *  yearAdvance.ts since there's no session/team reputation state model yet
 *  (planned for the Phase 3 schema addition, see architecture-plan.md).
 */

import type { InterventionEffect } from "./types";

export type MarketState = {
  /** area id -> current price */
  prices: Map<string, number>;
  /** additive multiplier applied to every asset's capex this year, e.g. 0.1 = +10% */
  capexMultiplier: number;
  /**
   * asset tax_type ('onshore' | 'offshore' | 'renewable') -> revenue tax
   * rate for this year, e.g. 0.05 = 5% of revenue. Read by yearAdvance.ts
   * when it computes each asset's cash flow; not itself applied to
   * anything here since this module doesn't know which assets have which
   * tax_type.
   */
  taxRatesByAssetTaxType: Map<string, number>;
};

const PERCENTAGE_EFFECT_AREA_NAME: Record<string, string> = {
  OIL_PRICE_INCREASE: "Oil",
  GAS_PRICE_INCREASE: "Natural Gas",
  ELECTRICITY_PRICE_INCREASE: "Electricity",
  ELECTRICITY_PRICE_DECREASE: "Electricity",
};

const DECREASE_TYPES = new Set(["ELECTRICITY_PRICE_DECREASE"]);

const TAX_EFFECT_TYPE_TO_ASSET_TAX_TYPE: Record<string, string> = {
  SET_ONSHORE_TAX_PERCENTAGE: "onshore",
  SET_OFFSHORE_TAX_PERCENTAGE: "offshore",
  SET_RENEWABLES_TAX_PERCENTAGE: "renewable",
};

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
    if (effect.effectType in TAX_EFFECT_TYPE_TO_ASSET_TAX_TYPE) {
      const assetTaxType = TAX_EFFECT_TYPE_TO_ASSET_TAX_TYPE[effect.effectType]!;
      market.taxRatesByAssetTaxType.set(assetTaxType, effect.amount);
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
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? 0 : rounded; // normalize -0
}
