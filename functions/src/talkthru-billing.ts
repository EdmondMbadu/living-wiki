import { createHash } from 'node:crypto';
import type Stripe from 'stripe';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { defineString } from 'firebase-functions/params';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';
import { db } from './firebase';
import { allowedCheckoutOrigins, getStripeClient as defaultStripeClient, stripeMode, stripeSecretKey } from './stripe-client';
import { sendTalkThruPaymentFailedEmail, sendTalkThruTrialEndingEmail } from './talkthru-billing-email';
import {
  ensureTalkThruCatalog,
  ensureTalkThruPortals,
  readTalkThruStripeConfig,
  runTalkThruStripeSetup,
  saveTalkThruStripeConfig,
} from './talkthru-stripe-setup';
import { requireTeamMember, unpublishTeamListingsOverFreeLimit } from './teams';
import {
  activeTalkThruCount,
  listPersonalTalkThrus,
  loadTalkThruEntitlement,
  talkThruBillingCollection,
  talkThruPausedBoardsCollection,
  talkThruTeamBillingCollection,
  talkThruTrialClaimsCollection,
  teamBillingRecord,
  teamPlanActive,
} from './talkthru-billing-access';
import {
  TALKTHRU_LOOKUP_KEYS,
  TALKTHRU_TEAM_FREE_PUBLISHED_LIMIT,
  TALKTHRU_TEAM_MAX_SELF_SERVE_SEATS,
  TALKTHRU_TEAM_MIN_SEATS,
  TALKTHRU_TRIAL_DAYS,
  isActivePersonalTalkThru,
  isLinkReadableTalkThruVisibility,
  isTalkThruBoardRecord,
  normalizeTalkThruCycle,
  normalizeTalkThruPlan,
  parseTalkThruLookupKey,
  safeTalkThruReturnPath,
  talkThruListingsToPause,
  talkThruListingsToRestore,
  talkThruLookupKey,
  talkThruPlanRank,
  talkThruStatusGrantsAccess,
  teamCheckoutSeats,
  withCheckoutParams,
  type TalkThruBillingCycle,
  type TalkThruBillingRecord,
  type TalkThruIndividualPlanKey,
  type TalkThruPlanKey,
} from './talkthru-plans';

const region = 'us-central1';
const fallbackOrigin = 'https://livingwiki.com';
const idPattern = /^[A-Za-z0-9_-]{1,180}$/;
// Customer Portal configurations created by functions/scripts/setup-talkthru-stripe.cjs.
// Personal: switch Solo/Pro and monthly/annual. Team: change seats and cycle.
// Kept separate so a portal session can never move a team onto a personal price.
const personalPortalConfigurationId = defineString('STRIPE_TALKTHRU_PORTAL_CONFIGURATION', { default: '' });
const teamPortalConfigurationId = defineString('STRIPE_TALKTHRU_TEAM_PORTAL_CONFIGURATION', { default: '' });

// Tests swap in a fake Stripe client; production always uses the shared one.
let stripeClientFactory: () => Stripe = defaultStripeClient;
export function setTalkThruStripeClientForTests(factory: (() => Stripe) | null): void {
  stripeClientFactory = factory ?? defaultStripeClient;
  priceCache = null;
}
function getStripeClient(): Stripe {
  return stripeClientFactory();
}

// ---------------------------------------------------------------- helpers

function text(value: unknown, max = 200): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function checkedId(value: unknown, label: string): string {
  const id = text(value, 180);
  if (!idPattern.test(id)) throw new HttpsError('invalid-argument', `Invalid ${label}.`);
  return id;
}

function isoOrNull(value: unknown): string | null {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return null;
}

function secondsToTimestamp(value: number | null | undefined): Timestamp | null {
  return typeof value === 'number' && value > 0 ? Timestamp.fromMillis(value * 1000) : null;
}

function emailClaimKey(email: string): string {
  return `email_${createHash('sha256').update(email.trim().toLowerCase()).digest('hex')}`;
}

function requestOrigin(request: CallableRequest): string {
  const header = request.rawRequest?.headers?.origin;
  return typeof header === 'string' && allowedCheckoutOrigins.has(header) ? header : fallbackOrigin;
}

