/**
 * Multi-year demo run: plays one real asset from the actual template export
 * through the Phase 2 engine, year by year, and prints what happened in
 * plain language. This is for a human (Bjorn) to sanity-check the
 * arithmetic against intuition — not an automated test (see
 * scripts/engine-tests.ts for that).
 *
 * Reads content/source/renewable-template-export.json directly (the same
 * source scripts/import-template.ts reads), rather than the generated
 * seed.sql, so there's no SQL-parsing step in the way of "does this number
 * look right".
 *
 * Usage:
 *   tsx scripts/engine-demo.ts
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createRng } from "../lib/engine/rng";
import { generateAllPricePaths } from "../lib/engine/prices";
import { advanceYear, type AssetDataLookup, type TeamState } from "../lib/engine/yearAdvance";
import type {
  Area,
  AssetFinancingOption,
  AssetOfftakeOption,
  AssetProduction,
  AssetYearFinancials,
  InterventionEffect,
} from "../lib/engine/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_PATH = path.join(__dirname, "..", "content", "source", "renewable-template-export.json");

const raw = JSON.parse(readFileSync(SOURCE_PATH, "utf8"));
const tpl = raw.template;

// ---------------------------------------------------------------------------
// Pull real areas + one real asset (Aquila, an onshore wind farm with a
// loan option and a fixed-price offtake — a good demo case because it shows
// a multi-year build, a loan being paid down, and the offtake price
// expiring partway through) straight from the source export.
// ---------------------------------------------------------------------------

const areas: Area[] = tpl.areas.map((a: any) => ({
  id: a.id,
  templateId: "demo",
  name: a.name,
  type: a.type,
  productionUnit: a.productionUnit,
  randomizePrice: a.randomizePrice ?? false,
  priceDrift: a.priceDrift ?? 0,
  priceStandardDeviation: a.priceStandardDeviation ?? 0,
  priceInflation: a.priceInflation ?? 0,
  priceMean: a.priceMean,
  minPrice: a.minPrice ?? 0,
  maxPrice: a.maxPrice,
  merchantPrice: a.merchantPrice,
  co2EmittedPerProduction: a.co2EmittedPerProduction ?? 0,
}));
const areaIdByName = new Map(areas.map((a) => [a.name, a.id]));

const assetRaw = tpl.assets.find((a: any) => a.name === "Aquila");
if (!assetRaw) {
  console.error('Demo asset "Aquila" not found in the source export — has the template changed?');
  process.exit(1);
}

const assetId = assetRaw.id;
const financialsByYear = new Map<number, AssetYearFinancials>();
const maxYear = Math.max(assetRaw.capex?.length ?? 0, assetRaw.opex?.length ?? 0, assetRaw.devex?.length ?? 0);
for (let i = 0; i < maxYear; i++) {
  financialsByYear.set(i + 1, {
    assetId,
    year: i + 1,
    capex: assetRaw.capex?.[i] ?? 0,
    opex: assetRaw.opex?.[i] ?? 0,
    devex: assetRaw.devex?.[i] ?? 0,
  });
}

const productionByYear = new Map<number, AssetProduction[]>();
const productionProfile = assetRaw.productionProfiles[0];
const productionAreaId: string = productionProfile.areaId ?? areaIdByName.get(productionProfile.areaName);
(productionProfile.production as number[]).forEach((value, i) => {
  productionByYear.set(i + 1, [{ assetId, areaId: productionAreaId, year: i + 1, production: value }]);
});

const financing: AssetFinancingOption = {
  id: assetRaw.availableLoans[0].id,
  assetId,
  lender: assetRaw.availableLoans[0].lender,
  interestRatePercent: assetRaw.availableLoans[0].interestRatePercent,
  financedPercent: assetRaw.availableLoans[0].financedPercent,
  requiresSupport: assetRaw.availableLoans[0].requiresSupport ?? false,
  downPaymentYears: assetRaw.availableLoans[0].downPaymentYears,
};
const offtake: AssetOfftakeOption = {
  id: "offtake-demo",
  assetId,
  name: assetRaw.availableOfftakes[0].name,
  offtakeType: assetRaw.availableOfftakes[0].offtakeType,
  supportPeriod: assetRaw.availableOfftakes[0].supportPeriod,
  supportPrice: assetRaw.availableOfftakes[0].supportPrice,
};

console.log(`Demo asset: ${assetRaw.name} (${assetRaw.assetType})`);
console.log(`  Financing: ${financing.lender}, ${financing.financedPercent}% financed at ${financing.interestRatePercent}% over ${financing.downPaymentYears} years`);
console.log(`  Offtake: ${offtake.name}, fixed at ${offtake.supportPrice}/unit for the first ${offtake.supportPeriod} years, then market price`);
console.log("");
console.log(
  "NOTE: capex/opex/devex/production values below are exactly what the source export shipped for this asset —\n" +
    "this engine has no independent way to know what real-world units or scale they represent (millions of the\n" +
    "game's currency? per-MW?). Treat the absolute numbers as illustrative; what to actually verify here is\n" +
    "whether the year-to-year MECHANICS (down payment, loan amortizing to zero, offtake price expiring,\n" +
    "revenue = production x price) behave the way you'd expect.",
);
console.log("");

// DESIGN CHOICE FOR THIS DEMO (not an engine rule): acquire the asset in
// year 2, when its first real capex hits, rather than year 1 (whose capex
// is 0 for this asset) — see yearAdvance.ts's "financing only applies to
// the acquisition-year capex" assumption. Acquiring in year 1 here would
// mean the loan never actually finances anything, which makes for a
// boring demo.
const ACQUIRED_YEAR = 2;
const DEMO_YEARS = 14;
const STARTING_BALANCE = 5;

const lookup: AssetDataLookup = {
  financialsFor: (id, year) => (id === assetId ? financialsByYear.get(year) : undefined),
  productionFor: (id, year) => (id === assetId ? productionByYear.get(year) ?? [] : []),
  financingOptionById: (id) => (id === financing.id ? financing : undefined),
  offtakeOptionById: (id) => (id === offtake.id ? offtake : undefined),
};

let team: TeamState = {
  teamId: "demo-team",
  balance: STARTING_BALANCE,
  investments: [
    { investmentId: "demo-investment", assetId, acquiredYear: ACQUIRED_YEAR, financingOptionId: financing.id, offtakeOptionId: offtake.id },
  ],
};

const rng = createRng(20260916); // fixed seed: today's date, so re-runs are comparable
const pricePaths = generateAllPricePaths(areas, DEMO_YEARS, rng);
const noInterventionsThisDemo: InterventionEffect[] = [];

console.log(`Starting balance: ${STARTING_BALANCE}`);
console.log(`Acquiring in year ${ACQUIRED_YEAR}.\n`);

let capexMultiplier = 0;
for (let year = 1; year <= DEMO_YEARS; year++) {
  const basePrices = new Map<string, number>();
  for (const area of areas) {
    basePrices.set(area.id, pricePaths.get(area.id)?.[year - 1] ?? area.priceMean);
  }

  const result = advanceYear(
    { year, basePrices, capexMultiplier, interventionEffects: noInterventionsThisDemo, areaIdByName, teams: [team] },
    lookup,
  );
  capexMultiplier = result.capexMultiplier;
  const teamResult = result.teams[0]!;

  const electricityPrice = result.prices.get(productionAreaId);
  const line =
    teamResult.transactions.length === 0
      ? "(not yet owned)"
      : teamResult.transactions.map((t) => `${t.reason} ${t.delta >= 0 ? "+" : ""}${t.delta}`).join(", ");
  console.log(
    `Year ${String(year).padStart(2)} | Electricity price ${electricityPrice?.toFixed(2).padStart(7)} | ${line.padEnd(55)} | balance -> ${teamResult.balanceAfter}`,
  );

  team = { ...team, balance: teamResult.balanceAfter };
}

console.log(`\nFinal balance after ${DEMO_YEARS} years: ${team.balance}`);
