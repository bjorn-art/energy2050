/**
 * CSR_INTERVENTION choice handling.
 *
 * Unlike the effects in interventions.ts (which apply automatically, the
 * same way, to every team, the moment an intervention fires), a
 * CSR_INTERVENTION presents each team with a menu of choices
 * (intervention_effect_choices: text + choiceType POSITIVE/NEGATIVE/NONE +
 * whether the choice requires the team to enter an amount) and only takes
 * effect once a team actually picks one — so it needs a UI (the
 * facilitator console or team app, Phase 3+) to collect that choice, not
 * just market data. This file is the pure-function piece that UI will call
 * once it has a team's answer: given the choice they picked and the amount
 * they're spending, what happens to their balance and their reputation.
 *
 * CONFIRMED with Bjorn (2026-09-16): a POSITIVE choice should build a
 * team's reputation/goodwill score, a NEGATIVE choice should hurt it — on
 * top of the spend itself, which was already the one part the source
 * export made unambiguous ("the spend itself is just a balance
 * transaction"). Reputation doesn't yet affect anything else in the
 * engine; it's tracked so a later phase (leaderboard, unlocking a
 * support-requiring financing option, etc. — to be designed) has
 * something to build on, per Bjorn's own framing of the idea. There's no
 * `teams.reputation` column yet — that's a small schema addition for
 * whichever phase first calls this function from real UI, not something
 * this pure-math phase needs to carry.
 */

export type CsrChoiceType = "POSITIVE" | "NEGATIVE" | "NONE";

export type CsrChoiceResult = {
  /** Always <= 0: the amount spent, deducted from the team's balance. */
  balanceDelta: number;
  /** +amount for POSITIVE, -amount for NEGATIVE, 0 for NONE. */
  reputationDelta: number;
};

/**
 * @param amount the amount the team is spending on this choice (from the
 *   effect's base `amount`, or a custom value the team entered when the
 *   choice's `requiresAmount` is true). Negative input is treated as 0 —
 *   this function only ever spends, never adds, to balance.
 */
export function applyCsrChoice(choiceType: CsrChoiceType, amount: number): CsrChoiceResult {
  const spend = Math.max(0, amount);
  const reputationDelta = choiceType === "POSITIVE" ? spend : choiceType === "NEGATIVE" ? -spend : 0;
  return {
    balanceDelta: round2(-spend),
    reputationDelta: round2(reputationDelta),
  };
}

function round2(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? 0 : rounded; // normalize -0 to 0 (e.g. round2(-0) from a 0 spend)
}