function customerIdOf(value: string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined): string {
  if (!value) return '';
  return typeof value === 'string' ? value : value.id;
}

function subscriptionView(record: TalkThruBillingRecord | null) {
  if (!record || !text(record.stripe_subscription_id)) return null;
  return {
    plan: normalizeTalkThruPlan(record.plan),
    billingCycle: normalizeTalkThruCycle(record.billing_cycle) ?? 'monthly',
    status: text(record.status, 40),
    seats: Number(record.seats) || 1,
    trialEndsAt: isoOrNull(record.trial_end),
    currentPeriodEnd: isoOrNull(record.current_period_end),
    cancelAtPeriodEnd: record.cancel_at_period_end === true,
    cancelAt: isoOrNull(record.cancel_at),
  };
}

let priceCache: { at: number; prices: Map<string, Stripe.Price> } | null = null;

async function loadPrices(): Promise<Map<string, Stripe.Price>> {
  const list = await getStripeClient().prices.list({
    lookup_keys: [...TALKTHRU_LOOKUP_KEYS],
    active: true,
    limit: 10,
  });
  return new Map(list.data.filter((price) => !!price.lookup_key).map((price) => [price.lookup_key!, price]));
}

async function talkThruPrice(plan: TalkThruPlanKey, cycle: TalkThruBillingCycle): Promise<Stripe.Price> {
  const lookupKey = talkThruLookupKey(plan, cycle);
  if (!priceCache || Date.now() - priceCache.at > 10 * 60_000) {
    priceCache = { at: Date.now(), prices: await loadPrices() };
  }
  if (!priceCache.prices.has(lookupKey)) {
    // First checkout on a fresh Stripe account (or after a key change): create
    // the products and prices from the plan catalog, then look again.
    logger.warn('TalkThru Stripe prices missing; creating the catalog', { lookupKey, mode: stripeMode() });
    await ensureTalkThruCatalog(getStripeClient(), true);
    priceCache = { at: Date.now(), prices: await loadPrices() };
  }
  const price = priceCache.prices.get(lookupKey);
  if (!price) {
    logger.error('TalkThru Stripe price is missing after setup', { lookupKey });
    throw new HttpsError('failed-precondition', 'TalkThru plans are not available yet. Please try again later.');
  }
  return price;
}

/** Portal configuration for this scope: env override, then saved setup, then create it now. */
async function portalConfigurationFor(scope: 'personal' | 'team'): Promise<string> {
  const override = scope === 'team' ? teamPortalConfigurationId.value() : personalPortalConfigurationId.value();
  if (override) return override;
  const mode = stripeMode();
  const saved = await readTalkThruStripeConfig(mode);
  const savedId = scope === 'team' ? saved.portal_team : saved.portal_personal;
  if (savedId) return savedId;
  const stripe = getStripeClient();
  const catalog = await ensureTalkThruCatalog(stripe, true);
  const portals = await ensureTalkThruPortals(stripe, catalog, fallbackOrigin, true);
  await saveTalkThruStripeConfig(mode, catalog, portals);
  return scope === 'team' ? portals.team : portals.personal;
}

/** Expire the previous unfinished checkout so two tabs can never create two subscriptions. */
async function expirePreviousCheckout(sessionId: unknown): Promise<void> {
  const id = text(sessionId, 255);
  if (!/^cs_[A-Za-z0-9_]+$/.test(id)) return;
  try {
    const stripe = getStripeClient();
    const previous = await stripe.checkout.sessions.retrieve(id);
    if (previous.status === 'open') await stripe.checkout.sessions.expire(id);
  } catch (error) {
    logger.warn('Previous TalkThru checkout could not be expired', { id, error });
  }
}

async function trialEligible(keys: readonly string[]): Promise<boolean> {
  if (!keys.length) return false;
  const snapshots = await db.getAll(...keys.map((key) => talkThruTrialClaimsCollection.doc(key)));
  return snapshots.every((snapshot) => !snapshot.exists);
}

function personalTrialKeys(uid: string, email: string): string[] {
  return [`user_${uid}`, ...(email ? [emailClaimKey(email)] : [])];
}

