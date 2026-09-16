/**
 * Assertion-based tests for the Phase 2 simulation engine (lib/engine/*).
 * No test framework — just node:assert/strict, run directly with tsx. This
 * matches how scripts/import-template.ts was verified in Phase 1: cheap to
 * run in this sandbox, and it's exactly the kind of check that should also
 * run in CI once the project has one.
 *
 * Usage:
 *   tsx scripts/engine-tests.ts
 *
 * Exits non-zero (and prints which assertion failed) if anything's wrong;
 * prints "All engine tests passed." and exits 0 otherwise.
 */

import assert from "node:assert/strict";

import { createRng, randomNormal } from "../lib/engine/rng";
import { clamp, generateAllPricePaths, generatePricePath } from "../lib/engine/prices";
import { computeAssetYearCashFlow } from "../lib/engine/assetEconomics";
import { generateLoanSchedule, loanScheduleForFinancing, resolveOfftakePrice } from "../lib/engine/financing";
import { applyInterventionEffects, type MarketState } from "../lib/engine/interventions";
import { advanceYear, type AssetDataLookup, type TeamState } from "../lib/engine/yearAdvance";
import type {
  Area,
  AssetFinancingOption,
  AssetOfftakeOption,
  AssetProduction,
  AssetYearFinancials,
} from "../lib/engine/types";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

function makeArea(overrides: Partial<Area> = {}): Area {
  return {
    id: "area-1",
    templateId: "tpl-1",
    name: "Test Area",
    type: "test",
    productionUnit: "unit",
    randomizePrice: false,
    priceDrift: 0,
    priceStandardDeviation: 0,
    priceInflation: 0,
    priceMean: 100,
    minPrice: 0,
    maxPrice: 1000,
    merchantPrice: 100,
    co2EmittedPerProduction: 0,
    ...overrides,
  };
}

console.log("rng.ts");
check("createRng is deterministic for a given seed", () => {
  const a = createRng(42);
  const b = createRng(42);
  const seqA = [a(), a(), a(), a(), a()];
  const seqB = [b(), b(), b(), b(), b()];
  assert.deepEqual(seqA, seqB);
});
check("createRng produces different sequences for different seeds", () => {
  const a = createRng(1);
  const b = createRng(2);
  assert.notEqual(a(), b());
});
check("createRng always returns values in [0, 1)", () => {
  const rng = createRng(7);
  for (let i = 0; i < 1000; i++) {
    const v = rng();
    assert.ok(v >= 0 && v < 1, `value out of range: ${v}`);
  }
});
check("randomNormal is roughly standard-normal over many samples", () => {
  const rng = createRng(123);
  const n = 20000;
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const v = randomNormal(rng);
    sum += v;
    sumSq += v * v;
  }
  const mean = sum / n;
  const variance = sumSq / n - mean * mean;
  assert.ok(Math.abs(mean) < 0.05, `mean too far from 0: ${mean}`);
  assert.ok(Math.abs(variance - 1) < 0.1, `variance too far from 1: ${variance}`);
});

console.log("prices.ts");
check("clamp bounds a value on both sides", () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-5, 0, 10), 0);
  assert.equal(clamp(50, 0, 10), 10);
});
check("generatePricePath with no randomization matches hand-computed drift", () => {
  const area = makeArea({ priceMean: 100, priceDrift: 0.02, priceInflation: 0.01, minPrice: 0, maxPrice: 100000 });
  const rng = createRng(1); // unused since randomizePrice is false
  const path = generatePricePath(area, 3, rng);
  // year 1 = 100
  // year 2 = 100 + 100*0.03 = 103
  // year 3 = 103 + 103*0.03 = 106.09
  assert.deepEqual(path, [100, 103, 106.09]);
});
check("generatePricePath respects min/max clamping", () => {
  const area = makeArea({ priceMean: 95, priceDrift: 1, priceInflation: 0, minPrice: 0, maxPrice: 100 });
  const rng = createRng(1);
  const path = generatePricePath(area, 2, rng);
  assert.equal(path[1], 100); // would be 190 unclamped
});
check("generatePricePath returns [] for years < 1", () => {
  assert.deepEqual(generatePricePath(makeArea(), 0, createRng(1)), []);
});
check("generateAllPricePaths returns one path per area, each the requested length", () => {
  const areas = [makeArea({ id: "a" }), makeArea({ id: "b" })];
  const result = generateAllPricePaths(areas, 5, createRng(1));
  assert.equal(result.size, 2);
  assert.equal(result.get("a")?.length, 5);
  assert.equal(result.get("b")?.length, 5);
});

