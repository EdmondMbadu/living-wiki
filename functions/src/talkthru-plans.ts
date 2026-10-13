// Pure TalkThru plan rules shared by the billing callables, the webhook, the
// listing-limit trigger and the team publish gate. Keep the browser catalog in
// src/app/talkthru-billing/talkthru-plans.ts identical; the parity test checks it.

export type TalkThruPlanKey = 'solo' | 'pro' | 'team';
export type TalkThruIndividualPlanKey = 'solo' | 'pro';
export type TalkThruBillingCycle = 'monthly' | 'annual';
export type TalkThruEffectivePlan = 'free' | TalkThruPlanKey;
export type TalkThruEntitlementSource = 'free' | 'admin' | 'comp' | 'personal' | 'team';

export const TALKTHRU_TRIAL_DAYS = 30;
/** Active (Public or Unlisted) personal TalkThrus allowed without a plan. */
export const TALKTHRU_FREE_ACTIVE_LIMIT = 1;
/** Published team listings allowed before the team needs the Agency & Team plan. */
export const TALKTHRU_TEAM_FREE_PUBLISHED_LIMIT = 1;
export const TALKTHRU_TEAM_MIN_SEATS = 3;
/** Larger agencies talk to us; checkout stops here. */
export const TALKTHRU_TEAM_MAX_SELF_SERVE_SEATS = 25;

export const TALKTHRU_PLAN_CATALOG = {
  solo: { label: 'Solo Agent', monthlyCents: 1900, annualCents: 19000, activeLimit: 10 },
  pro: { label: 'Agent Pro', monthlyCents: 3900, annualCents: 39000, activeLimit: null },
  team: {
    label: 'Agency & Team',
    // Graduated: seats 1-10 at the first rate, seats 11-25 at the second, so
    // adding an agent never lowers the team's bill.
    tiers: {
      monthly: [{ upTo: 10, unitCents: 2500 }, { upTo: 25, unitCents: 1900 }],
      annual: [{ upTo: 10, unitCents: 25000 }, { upTo: 25, unitCents: 19000 }],
    },
  },
} as const;

export interface TalkThruBillingRecord {
  plan?: unknown;
  billing_cycle?: unknown;
  status?: unknown;
  comp_plan?: unknown;
  seats?: unknown;
  stripe_customer_id?: unknown;
  stripe_subscription_id?: unknown;
  trial_end?: unknown;
  current_period_end?: unknown;
  cancel_at_period_end?: unknown;
  cancel_at?: unknown;
  last_checkout_session_id?: unknown;
  stripe_subscription_created?: unknown;
}

export interface TalkThruEntitlement {
  plan: TalkThruEffectivePlan;
  source: TalkThruEntitlementSource;
  /** null means unlimited. */
  activeLimit: number | null;
  videoExport: boolean;
  teamId: string;
}

export function talkThruLookupKey(plan: TalkThruPlanKey, cycle: TalkThruBillingCycle): string {
  return `talkthru_${plan}_${cycle}`;
}

export const TALKTHRU_LOOKUP_KEYS: readonly string[] = (['solo', 'pro', 'team'] as const)
  .flatMap((plan) => (['monthly', 'annual'] as const).map((cycle) => talkThruLookupKey(plan, cycle)));

export function parseTalkThruLookupKey(value: unknown): { plan: TalkThruPlanKey; cycle: TalkThruBillingCycle } | null {
  if (typeof value !== 'string') return null;
  const match = /^talkthru_(solo|pro|team)_(monthly|annual)$/.exec(value.trim());
  return match ? { plan: match[1] as TalkThruPlanKey, cycle: match[2] as TalkThruBillingCycle } : null;
}

export function normalizeTalkThruPlan(value: unknown): TalkThruPlanKey | null {
  return value === 'solo' || value === 'pro' || value === 'team' ? value : null;
}

export function normalizeTalkThruIndividualPlan(value: unknown): TalkThruIndividualPlanKey | null {
  return value === 'solo' || value === 'pro' ? value : null;
}

export function normalizeTalkThruCycle(value: unknown): TalkThruBillingCycle | null {
  return value === 'monthly' || value === 'annual' ? value : null;
}

/** Stripe statuses that keep the plan working. past_due is Stripe's retry window. */
export function talkThruStatusGrantsAccess(status: unknown): boolean {
  return status === 'trialing' || status === 'active' || status === 'past_due';
}

export function talkThruPlanRank(plan: TalkThruEffectivePlan): number {
  return plan === 'pro' || plan === 'team' ? 2 : plan === 'solo' ? 1 : 0;
}

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

/** Seats to buy: at least the minimum and everyone already on the team, never above self-serve. */
export function teamCheckoutSeats(requested: unknown, occupiedSeats: number): number {
  const floor = Math.max(TALKTHRU_TEAM_MIN_SEATS, Math.floor(occupiedSeats) || 0);
  const asked = typeof requested === 'number' && Number.isFinite(requested) ? Math.floor(requested) : floor;
  return Math.min(TALKTHRU_TEAM_MAX_SELF_SERVE_SEATS, Math.max(floor, asked));
}

function personalPlanFromRecord(record: TalkThruBillingRecord | null | undefined): TalkThruIndividualPlanKey | null {
  if (!record) return null;
  const plan = normalizeTalkThruIndividualPlan(record.plan);
  return plan && talkThruStatusGrantsAccess(record.status) ? plan : null;
}

