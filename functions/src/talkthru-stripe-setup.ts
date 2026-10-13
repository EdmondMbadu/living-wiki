import type Stripe from 'stripe';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from './firebase';
import {
  TALKTHRU_PLAN_CATALOG,
  TALKTHRU_TEAM_MAX_SELF_SERVE_SEATS,
  TALKTHRU_TEAM_MIN_SEATS,
  talkThruLookupKey,
  type TalkThruBillingCycle,
  type TalkThruPlanKey,
} from './talkthru-plans';

// Everything TalkThru needs in Stripe, created from the plan catalog so prices
// never drift from what the pricing page shows. Every step is idempotent: it
// finds what exists (by metadata or lookup key) and only creates what is missing.

export type StripeMode = 'test' | 'live';

export const TALKTHRU_STRIPE_PRODUCTS: Record<TalkThruPlanKey, { name: string; description: string }> = {
  solo: { name: 'TalkThru Solo Agent', description: 'Up to 10 live TalkThrus with your own voice narration.' },
  pro: { name: 'TalkThru Agent Pro', description: 'Unlimited TalkThrus, video export and buyer engagement insights.' },
  team: { name: 'TalkThru Agency & Team', description: 'Agent Pro for every agent, with team branding and a shared listing library.' },
};

/** Events the webhook must receive for plans to stay in sync and emails to go out. */
export const TALKTHRU_WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.trial_will_end',
  'invoice.paid',
  'invoice.payment_failed',
] as const;

export const TALKTHRU_WEBHOOK_PATH = '/stripeBusinessWebhook';

interface PriceSpec {
  plan: TalkThruPlanKey;
  cycle: TalkThruBillingCycle;
  lookupKey: string;
  unitAmount?: number;
  tiers?: Array<{ up_to: number | 'inf'; unit_amount: number }>;
}

export function talkThruPriceSpecs(): PriceSpec[] {
  const specs: PriceSpec[] = [];
  for (const cycle of ['monthly', 'annual'] as const) {
    for (const plan of ['solo', 'pro'] as const) {
      const entry = TALKTHRU_PLAN_CATALOG[plan];
      specs.push({ plan, cycle, lookupKey: talkThruLookupKey(plan, cycle), unitAmount: cycle === 'annual' ? entry.annualCents : entry.monthlyCents });
    }
    const tiers = TALKTHRU_PLAN_CATALOG.team.tiers[cycle];
    // Graduated. Checkout caps seats at the self-serve maximum, so the last tier is open-ended.
    specs.push({
      plan: 'team',
      cycle,
      lookupKey: talkThruLookupKey('team', cycle),
      tiers: tiers.map((tier, index) => ({
        up_to: index === tiers.length - 1 ? 'inf' : tier.upTo,
        unit_amount: tier.unitCents,
      })),
    });
  }
  return specs;
}

function priceMatches(price: Stripe.Price, productId: string, spec: PriceSpec): boolean {
  const interval = spec.cycle === 'annual' ? 'year' : 'month';
  const productOf = typeof price.product === 'string' ? price.product : price.product?.id;
  if (!price.active || productOf !== productId || price.currency !== 'usd' || price.recurring?.interval !== interval) return false;
  if (!spec.tiers) return price.billing_scheme === 'per_unit' && price.unit_amount === spec.unitAmount;
  if (price.billing_scheme !== 'tiered' || price.tiers_mode !== 'graduated' || price.tiers?.length !== spec.tiers.length) return false;
  return spec.tiers.every((tier, index) => {
    const actual = price.tiers![index];
    return actual.up_to === (tier.up_to === 'inf' ? null : tier.up_to) && actual.unit_amount === tier.unit_amount;
  });
}

export interface CatalogResult {
  products: Record<TalkThruPlanKey, string>;
  prices: Record<string, string>;
  created: string[];
  problems: string[];
}

