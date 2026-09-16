/**
 * Loan amortization and offtake price resolution — the two ways an asset's
 * cash flow differs depending on how a team chose to acquire and sell from
 * it (from asset_financing_options and asset_offtake_options).
 */

import type { AssetFinancingOption, AssetOfftakeOption } from "./types";

export type LoanScheduleRow = {
  /** 1-indexed year of the loan, not the game year — year 1 is the first
   *  year of repayment, whatever game year that lands on. */
  year: number;
  payment: number;
  interest: number;
  principal: number;
  remainingBalance: number;
};

/**
 * Standard equal-payment (annuity-style) amortization: the same total
 * payment every year, split between interest (shrinking, since it's
 * charged on the shrinking remaining balance) and principal (growing) so
 * the loan is exactly paid off after `termYears`.
 *
 * @param principal the financed amount (capex * financedPercent / 100 — the
 *   caller computes this; this function only knows about the loan itself)
 */
export function generateLoanSchedule(
  principal: number,
  interestRatePercent: number,
  termYears: number,
): LoanScheduleRow[] {
  if (termYears <= 0 || principal <= 0) return [];

  const rate = interestRatePercent / 100;
  const payment =
    rate === 0
      ? principal / termYears
      : (principal * rate) / (1 - Math.pow(1 + rate, -termYears));

  const schedule: LoanScheduleRow[] = [];
  let remaining = principal;

  for (let year = 1; year <= termYears; year++) {
    const interest = round2(remaining * rate);
    // Last payment clears whatever's left exactly, so rounding across the
    // whole schedule can't leave a stray cent of balance outstanding.
    const isLastYear = year === termYears;
    const principalPortion = isLastYear ? remaining : round2(payment - interest);
    remaining = round2(remaining - principalPortion);
    schedule.push({
      year,
      payment: round2(principalPortion + interest),
      interest,
      principal: principalPortion,
      remainingBalance: Math.max(0, remaining),
    });
  }

  return schedule;
}

/**
 * The price a team actually realizes for an asset's output in a given
 * year: the offtake's fixed support price while still within its
 * `supportPeriod` (counted from the year the asset was acquired/built,
 * inclusive), the prevailing market price after that or if there's no
 * offtake agreement at all.
 */
export function resolveOfftakePrice(
  offtake: AssetOfftakeOption | null | undefined,
  yearsSinceAcquired: number,
  marketPrice: number,
): number {
  if (!offtake) return marketPrice;
  if (offtake.offtakeType !== "Fixed") return marketPrice;
  if (offtake.supportPrice == null) return marketPrice;
  if (offtake.supportPeriod == null) return offtake.supportPrice;
  return yearsSinceAcquired <= offtake.supportPeriod ? offtake.supportPrice : marketPrice;
}

/** Convenience for turning a chosen financing option + capex into a schedule. */
export function loanScheduleForFinancing(
  financing: AssetFinancingOption,
  assetCapex: number,
): LoanScheduleRow[] {
  const principal = round2((assetCapex * financing.financedPercent) / 100);
  return generateLoanSchedule(principal, financing.interestRatePercent, financing.downPaymentYears);
}

function round2(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? 0 : rounded; // normalize -0
}