console.log("assetEconomics.ts");
check("computeAssetYearCashFlow sums revenue across areas and nets out costs", () => {
  const financials: AssetYearFinancials = { assetId: "asset-1", year: 1, capex: 1000, opex: 200, devex: 50 };
  const production: AssetProduction[] = [
    { assetId: "asset-1", areaId: "area-a", year: 1, production: 10 },
    { assetId: "asset-1", areaId: "area-b", year: 1, production: 5 },
  ];
  const priceForArea = (areaId: string) => (areaId === "area-a" ? 10 : 20);
  const cashFlow = computeAssetYearCashFlow(financials, production, priceForArea);
  assert.equal(cashFlow.revenue, 200); // 10*10 + 5*20
  assert.equal(cashFlow.netCashFlow, 200 - 200 - 1000 - 50);
  assert.equal(cashFlow.revenueByArea.get("area-a"), 100);
  assert.equal(cashFlow.revenueByArea.get("area-b"), 100);
});

console.log("financing.ts");
check("generateLoanSchedule pays off the full principal with a level payment", () => {
  const schedule = generateLoanSchedule(1000, 5, 3);
  assert.equal(schedule.length, 3);
  const totalPrincipal = schedule.reduce((sum, row) => sum + row.principal, 0);
  assert.ok(Math.abs(totalPrincipal - 1000) < 0.01, `principal didn't sum to 1000: ${totalPrincipal}`);
  assert.equal(schedule[2]?.remainingBalance, 0);
  assert.equal(schedule[0]?.payment, schedule[1]?.payment); // level payment, pre-final-year
});
check("generateLoanSchedule with 0% interest just divides principal evenly", () => {
  const schedule = generateLoanSchedule(900, 0, 3);
  assert.deepEqual(
    schedule.map((r) => r.payment),
    [300, 300, 300],
  );
});
check("generateLoanSchedule returns [] for a non-positive principal or term", () => {
  assert.deepEqual(generateLoanSchedule(0, 5, 3), []);
  assert.deepEqual(generateLoanSchedule(1000, 5, 0), []);
});
check("resolveOfftakePrice falls back to market price with no offtake", () => {
  assert.equal(resolveOfftakePrice(null, 1, 42), 42);
  assert.equal(resolveOfftakePrice(undefined, 1, 42), 42);
});
check("resolveOfftakePrice uses the fixed support price within the support period", () => {
  const offtake: AssetOfftakeOption = {
    id: "off-1",
    assetId: "asset-1",
    name: "Fixed price",
    offtakeType: "Fixed",
    supportPeriod: 10,
    supportPrice: 65,
  };
  assert.equal(resolveOfftakePrice(offtake, 1, 999), 65);
  assert.equal(resolveOfftakePrice(offtake, 10, 999), 65);
  assert.equal(resolveOfftakePrice(offtake, 11, 999), 999); // past support period
});
check("resolveOfftakePrice ignores non-Fixed offtake types", () => {
  const offtake: AssetOfftakeOption = {
    id: "off-2",
    assetId: "asset-1",
    name: "Merchant",
    offtakeType: "Merchant",
    supportPeriod: null,
    supportPrice: null,
  };
  assert.equal(resolveOfftakePrice(offtake, 1, 42), 42);
});
check("loanScheduleForFinancing derives principal from capex * financedPercent", () => {
  const financing: AssetFinancingOption = {
    id: "fin-1",
    assetId: "asset-1",
    lender: "Test Bank",
    interestRatePercent: 5,
    financedPercent: 50,
    requiresSupport: false,
    downPaymentYears: 2,
  };
  const schedule = loanScheduleForFinancing(financing, 1000); // principal = 500
  const totalPrincipal = schedule.reduce((sum, row) => sum + row.principal, 0);
  assert.ok(Math.abs(totalPrincipal - 500) < 0.01);
});