export async function ensureTalkThruCatalog(stripe: Stripe, apply = true): Promise<CatalogResult> {
  const products = {} as Record<TalkThruPlanKey, string>;
  const prices: Record<string, string> = {};
  const created: string[] = [];
  const problems: string[] = [];
  // List rather than search: search is eventually consistent and could miss a
  // product created a moment ago, which would create a duplicate.
  const allProducts: Stripe.Product[] = [];
  for await (const product of stripe.products.list({ limit: 100 })) allProducts.push(product);
  for (const plan of ['solo', 'pro', 'team'] as const) {
    const found = allProducts.filter((product) => product.metadata?.['talkthru_plan'] === plan);
    const existing = found.find((product) => product.active) ?? found[0];
    if (existing) {
      if (!existing.active && apply) await stripe.products.update(existing.id, { active: true });
      products[plan] = existing.id;
    } else if (apply) {
      const product = await stripe.products.create({
        ...TALKTHRU_STRIPE_PRODUCTS[plan],
        metadata: { talkthru_plan: plan, source: 'talkthru' },
      });
      products[plan] = product.id;
      created.push(`product:${plan}`);
    } else {
      problems.push(`Product “${TALKTHRU_STRIPE_PRODUCTS[plan].name}” is missing.`);
    }
  }
  const specs = talkThruPriceSpecs();
  const listed = await stripe.prices.list({ lookup_keys: specs.map((spec) => spec.lookupKey), expand: ['data.tiers'], limit: 10 });
  for (const spec of specs) {
    const current = listed.data.find((price) => price.lookup_key === spec.lookupKey);
    const productId = products[spec.plan];
    if (current && productId && priceMatches(current, productId, spec)) {
      prices[spec.lookupKey] = current.id;
      continue;
    }
    if (!apply || !productId) {
      problems.push(current ? `Price ${spec.lookupKey} does not match the pricing page.` : `Price ${spec.lookupKey} is missing.`);
      if (current) prices[spec.lookupKey] = current.id;
      continue;
    }
    const price = await stripe.prices.create({
      product: productId,
      currency: 'usd',
      recurring: { interval: spec.cycle === 'annual' ? 'year' : 'month' },
      lookup_key: spec.lookupKey,
      // Moves the lookup key off an old price; existing subscribers keep that price.
      transfer_lookup_key: true,
      nickname: `${TALKTHRU_STRIPE_PRODUCTS[spec.plan].name} · ${spec.cycle}`,
      metadata: { source: 'talkthru', plan: spec.plan, cycle: spec.cycle },
      ...(spec.tiers
        ? { billing_scheme: 'tiered' as const, tiers_mode: 'graduated' as const, tiers: spec.tiers }
        : { unit_amount: spec.unitAmount }),
    });
    if (current && current.id !== price.id && current.active) await stripe.prices.update(current.id, { active: false });
    prices[spec.lookupKey] = price.id;
    created.push(`price:${spec.lookupKey}`);
  }
  return { products, prices, created, problems };
}