export function resolveTalkThruEntitlement(input: {
  isAdmin: boolean;
  personal: TalkThruBillingRecord | null | undefined;
  teams: Array<{ teamId: string; record: TalkThruBillingRecord | null | undefined }>;
}): TalkThruEntitlement {
  if (input.isAdmin) return { plan: 'pro', source: 'admin', activeLimit: null, videoExport: true, teamId: '' };
  const candidates: TalkThruEntitlement[] = [];
  const personalPlan = personalPlanFromRecord(input.personal);
  if (personalPlan) candidates.push(entitlementFor(personalPlan, 'personal'));
  const comp = normalizeTalkThruIndividualPlan(input.personal?.comp_plan);
  if (comp) candidates.push(entitlementFor(comp, 'comp'));
  for (const team of input.teams) {
    if (normalizeTalkThruPlan(team.record?.plan) === 'team' && talkThruStatusGrantsAccess(team.record?.status)) {
      candidates.push({ ...entitlementFor('team', 'team'), teamId: team.teamId });
    }
  }
  // Highest plan wins; on a tie prefer the person's own subscription so its
  // dates are the ones shown.
  const order: TalkThruEntitlementSource[] = ['personal', 'comp', 'team'];
  candidates.sort((left, right) =>
    talkThruPlanRank(right.plan) - talkThruPlanRank(left.plan)
    || order.indexOf(left.source) - order.indexOf(right.source));
  return candidates[0] ?? {
    plan: 'free',
    source: 'free',
    activeLimit: TALKTHRU_FREE_ACTIVE_LIMIT,
    videoExport: false,
    teamId: '',
  };
}

function entitlementFor(plan: TalkThruPlanKey, source: TalkThruEntitlementSource): TalkThruEntitlement {
  return {
    plan,
    source,
    activeLimit: plan === 'solo' ? TALKTHRU_PLAN_CATALOG.solo.activeLimit : null,
    videoExport: plan !== 'solo',
    teamId: '',
  };
}

type BoardLike = Record<string, unknown> | null | undefined;

function cardTags(card: unknown): Set<string> {
  const record = card && typeof card === 'object' ? card as Record<string, unknown> : {};
  const tags = Array.isArray(record['tags']) ? record['tags'] : [];
  return new Set(tags.filter((tag): tag is string => typeof tag === 'string').map((tag) => tag.trim().toLowerCase()));
}

/** Same signal as the browser's isRealEstateTalkThru, plus Rental TalkThrus (listing-story). */
export function isTalkThruBoardRecord(board: BoardLike): boolean {
  if (!board) return false;
  const cards = Array.isArray(board['cards']) ? board['cards'] : [];
  if (cards.some((card) => {
    const tags = cardTags(card);
    return tags.has('listing-story') || (tags.has('real-estate') && tags.has('listing'));
  })) return true;
  return /real estate virtualtalkthru/i.test(`${board['title'] ?? ''} ${board['description'] ?? ''}`);
}

export function isLinkReadableTalkThruVisibility(value: unknown): boolean {
  return value === 'public' || value === 'unlisted';
}

/** A personal TalkThru that visitors can open. Team snapshots and child boards never count. */
export function isActivePersonalTalkThru(board: BoardLike): boolean {
  if (!board) return false;
  if (typeof board['team_id'] === 'string' && board['team_id']) return false;
  if (typeof board['parentBoardId'] === 'string' && board['parentBoardId']) return false;
  return isLinkReadableTalkThruVisibility(board['visibility']) && isTalkThruBoardRecord(board);
}

export interface TalkThruListingSummary {
  id: string;
  visibility: string;
  updatedAt: string;
}

/** Keep the most recently updated listings live; return the rest to pause. */
export function talkThruListingsToPause(active: readonly TalkThruListingSummary[], limit: number | null): string[] {
  if (limit === null || active.length <= limit) return [];
  return [...active]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
    .slice(Math.max(0, limit))
    .map((listing) => listing.id);
}

/** Paused listings to bring back, most recently paused first, within the plan's room. */
export function talkThruListingsToRestore(
  paused: ReadonlyArray<{ id: string; pausedAt: number }>,
  activeCount: number,
  limit: number | null,
): string[] {
  const room = limit === null ? paused.length : Math.max(0, limit - activeCount);
  return [...paused]
    .sort((left, right) => right.pausedAt - left.pausedAt || left.id.localeCompare(right.id))
    .slice(0, room)
    .map((listing) => listing.id);
}

/** Relative in-app path only; anything else falls back to the TalkThru plan page. */
export function safeTalkThruReturnPath(value: unknown): string {
  const path = typeof value === 'string' ? value.trim() : '';
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || path.length > 500) {
    return '/talkthrus/billing';
  }
  return /^[\x20-\x7e]+$/.test(path) ? path : '/talkthrus/billing';
}

export function withCheckoutParams(path: string, outcome: 'success' | 'cancelled'): string {
  const [base, hash = ''] = path.split('#', 2);
  const cleaned = base
    .replace(/([?&])(talkthruCheckout|session_id)=[^&]*/g, '$1')
    .replace(/[?&]+$/, '')
    .replace(/\?&+/, '?')
    .replace(/&&+/g, '&');
  const separator = cleaned.includes('?') ? '&' : '?';
  const query = outcome === 'success'
    ? `talkthruCheckout=success&session_id={CHECKOUT_SESSION_ID}`
    : 'talkthruCheckout=cancelled';
  return `${cleaned}${separator}${query}${hash ? `#${hash}` : ''}`;
}
