/**
 * Shared domain types, mirroring the schema in
 * supabase/migrations/00000000000001_init.sql.
 *
 * These aren't wired up to a database client yet (that lands with the
 * Phase 2 simulation engine) — for now they document the shape of the data
 * the import script produces, and give later work something to import
 * instead of re-deriving these shapes from scratch.
 */

export type Area = {
  id: string;
  templateId: string;
  name: string;
  type: string;
  productionUnit: string;
  randomizePrice: boolean;
  priceDrift: number;
  priceStandardDeviation: number;
  priceInflation: number;
  priceMean: number;
  minPrice: number;
  maxPrice: number;
  merchantPrice: number;
  co2EmittedPerProduction: number;
};

export type Asset = {
  id: string;
  templateId: string;
  name: string;
  assetType: string;
  xCoordinate: number | null;
  yCoordinate: number | null;
  capacity: number;
  capacityFactor: number | null;
  risk: number;
  minimumAccessCost: number;
  minimumBid: number;
  isVisible: boolean;
  isExploration: boolean;
  taxType: string | null;
  royalty: boolean;
  electrificationStart: number | null;
  availableFromYear: number | null;
  iconName: string | null;
  capexIconName: string | null;
  mapName: string | null;
  description: string[];
};

export type AssetYearFinancials = {
  assetId: string;
  year: number;
  capex: number;
  opex: number;
  devex: number;
};

export type AssetProduction = {
  assetId: string;
  areaId: string;
  year: number;
  production: number;
};

export type AssetFinancingOption = {
  id: string;
  assetId: string;
  lender: string;
  interestRatePercent: number;
  financedPercent: number;
  requiresSupport: boolean;
  downPaymentYears: number;
};

export type AssetOfftakeOption = {
  id: string;
  assetId: string;
  name: string;
  offtakeType: string;
  supportPeriod: number | null;
  supportPrice: number | null;
};

export type Intervention = {
  id: string;
  templateId: string;
  key: string;
  name: string;
  year: number | null;
  recipients: string;
  subject: string | null;
  message: string | null;
  photoPath: string | null;
  dependsOn: string[];
};

export type InterventionEffect = {
  id: string;
  interventionId: string;
  effectType: string;
  amount: number;
  areaId: string | null;
};

export type InterventionEffectChoice = {
  id: string;
  effectId: string;
  text: string;
  choiceType: "POSITIVE" | "NEGATIVE" | "NONE";
  requiresAmount: boolean;
};

export type AssetIntervention = {
  id: string;
  templateId: string;
  assetId: string | null;
  assetName: string | null;
  name: string;
  year: number | null;
  subject: string | null;
  message: string | null;
  choiceText: string | null;
  photoPath: string | null;
  isAdditive: boolean | null;
  capacity: number | null;
  capacityFactor: number | null;
  taxType: string | null;
  royalty: boolean | null;
  electrificationTime: number | null;
  simulateAlternatives: boolean;
  dependency: string | null;
};
