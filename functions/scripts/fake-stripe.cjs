// In-memory stand-in for the parts of the Stripe SDK the TalkThru billing code uses.
function createFakeStripe() {
  let counter = 0;
  const id = (prefix) => `${prefix}_${++counter}`;
  const state = {
    products: [], prices: [], sessions: [], portals: [], portalSessions: [], subscriptions: [], customers: [],
    webhooks: [], cancelled: [], expired: [], calls: [],
  };
  const list = (items) => {
    const result = { data: items, has_more: false };
    result[Symbol.asyncIterator] = async function* iterate() { for (const item of items) yield item; };
    return result;
  };
  const stripe = {
    state,
    products: {
      list: () => list(state.products),
      create: async (params) => { const product = { id: id('prod'), active: true, ...params }; state.products.push(product); return product; },
      update: async (productId, params) => Object.assign(state.products.find((p) => p.id === productId), params),
    },
    prices: {
      list: async (params) => list(state.prices.filter((price) =>
        (!params.lookup_keys || params.lookup_keys.includes(price.lookup_key)) && (params.active === undefined || price.active === params.active))),
      create: async (params) => {
        if (params.transfer_lookup_key) for (const price of state.prices) if (price.lookup_key === params.lookup_key) price.lookup_key = null;
        const price = {
          id: id('price'), active: true, currency: params.currency, product: params.product, lookup_key: params.lookup_key,
          recurring: { interval: params.recurring.interval }, billing_scheme: params.billing_scheme ?? 'per_unit',
          tiers_mode: params.tiers_mode ?? null, unit_amount: params.unit_amount ?? null,
          tiers: params.tiers ? params.tiers.map((tier) => ({ up_to: tier.up_to === 'inf' ? null : tier.up_to, unit_amount: tier.unit_amount })) : undefined,
        };
        state.prices.push(price);
        return price;
      },
      update: async (priceId, params) => Object.assign(state.prices.find((p) => p.id === priceId), params),
    },
    checkout: {
      sessions: {
        create: async (params) => { const session = { id: id('cs_test'), status: 'open', url: `https://checkout.stripe.test/${counter}`, ...params }; state.sessions.push(session); return session; },
        retrieve: async (sessionId) => state.sessions.find((s) => s.id === sessionId),
        expire: async (sessionId) => { const session = state.sessions.find((s) => s.id === sessionId); session.status = 'expired'; state.expired.push(sessionId); return session; },
      },
    },
    billingPortal: {
      configurations: {
        list: async () => list(state.portals.filter((p) => p.active !== false)),
        create: async (params) => { const portal = { id: id('bpc'), active: true, ...params }; state.portals.push(portal); return portal; },
        update: async (portalId, params) => Object.assign(state.portals.find((p) => p.id === portalId), params),
      },
      sessions: {
        create: async (params) => { state.portalSessions.push(params); return { url: 'https://billing.stripe.test/session' }; },
      },
    },
    webhookEndpoints: {
      list: async () => list(state.webhooks),
      update: async (endpointId, params) => Object.assign(state.webhooks.find((w) => w.id === endpointId), params, { status: params.disabled === false ? 'enabled' : undefined }),
    },
    subscriptions: {
      retrieve: async (subscriptionId) => state.subscriptions.find((s) => s.id === subscriptionId),
      update: async (subscriptionId, params) => {
        const subscription = state.subscriptions.find((s) => s.id === subscriptionId);
        const price = state.prices.find((p) => p.id === params.items[0].price);
        subscription.items.data[0].price = price;
        subscription.metadata = params.metadata;
        subscription.cancel_at_period_end = params.cancel_at_period_end;
        state.calls.push(['subscriptions.update', subscriptionId, params]);
        return subscription;
      },
      cancel: async (subscriptionId, params) => { state.cancelled.push([subscriptionId, params]); const s = state.subscriptions.find((x) => x.id === subscriptionId); if (s) s.status = 'canceled'; return s; },
    },
    customers: {
      retrieve: async (customerId) => state.customers.find((c) => c.id === customerId) ?? { id: customerId, deleted: true },
    },
  };
  return stripe;
}
module.exports = { createFakeStripe };