async function teamOccupancy(teamId: string): Promise<{ activeMembers: number; pendingInvites: number }> {
  const [members, pending] = await Promise.all([
    db.collection('teams').doc(teamId).collection('members').where('status', '==', 'active').get(),
    db.collection('team_invitations').where('team_id', '==', teamId).where('status', '==', 'pending').get(),
  ]);
  const now = Date.now();
  return {
    activeMembers: members.size,
    pendingInvites: pending.docs.filter((doc) => Number(doc.data()['expires_at_ms'] || 0) > now).length,
  };
}

// ---------------------------------------------------------------- status

async function personalStatus(uid: string, email: string) {
  const [{ entitlement, personal }, listings, paused] = await Promise.all([
    loadTalkThruEntitlement(uid),
    listPersonalTalkThrus(uid),
    talkThruPausedBoardsCollection.where('owner_user_id', '==', uid).limit(100).get(),
  ]);
  const subscription = subscriptionView(personal);
  const hasLiveSubscription = !!subscription && talkThruStatusGrantsAccess(subscription.status);
  return {
    plan: entitlement.plan,
    source: entitlement.source,
    teamId: entitlement.teamId,
    activeLimit: entitlement.activeLimit,
    activeCount: activeTalkThruCount(listings),
    totalCount: listings.length,
    pausedBoardIds: paused.docs.map((doc) => doc.id),
    videoExport: entitlement.videoExport,
    subscription,
    canManageBilling: !!text(personal?.stripe_customer_id),
    trialEligible: !hasLiveSubscription && await trialEligible(personalTrialKeys(uid, email)),
  };
}

async function teamStatus(teamId: string, uid: string) {
  const { team, member } = await requireTeamMember(teamId, uid);
  const [record, occupancy, published] = await Promise.all([
    teamBillingRecord(teamId),
    teamOccupancy(teamId),
    db.collection('teams').doc(teamId).collection('listings').where('status', '==', 'published').get(),
  ]);
  const admin = member['role'] === 'admin';
  const active = teamPlanActive(record);
  return {
    teamId,
    teamName: text(team['name'], 120),
    teamStatus: text(team['status'], 20),
    canManage: admin,
    plan: active ? 'team' : 'free',
    subscription: subscriptionView(record),
    activeMembers: occupancy.activeMembers,
    pendingInvites: occupancy.pendingInvites,
    publishedCount: published.size,
    freePublishedLimit: TALKTHRU_TEAM_FREE_PUBLISHED_LIMIT,
    canManageBilling: admin && !!text(record?.stripe_customer_id),
    trialEligible: !active && await trialEligible([`team_${teamId}`]),
  };
}

// ---------------------------------------------------------------- checkout

type CheckoutResult =
  | { outcome: 'checkout'; url: string }
  | { outcome: 'changed' | 'unchanged' | 'included'; plan: TalkThruPlanKey; billingCycle: TalkThruBillingCycle };

async function createSessionWithCustomerFallback(
  params: Stripe.Checkout.SessionCreateParams,
  customerId: string,
  email: string,
): Promise<Stripe.Checkout.Session> {
  const stripe = getStripeClient();
  if (customerId) {
    try {
      return await stripe.checkout.sessions.create({ ...params, customer: customerId });
    } catch (error) {
      // A customer deleted in the Stripe dashboard should not block a new checkout.
      if ((error as { code?: string })?.code !== 'resource_missing') throw error;
      logger.warn('Stored TalkThru Stripe customer is missing; starting a fresh checkout.', { customerId });
    }
  }
  return stripe.checkout.sessions.create({ ...params, ...(email ? { customer_email: email } : {}) });
}

async function changeExistingSubscription(
  subscriptionId: string,
  price: Stripe.Price,
  plan: TalkThruPlanKey,
  cycle: TalkThruBillingCycle,
): Promise<CheckoutResult | null> {
  const stripe = getStripeClient();
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  if (!talkThruStatusGrantsAccess(subscription.status)) return null;
  const item = subscription.items.data[0];
  if (!item) return null;
  if (item.price?.id === price.id && !subscription.cancel_at_period_end) {
    await syncTalkThruSubscription(subscription);
    return { outcome: 'unchanged', plan, billingCycle: cycle };
  }
  const updated = await stripe.subscriptions.update(subscription.id, {
    items: [{ id: item.id, price: price.id, quantity: item.quantity ?? 1 }],
    proration_behavior: 'create_prorations',
    // Choosing a plan again means they want to keep it.
    cancel_at_period_end: false,
    metadata: { ...subscription.metadata, plan, billingCycle: cycle },
  });
  await syncTalkThruSubscription(updated);
  return { outcome: 'changed', plan, billingCycle: cycle };
}