function portalParams(
  scope: 'personal' | 'team',
  catalog: CatalogResult,
  appUrl: string,
): Stripe.BillingPortal.ConfigurationCreateParams {
  const productEntries: Stripe.BillingPortal.ConfigurationCreateParams.Features.SubscriptionUpdate.Product[] = scope === 'team'
    ? [{
        product: catalog.products.team,
        prices: [catalog.prices['talkthru_team_monthly'], catalog.prices['talkthru_team_annual']],
        adjustable_quantity: { enabled: true, minimum: TALKTHRU_TEAM_MIN_SEATS, maximum: TALKTHRU_TEAM_MAX_SELF_SERVE_SEATS },
      }]
    : (['solo', 'pro'] as const).map((plan) => ({
        product: catalog.products[plan],
        prices: [catalog.prices[talkThruLookupKey(plan, 'monthly')], catalog.prices[talkThruLookupKey(plan, 'annual')]],
      }));
  return {
    business_profile: {
      headline: scope === 'team' ? 'TalkThru team plan' : 'TalkThru plans',
      privacy_policy_url: `${appUrl}/privacy`,
      terms_of_service_url: `${appUrl}/terms`,
    },
    default_return_url: `${appUrl}/talkthrus/billing`,
    features: {
      customer_update: { enabled: true, allowed_updates: ['email', 'address', 'name', 'tax_id'] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: {
        enabled: true,
        mode: 'at_period_end',
        cancellation_reason: { enabled: true, options: ['too_expensive', 'unused', 'missing_features', 'switched_service', 'other'] },
      },
      subscription_update: {
        enabled: true,
        default_allowed_updates: scope === 'team' ? ['price', 'quantity'] : ['price'],
        proration_behavior: 'create_prorations',
        products: productEntries,
      },
    },
    metadata: { source: 'talkthru', portal: scope },
  };
}

/** Separate portals so a team can never be moved onto a personal price, or the reverse. */
export async function ensureTalkThruPortals(
  stripe: Stripe,
  catalog: CatalogResult,
  appUrl: string,
  apply = true,
): Promise<{ personal: string; team: string; problems: string[] }> {
  const problems: string[] = [];
  const existing = (await stripe.billingPortal.configurations.list({ active: true, limit: 100 })).data;
  const result = { personal: '', team: '' };
  for (const scope of ['personal', 'team'] as const) {
    const found = existing.find((configuration) => configuration.metadata?.['source'] === 'talkthru' && configuration.metadata?.['portal'] === scope);
    if (!apply) {
      if (!found) problems.push(`The ${scope} billing portal is not set up.`);
      result[scope] = found?.id ?? '';
      continue;
    }
    const params = portalParams(scope, catalog, appUrl);
    result[scope] = found
      ? (await stripe.billingPortal.configurations.update(found.id, params)).id
      : (await stripe.billingPortal.configurations.create(params)).id;
  }
  return { ...result, problems };
}

export interface WebhookResult {
  status: 'ok' | 'updated' | 'missing' | 'needs_events';
  endpointId: string;
  url: string;
  missingEvents: string[];
}

/**
 * Adds any missing events to the existing webhook endpoint. A missing endpoint
 * is reported, not created: its signing secret must be stored in Firebase as
 * STRIPE_WEBHOOK_SECRET, which only a person can do.
 */
export async function ensureTalkThruWebhook(stripe: Stripe, apply = true): Promise<WebhookResult> {
  const endpoints = (await stripe.webhookEndpoints.list({ limit: 100 })).data;
  const endpoint = endpoints.find((item) => item.status === 'enabled' && item.url.includes(TALKTHRU_WEBHOOK_PATH))
    ?? endpoints.find((item) => item.url.includes(TALKTHRU_WEBHOOK_PATH));
  if (!endpoint) return { status: 'missing', endpointId: '', url: '', missingEvents: [...TALKTHRU_WEBHOOK_EVENTS] };
  const enabled = new Set(endpoint.enabled_events);
  const missingEvents = enabled.has('*') ? [] : TALKTHRU_WEBHOOK_EVENTS.filter((event) => !enabled.has(event));
  if (!missingEvents.length && endpoint.status === 'enabled') {
    return { status: 'ok', endpointId: endpoint.id, url: endpoint.url, missingEvents: [] };
  }
  if (!apply) return { status: 'needs_events', endpointId: endpoint.id, url: endpoint.url, missingEvents };
  await stripe.webhookEndpoints.update(endpoint.id, {
    disabled: false,
    enabled_events: [...new Set([...endpoint.enabled_events, ...TALKTHRU_WEBHOOK_EVENTS])] as Stripe.WebhookEndpointUpdateParams.EnabledEvent[],
  });
  return { status: 'updated', endpointId: endpoint.id, url: endpoint.url, missingEvents: [] };
}

const configCollection = db.collection('talkthru_config');

export interface TalkThruStripeConfig {
  portal_personal?: string;
  portal_team?: string;
  prices?: Record<string, string>;
  products?: Record<string, string>;
}

export async function readTalkThruStripeConfig(mode: StripeMode): Promise<TalkThruStripeConfig> {
  return ((await configCollection.doc(`stripe_${mode}`).get()).data() ?? {}) as TalkThruStripeConfig;
}

export async function saveTalkThruStripeConfig(
  mode: StripeMode,
  catalog: CatalogResult,
  portals: { personal: string; team: string },
): Promise<void> {
  await configCollection.doc(`stripe_${mode}`).set({
    portal_personal: portals.personal,
    portal_team: portals.team,
    prices: catalog.prices,
    products: catalog.products,
    checked_at: FieldValue.serverTimestamp(),
  }, { merge: true });
}

export interface TalkThruStripeSetupReport {
  mode: StripeMode;
  applied: boolean;
  ready: boolean;
  created: string[];
  problems: string[];
  portals: { personal: string; team: string };
  webhook: WebhookResult;
}

/** One pass over everything. With apply=false it only reports. */
export async function runTalkThruStripeSetup(
  stripe: Stripe,
  mode: StripeMode,
  appUrl: string,
  apply: boolean,
): Promise<TalkThruStripeSetupReport> {
  const catalog = await ensureTalkThruCatalog(stripe, apply);
  const portalsReady = (['solo', 'pro', 'team'] as const).every((plan) => catalog.products[plan])
    && talkThruPriceSpecs().every((spec) => catalog.prices[spec.lookupKey]);
  const portals = portalsReady
    ? await ensureTalkThruPortals(stripe, catalog, appUrl, apply)
    : { personal: '', team: '', problems: ['Billing portals need the products and prices first.'] };
  const webhook = await ensureTalkThruWebhook(stripe, apply);
  const problems = [...catalog.problems, ...portals.problems];
  if (webhook.status === 'missing') {
    problems.push('No Stripe webhook points at stripeBusinessWebhook. Add one in Stripe and store its signing secret as STRIPE_WEBHOOK_SECRET.');
  } else if (webhook.status === 'needs_events') {
    problems.push(`The webhook is missing events: ${webhook.missingEvents.join(', ')}.`);
  }
  if (apply && portals.personal && portals.team) await saveTalkThruStripeConfig(mode, catalog, portals);
  return {
    mode,
    applied: apply,
    ready: !problems.length,
    created: catalog.created,
    problems,
    portals: { personal: portals.personal, team: portals.team },
    webhook,
  };
}