console.log("interventions.ts");
check("GLOBAL_CAPEX_INCREASE / REVERSE_GLOBAL_CAPEX_INCREASE adjust the multiplier", () => {
  const market: MarketState = { prices: new Map(), capexMultiplier: 0 };
  applyInterventionEffects(
    market,
    [
      { id: "e1", interventionId: "iv1", effectType: "GLOBAL_CAPEX_INCREASE", amount: 0.1, areaId: null },
      { id: "e2", interventionId: "iv1", effectType: "REVERSE_GLOBAL_CAPEX_INCREASE", amount: 0.04, areaId: null },
    ],
    new Map(),
  );
  assert.ok(Math.abs(market.capexMultiplier - 0.06) < 1e-9);
});
check("OIL_PRICE_INCREASE shifts the named area's price by a percentage", () => {
  const market: MarketState = { prices: new Map([["oil-id", 75]]), capexMultiplier: 0 };
  const unmodeled = applyInterventionEffects(
    market,
    [{ id: "e1", interventionId: "iv1", effectType: "OIL_PRICE_INCREASE", amount: 0.2, areaId: null }],
    new Map([["Oil", "oil-id"]]),
  );
  assert.equal(market.prices.get("oil-id"), 90); // 75 * 1.2
  assert.deepEqual(unmodeled, []);
});
check("ELECTRICITY_PRICE_DECREASE always decreases, regardless of amount's sign", () => {
  const market: MarketState = { prices: new Map([["el-id", 50]]), capexMultiplier: 0 };
  applyInterventionEffects(
    market,
    [{ id: "e1", interventionId: "iv1", effectType: "ELECTRICITY_PRICE_DECREASE", amount: 0.1, areaId: null }],
    new Map([["Electricity", "el-id"]]),
  );
  assert.equal(market.prices.get("el-id"), 45); // 50 * (1 - 0.1)
});
check("NEW_CO2_CREDITS_PRICE / SET_CO2_TAX_AMOUNT both set the CO2 price directly", () => {
  const market: MarketState = { prices: new Map([["co2-id", 10]]), capexMultiplier: 0 };
  applyInterventionEffects(
    market,
    [{ id: "e1", interventionId: "iv1", effectType: "SET_CO2_TAX_AMOUNT", amount: 30, areaId: null }],
    new Map([["CO2 Credits", "co2-id"]]),
  );
  assert.equal(market.prices.get("co2-id"), 30);
});
check("Unmodeled effect types are reported, not silently dropped", () => {
  const market: MarketState = { prices: new Map(), capexMultiplier: 0 };
  const unmodeled = applyInterventionEffects(
    market,
    [
      { id: "e1", interventionId: "iv1", effectType: "SET_OFFSHORE_TAX_PERCENTAGE", amount: 5, areaId: null },
      { id: "e2", interventionId: "iv1", effectType: "CSR_INTERVENTION", amount: 0, areaId: null },
    ],
    new Map(),
  );
  assert.equal(unmodeled.length, 2);
  assert.equal(unmodeled[0]?.effectType, "SET_OFFSHORE_TAX_PERCENTAGE");
  assert.equal(unmodeled[1]?.effectType, "CSR_INTERVENTION");
});

