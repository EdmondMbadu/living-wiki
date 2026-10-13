// Browser copy of the TalkThru plan catalog. Keep it identical to
// functions/src/talkthru-plans.ts; functions/scripts/test-talkthru-billing.cjs checks parity.
// No imports here: the parity test evaluates this file on its own.

export type TalkThruPlanKey = 'solo' | 'pro' | 'team';
export type TalkThruIndividualPlanKey = 'solo' | 'pro';
export type TalkThruBillingCycle = 'monthly' | 'annual';
export type TalkThruEffectivePlan = 'free' | TalkThruPlanKey;

export const TALKTHRU_TRIAL_DAYS = 30;
export const TALKTHRU_FREE_ACTIVE_LIMIT = 1;
export const TALKTHRU_TEAM_FREE_PUBLISHED_LIMIT = 1;
export const TALKTHRU_TEAM_MIN_SEATS = 3;
export const TALKTHRU_TEAM_MAX_SELF_SERVE_SEATS = 25;

export const TALKTHRU_PLAN_CATALOG = {
  solo: { label: 'Solo Agent', monthlyCents: 1900, annualCents: 19000, activeLimit: 10 },
  pro: { label: 'Agent Pro', monthlyCents: 3900, annualCents: 39000, activeLimit: null },
  team: {
    label: 'Agency & Team',
    tiers: {
      monthly: [{ upTo: 10, unitCents: 2500 }, { upTo: 25, unitCents: 1900 }],
      annual: [{ upTo: 10, unitCents: 25000 }, { upTo: 25, unitCents: 19000 }],
    },
  },
} as const;

export function teamSeatTotalCents(seats: number, cycle: TalkThruBillingCycle): number {
  const count = Math.max(0, Math.floor(seats));
  let remaining = count;
  let previousCap = 0;
  let total = 0;
  for (const tier of TALKTHRU_PLAN_CATALOG.team.tiers[cycle]) {
    const inTier = Math.min(remaining, tier.upTo - previousCap);
    total += inTier * tier.unitCents;
    remaining -= inTier;
    previousCap = tier.upTo;
    if (remaining <= 0) break;
  }
  return total;
}

export function individualPlanCents(plan: TalkThruIndividualPlanKey, cycle: TalkThruBillingCycle): number {
  const entry = TALKTHRU_PLAN_CATALOG[plan];
  return cycle === 'annual' ? entry.annualCents : entry.monthlyCents;
}

export function formatUsd(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars.toLocaleString('en-US')}` : `$${dollars.toFixed(2)}`;
}

export function planRank(plan: TalkThruEffectivePlan | null | undefined): number {
  return plan === 'pro' || plan === 'team' ? 2 : plan === 'solo' ? 1 : 0;
}

/** Sale or Rental TalkThru, matching the server's isTalkThruBoardRecord. */
export function isTalkThruBoardLike(board: {
  title?: string | null;
  description?: string | null;
  cards?: ReadonlyArray<{ tags?: readonly string[] | null }> | null;
} | null | undefined): boolean {
  if (!board) return false;
  const listing = (board.cards ?? []).some((card) => {
    const tags = new Set((card.tags ?? []).map((tag) => tag.trim().toLowerCase()));
    return tags.has('listing-story') || (tags.has('real-estate') && tags.has('listing'));
  });
  return listing || /real estate virtualtalkthru/i.test(`${board.title ?? ''} ${board.description ?? ''}`);
}