async function startPersonalCheckout(
  uid: string,
  email: string,
  plan: TalkThruIndividualPlanKey,
  cycle: TalkThruBillingCycle,
  successUrl: string,
  cancelUrl: string,
): Promise<CheckoutResult> {
  const { entitlement, personal } = await loadTalkThruEntitlement(uid);
  if (
    entitlement.source === 'admin'
    || ((entitlement.source === 'team' || entitlement.source === 'comp')
      && talkThruPlanRank(entitlement.plan) >= talkThruPlanRank(plan))
  ) {
    return { outcome: 'included', plan, billingCycle: cycle };
  }
  const price = await talkThruPrice(plan, cycle);
  const subscriptionId = text(personal?.stripe_subscription_id);
  if (subscriptionId && talkThruStatusGrantsAccess(personal?.status)) {
    const changed = await changeExistingSubscription(subscriptionId, price, plan, cycle);
    if (changed) return changed;
  }
  await expirePreviousCheckout(personal?.last_checkout_session_id);
  const trialKeys = personalTrialKeys(uid, email);
  const eligible = await trialEligible(trialKeys);
  const metadata = {
    source: 'talkthru',
    scope: 'user',
    userId: uid,
    plan,
    billingCycle: cycle,
    trialClaimKeys: trialKeys.join(','),
  };
  const session = await createSessionWithCustomerFallback({
    mode: 'subscription',
    line_items: [{ price: price.id, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: uid,
    allow_promotion_codes: true,
    payment_method_collection: 'always',
    subscription_data: {
      metadata,
      ...(eligible ? { trial_period_days: TALKTHRU_TRIAL_DAYS } : {}),
    },
    metadata,
  }, text(personal?.stripe_customer_id), email);
  await talkThruBillingCollection.doc(uid).set({
    last_checkout_session_id: session.id,
    last_checkout_plan: plan,
    last_checkout_started_at: FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp(),
  }, { merge: true });
  if (!session.url) throw new HttpsError('internal', 'Checkout could not be started. Please try again.');
  return { outcome: 'checkout', url: session.url };
}

async function startTeamCheckout(
  uid: string,
  email: string,
  teamId: string,
  requestedSeats: unknown,
  cycle: TalkThruBillingCycle,
  successUrl: string,
  cancelUrl: string,
): Promise<CheckoutResult> {
  const { team } = await requireTeamMember(teamId, uid, true);
  if (team['status'] !== 'active') {
    throw new HttpsError('failed-precondition', 'Restore this team before choosing a plan.');
  }
  const [record, occupancy] = await Promise.all([teamBillingRecord(teamId), teamOccupancy(teamId)]);
  const occupied = occupancy.activeMembers + occupancy.pendingInvites;
  const price = await talkThruPrice('team', cycle);
  const subscriptionId = text(record?.stripe_subscription_id);
  if (subscriptionId && teamPlanActive(record)) {
    const changed = await changeExistingSubscription(subscriptionId, price, 'team', cycle);
    if (changed) return changed;
  }
  if (occupied > TALKTHRU_TEAM_MAX_SELF_SERVE_SEATS) {
    throw new HttpsError(
      'failed-precondition',
      `Teams with more than ${TALKTHRU_TEAM_MAX_SELF_SERVE_SEATS} agents get a custom plan. Use “Let’s talk” on the TalkThrus page and we’ll set it up with you.`,
    );
  }
  await expirePreviousCheckout(record?.last_checkout_session_id);
  const seats = teamCheckoutSeats(requestedSeats, occupied);
  const trialKeys = [`team_${teamId}`];
  const eligible = await trialEligible(trialKeys);
  const metadata = {
    source: 'talkthru',
    scope: 'team',
    teamId,
    userId: uid,
    plan: 'team',
    billingCycle: cycle,
    trialClaimKeys: trialKeys.join(','),
  };
  const session = await createSessionWithCustomerFallback({
    mode: 'subscription',
    line_items: [{
      price: price.id,
      quantity: seats,
      adjustable_quantity: {
        enabled: true,
        minimum: Math.max(TALKTHRU_TEAM_MIN_SEATS, occupied),
        maximum: TALKTHRU_TEAM_MAX_SELF_SERVE_SEATS,
      },
    }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: uid,
    allow_promotion_codes: true,
    payment_method_collection: 'always',
    subscription_data: {
      metadata,
      ...(eligible ? { trial_period_days: TALKTHRU_TRIAL_DAYS } : {}),
    },
    metadata,
  }, text(record?.stripe_customer_id), email);
  await talkThruTeamBillingCollection.doc(teamId).set({
    last_checkout_session_id: session.id,
    last_checkout_by: uid,
    last_checkout_started_at: FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp(),
  }, { merge: true });
  if (!session.url) throw new HttpsError('internal', 'Checkout could not be started. Please try again.');
  return { outcome: 'checkout', url: session.url };
}

async function confirmCheckout(uid: string, sessionIdValue: unknown) {
  const sessionId = text(sessionIdValue, 255);
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) throw new HttpsError('invalid-argument', 'Invalid checkout session.');
  const session = await getStripeClient().checkout.sessions.retrieve(sessionId);
  const metadata = session.metadata ?? {};
  if (metadata['source'] !== 'talkthru') {
    throw new HttpsError('permission-denied', 'This checkout session is not a TalkThru plan.');
  }
  const scope = metadata['scope'] === 'team' ? 'team' : 'user';
  const teamId = scope === 'team' ? checkedId(metadata['teamId'], 'team') : '';
  if (scope === 'user' && metadata['userId'] !== uid) {
    throw new HttpsError('permission-denied', 'This checkout session belongs to another account.');
  }
  if (scope === 'team') await requireTeamMember(teamId, uid);
  const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id ?? '';
  if (session.status !== 'complete' || !subscriptionId) {
    return { outcome: 'pending', scope, teamId };
  }
  const subscription = await getStripeClient().subscriptions.retrieve(subscriptionId);
  await syncTalkThruSubscription(subscription);
  const plan = parseTalkThruLookupKey(subscription.items.data[0]?.price?.lookup_key)?.plan
    ?? normalizeTalkThruPlan(metadata['plan']);
  return {
    outcome: 'confirmed',
    scope,
    teamId,
    plan,
    status: subscription.status,
    trialEndsAt: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
  };
}

async function openPortal(request: CallableRequest, uid: string) {
  const data = (request.data ?? {}) as Record<string, unknown>;
  const teamId = data['teamId'] ? checkedId(data['teamId'], 'team') : '';
  let customerId = '';
  if (teamId) {
    await requireTeamMember(teamId, uid, true);
    customerId = text((await teamBillingRecord(teamId))?.stripe_customer_id);
  } else {
    customerId = text((await talkThruBillingCollection.doc(uid).get()).data()?.['stripe_customer_id']);
  }
  if (!customerId) {
    throw new HttpsError('failed-precondition', 'There is no billing account yet. Start a plan first.');
  }
  const origin = requestOrigin(request);
  const configuration = await portalConfigurationFor(teamId ? 'team' : 'personal');
  const session = await getStripeClient().billingPortal.sessions.create({
    customer: customerId,
    return_url: `${origin}${safeTalkThruReturnPath(data['returnPath'])}`,
    ...(configuration ? { configuration } : {}),
  });
  return { url: session.url };
}

// ---------------------------------------------------------------- sync + reconcile

export async function syncTalkThruSubscriptionById(subscriptionId: string): Promise<void> {
  if (!subscriptionId) return;
  // Always read the current object: webhook events can arrive out of order.
  const subscription = await getStripeClient().subscriptions.retrieve(subscriptionId);
  await syncTalkThruSubscription(subscription);
}

export async function syncTalkThruSubscription(subscription: Stripe.Subscription): Promise<void> {
  const metadata = subscription.metadata ?? {};
  if (metadata['source'] !== 'talkthru') return;
  const scope = metadata['scope'] === 'team' ? 'team' : 'user';
  const ownerId = text(scope === 'team' ? metadata['teamId'] : metadata['userId'], 180);
  if (!idPattern.test(ownerId)) {
    logger.warn('TalkThru subscription is missing its owner metadata', { subscriptionId: subscription.id });
    return;
  }
  const item = subscription.items.data[0];
  const parsed = parseTalkThruLookupKey(item?.price?.lookup_key);
  const plan = parsed?.plan ?? normalizeTalkThruPlan(metadata['plan']);
  const cycle: TalkThruBillingCycle = parsed?.cycle
    ?? (item?.price?.recurring?.interval === 'year' ? 'annual' : 'monthly');
  if (!plan || (scope === 'team') !== (plan === 'team')) {
    logger.warn('TalkThru subscription has an unexpected price', { subscriptionId: subscription.id, plan, scope });
    return;
  }
  const record = {
    plan,
    billing_cycle: cycle,
    status: subscription.status,
    seats: item?.quantity ?? 1,
    stripe_customer_id: customerIdOf(subscription.customer),
    stripe_subscription_id: subscription.id,
    stripe_price_id: item?.price?.id ?? null,
    trial_end: secondsToTimestamp(subscription.trial_end),
    current_period_end: secondsToTimestamp(item?.current_period_end),
    cancel_at_period_end: subscription.cancel_at_period_end === true,
    cancel_at: secondsToTimestamp(subscription.cancel_at),
    stripe_subscription_created: subscription.created ?? 0,
    updated_at: FieldValue.serverTimestamp(),
  };
  const ref = scope === 'team' ? talkThruTeamBillingCollection.doc(ownerId) : talkThruBillingCollection.doc(ownerId);
  const outcome = await db.runTransaction(async (tx): Promise<{ applied: boolean; duplicate: string }> => {
    const current = (await tx.get(ref)).data();
    const currentSubscription = text(current?.['stripe_subscription_id']);
    const otherLive = !!currentSubscription
      && currentSubscription !== subscription.id
      && talkThruStatusGrantsAccess(current?.['status']);
    // Never let an old, ended subscription overwrite a newer live one.
    if (otherLive && !talkThruStatusGrantsAccess(subscription.status)) return { applied: false, duplicate: '' };
    if (otherLive) {
      // Two live subscriptions for one owner (two checkouts finished): keep the
      // newest and cancel the other so nobody pays twice.
      const currentCreated = Number(current?.['stripe_subscription_created']) || 0;
      if (currentCreated > (subscription.created ?? 0)) return { applied: false, duplicate: subscription.id };
      tx.set(ref, record, { merge: true });
      return { applied: true, duplicate: currentSubscription };
    }
    tx.set(ref, record, { merge: true });
    return { applied: true, duplicate: '' };
  });
  if (outcome.duplicate) {
    try {
      await getStripeClient().subscriptions.cancel(outcome.duplicate, { prorate: true });
      logger.warn('Cancelled a duplicate TalkThru subscription', { scope, ownerId, cancelled: outcome.duplicate, kept: outcome.applied ? subscription.id : 'existing' });
    } catch (error) {
      logger.error('Duplicate TalkThru subscription could not be cancelled', { scope, ownerId, subscriptionId: outcome.duplicate, error });
    }
  }
  if (!outcome.applied) return;
  if (subscription.trial_start) {
    const keys = text(metadata['trialClaimKeys'], 600).split(',').map((key) => key.trim()).filter(Boolean);
    const batch = db.batch();
    for (const key of keys) {
      batch.set(talkThruTrialClaimsCollection.doc(key), {
        scope,
        owner_id: ownerId,
        subscription_id: subscription.id,
        claimed_at: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    if (keys.length) await batch.commit();
  }
  if (scope === 'team') await reconcileTeamTalkThrus(ownerId);
  else await reconcileTalkThruListings(ownerId);
}

async function pauseTalkThru(boardId: string, uid: string, reason: string): Promise<boolean> {
  return db.runTransaction(async (tx) => {
    const ref = db.collection('boards').doc(boardId);
    const data = (await tx.get(ref)).data();
    if (!data || data['owner_user_id'] !== uid || !isActivePersonalTalkThru(data)) return false;
    tx.update(ref, { visibility: 'private', server_updated_at: FieldValue.serverTimestamp() });
    tx.set(talkThruPausedBoardsCollection.doc(boardId), {
      owner_user_id: uid,
      previous_visibility: data['visibility'],
      reason,
      paused_at: FieldValue.serverTimestamp(),
      paused_at_ms: Date.now(),
    });
    return true;
  });
}

async function restoreTalkThru(boardId: string, uid: string): Promise<boolean> {
  return db.runTransaction(async (tx) => {
    const boardRef = db.collection('boards').doc(boardId);
    const pauseRef = talkThruPausedBoardsCollection.doc(boardId);
    const [board, pause] = await tx.getAll(boardRef, pauseRef);
    const data = board.data();
    const pauseData = pause.data();
    if (!pauseData || pauseData['owner_user_id'] !== uid) return false;
    tx.delete(pauseRef);
    // Leave anything the owner changed since (deleted, edited away, or already
    // published again) exactly as it is.
    if (!data || data['owner_user_id'] !== uid || data['visibility'] !== 'private' || !isTalkThruBoardRecord(data)) {
      return false;
    }
    const previous = pauseData['previous_visibility'] === 'unlisted' ? 'unlisted' : 'public';
    tx.update(boardRef, { visibility: previous, server_updated_at: FieldValue.serverTimestamp() });
    return true;
  });
}

/** Bring live listings in line with the plan: pause extras or restore paused ones. */
export async function reconcileTalkThruListings(uid: string): Promise<{ paused: string[]; restored: string[] }> {
  const { entitlement } = await loadTalkThruEntitlement(uid);
  const listings = await listPersonalTalkThrus(uid);
  const active = listings.filter((listing) => isLinkReadableTalkThruVisibility(listing.visibility));
  const paused: string[] = [];
  const restored: string[] = [];
  const toPause = talkThruListingsToPause(active, entitlement.activeLimit);
  for (const boardId of toPause) {
    if (await pauseTalkThru(boardId, uid, 'plan_change')) paused.push(boardId);
  }
  if (!toPause.length) {
    const pausedDocs = await talkThruPausedBoardsCollection.where('owner_user_id', '==', uid).limit(100).get();
    const candidates = pausedDocs.docs.map((doc) => ({ id: doc.id, pausedAt: Number(doc.data()['paused_at_ms']) || 0 }));
    for (const boardId of talkThruListingsToRestore(candidates, active.length, entitlement.activeLimit)) {
      if (await restoreTalkThru(boardId, uid)) restored.push(boardId);
    }
  }
  if (paused.length || restored.length) logger.info('TalkThru listings reconciled', { uid, paused, restored });
  return { paused, restored };
}

async function reconcileTeamTalkThrus(teamId: string): Promise<void> {
  const record = await teamBillingRecord(teamId);
  if (!teamPlanActive(record)) {
    await unpublishTeamListingsOverFreeLimit(teamId, TALKTHRU_TEAM_FREE_PUBLISHED_LIMIT);
  }
  // A team seat also covers each agent's personal listings.
  const members = await db.collection('teams').doc(teamId).collection('members').where('status', '==', 'active').get();
  await Promise.all(members.docs.map((member) => reconcileTalkThruListings(member.id).catch((error) => {
    logger.error('TalkThru member reconcile failed', { teamId, uid: member.id, error });
  })));
}

/** Webhook entry points (registered in stripeBusinessWebhook). */
export async function handleTalkThruCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id ?? '';
  await syncTalkThruSubscriptionById(subscriptionId);
}

/** Stripe sends this three days before a free month ends. */
export async function handleTalkThruTrialWillEnd(subscription: Stripe.Subscription): Promise<void> {
  if (subscription.metadata?.['source'] !== 'talkthru') return;
  const current = await getStripeClient().subscriptions.retrieve(subscription.id);
  await sendTalkThruTrialEndingEmail(current, getStripeClient());
}

export async function handleTalkThruInvoicePaymentFailed(invoice: Stripe.Invoice, subscriptionId: string): Promise<boolean> {
  if (!subscriptionId) return false;
  const subscription = await getStripeClient().subscriptions.retrieve(subscriptionId);
  if (subscription.metadata?.['source'] !== 'talkthru') return false;
  await syncTalkThruSubscription(subscription);
  await sendTalkThruPaymentFailedEmail(subscription, invoice, getStripeClient());
  return true;
}

// ---------------------------------------------------------------- callable

export const talkThruBillingCommand = onCall(
  { region, cors: true, secrets: [stripeSecretKey], timeoutSeconds: 60 },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in to manage your TalkThru plan.');
    const data = (request.data ?? {}) as Record<string, unknown>;
    const action = text(data['action'], 40);
    const email = typeof request.auth?.token.email === 'string' ? request.auth.token.email : '';
    try {
      if (action === 'status') {
        const teamId = data['teamId'] ? checkedId(data['teamId'], 'team') : '';
        return {
          personal: await personalStatus(uid, email),
          team: teamId ? await teamStatus(teamId, uid) : null,
        };
      }
      if (action === 'checkout') {
        const plan = normalizeTalkThruPlan(data['plan']);
        if (!plan) throw new HttpsError('invalid-argument', 'Choose a TalkThru plan.');
        const cycle = normalizeTalkThruCycle(data['billingCycle']) ?? 'monthly';
        const returnPath = safeTalkThruReturnPath(data['returnPath']);
        const origin = requestOrigin(request);
        const successUrl = `${origin}${withCheckoutParams(returnPath, 'success')}`;
        const cancelUrl = `${origin}${withCheckoutParams(returnPath, 'cancelled')}`;
        if (plan === 'team') {
          return startTeamCheckout(uid, email, checkedId(data['teamId'], 'team'), data['seats'], cycle, successUrl, cancelUrl);
        }
        return startPersonalCheckout(uid, email, plan, cycle, successUrl, cancelUrl);
      }
      if (action === 'confirm') return confirmCheckout(uid, data['sessionId']);
      if (action === 'setup') {
        // Platform admins only: checks (or, with apply, creates) everything in Stripe.
        const user = await db.collection('users').doc(uid).get();
        if (user.data()?.['role'] !== 'admin') throw new HttpsError('permission-denied', 'Platform admin access is required.');
        const report = await runTalkThruStripeSetup(getStripeClient(), stripeMode(), fallbackOrigin, data['apply'] === true);
        priceCache = null;
        return report;
      }
      if (action === 'portal') return openPortal(request, uid);
      throw new HttpsError('invalid-argument', 'Unknown billing action.');
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      logger.error('TalkThru billing command failed', { action, uid, error });
      throw new HttpsError('internal', 'Billing is unavailable right now. Please try again in a moment.');
    }
  },
);

// ---------------------------------------------------------------- listing limit backstop

/**
 * The app asks for a plan before publishing over the limit; this catches every
 * other path (old tabs, direct writes, auto-detected listings). Only a write
 * that makes a TalkThru newly visible does any reads.
 */
export const enforceTalkThruListingLimit = onDocumentWritten(
  { region, document: 'boards/{boardId}' },
  async (event) => {
    const boardId = event.params.boardId;
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!after) {
      if (before && isTalkThruBoardRecord(before)) await talkThruPausedBoardsCollection.doc(boardId).delete();
      return;
    }
    if (!isActivePersonalTalkThru(after) || isActivePersonalTalkThru(before)) return;
    const uid = typeof after['owner_user_id'] === 'string' ? after['owner_user_id'] : '';
    if (!uid) return;
    const { entitlement } = await loadTalkThruEntitlement(uid);
    if (entitlement.activeLimit !== null) {
      const listings = await listPersonalTalkThrus(uid);
      if (activeTalkThruCount(listings, boardId) >= entitlement.activeLimit) {
        const paused = await pauseTalkThru(boardId, uid, 'listing_limit');
        if (paused) logger.info('TalkThru paused over plan limit', { uid, boardId, plan: entitlement.plan });
        return;
      }
    }
    // Published within the plan: it is no longer paused.
    await talkThruPausedBoardsCollection.doc(boardId).delete();
  },
);