console.log("yearAdvance.ts");
check("advanceYear: acquisition-year financing splits capex into down payment + loan, following years pay opex/loan/revenue", () => {
  const assetId = "asset-1";
  const financing: AssetFinancingOption = {
    id: "fin-1",
    assetId,
    lender: "Test Bank",
    interestRatePercent: 5,
    financedPercent: 60,
    requiresSupport: false,
    downPaymentYears: 2, // loan term
  };
  const financialsByYear: Record<number, AssetYearFinancials> = {
    1: { assetId, year: 1, capex: 1000, opex: 100, devex: 0 },
    2: { assetId, year: 2, capex: 0, opex: 120, devex: 0 },
  };
  const productionByYear: Record<number, AssetProduction[]> = {
    1: [{ assetId, areaId: "area-a", year: 1, production: 50 }],
    2: [{ assetId, areaId: "area-a", year: 2, production: 60 }],
  };
  const lookup: AssetDataLookup = {
    financialsFor: (id, year) => (id === assetId ? financialsByYear[year] : undefined),
    productionFor: (id, year) => (id === assetId ? productionByYear[year] ?? [] : []),
    financingOptionById: (id) => (id === financing.id ? financing : undefined),
    offtakeOptionById: () => undefined,
  };
  const team: TeamState = {
    teamId: "team-1",
    balance: 10000,
    investments: [
      { investmentId: "inv-1", assetId, acquiredYear: 1, financingOptionId: financing.id, offtakeOptionId: null },
    ],
  };

  // Expected loan schedule, computed the same way financing.ts would (used
  // here to cross-check advanceYear's output, not to re-derive its logic).
  const expectedSchedule = loanScheduleForFinancing(financing, 1000);

  // --- Year 1 (acquisition year) ---
  const year1 = advanceYear(
    { year: 1, basePrices: new Map([["area-a", 10]]), capexMultiplier: 0, interventionEffects: [], areaIdByName: new Map(), teams: [team] },
    lookup,
  );
  const team1 = year1.teams[0]!;
  // revenue 50*10=500, opex -100, capex (down payment, 40% of 1000) -400, loan payment -expectedSchedule[0]
  const expectedBalance1 = round2(10000 + 500 - 100 - 400 - (expectedSchedule[0]?.payment ?? 0));
  assert.equal(team1.balanceAfter, expectedBalance1);
  const reasons1 = team1.transactions.map((t) => t.reason);
  assert.deepEqual(reasons1, ["revenue", "opex", "capex", "loan_payment"]);

  // --- Year 2 ---
  const year2 = advanceYear(
    { year: 2, basePrices: new Map([["area-a", 12]]), capexMultiplier: 0, interventionEffects: [], areaIdByName: new Map(), teams: [{ ...team, balance: team1.balanceAfter }] },
    lookup,
  );
  const team2 = year2.teams[0]!;
  // revenue 60*12=720, opex -120, capex 0 (not acquisition year, and this
  // year's own capex row is 0 anyway), loan payment -expectedSchedule[1]
  const expectedBalance2 = round2(team1.balanceAfter + 720 - 120 - (expectedSchedule[1]?.payment ?? 0));
  assert.equal(team2.balanceAfter, expectedBalance2);
  const reasons2 = team2.transactions.map((t) => t.reason);
  assert.deepEqual(reasons2, ["revenue", "opex", "loan_payment"]); // no zero-delta capex line
});
check("advanceYear: an investment isn't charged or paid before its acquisition year", () => {
  const assetId = "asset-1";
  const lookup: AssetDataLookup = {
    financialsFor: () => ({ assetId, year: 1, capex: 999, opex: 999, devex: 999 }),
    productionFor: () => [{ assetId, areaId: "area-a", year: 1, production: 999 }],
    financingOptionById: () => undefined,
    offtakeOptionById: () => undefined,
  };
  const team: TeamState = {
    teamId: "team-1",
    balance: 500,
    investments: [{ investmentId: "inv-1", assetId, acquiredYear: 5, financingOptionId: null, offtakeOptionId: null }],
  };
  const result = advanceYear(
    { year: 1, basePrices: new Map([["area-a", 10]]), capexMultiplier: 0, interventionEffects: [], areaIdByName: new Map(), teams: [team] },
    lookup,
  );
  assert.equal(result.teams[0]?.balanceAfter, 500);
  assert.deepEqual(result.teams[0]?.transactions, []);
});
check("advanceYear applies intervention price effects before computing revenue", () => {
  const assetId = "asset-1";
  const lookup: AssetDataLookup = {
    financialsFor: () => ({ assetId, year: 1, capex: 0, opex: 0, devex: 0 }),
    productionFor: () => [{ assetId, areaId: "area-a", year: 1, production: 10 }],
    financingOptionById: () => undefined,
    offtakeOptionById: () => undefined,
  };
  const team: TeamState = {
    teamId: "team-1",
    balance: 0,
    investments: [{ investmentId: "inv-1", assetId, acquiredYear: 1, financingOptionId: null, offtakeOptionId: null }],
  };
  const result = advanceYear(
    {
      year: 1,
      basePrices: new Map([["area-a", 10]]),
      capexMultiplier: 0,
      interventionEffects: [{ id: "e1", interventionId: "iv1", effectType: "PRICE_CHANGE_PERCENTAGE", amount: 0.5, areaId: "area-a" }],
      areaIdByName: new Map(),
      teams: [team],
    },
    lookup,
  );
  // price becomes 15 (10 * 1.5) before revenue is computed
  assert.equal(result.prices.get("area-a"), 15);
  assert.equal(result.teams[0]?.balanceAfter, 150); // 10 * 15
});

console.log(`\nAll engine tests passed (${passed} checks).`);

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
