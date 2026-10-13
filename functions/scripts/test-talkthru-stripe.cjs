// Stripe wiring: catalog/portal/webhook setup, checkout (including self-setup
// on a fresh account and plan switches), duplicate protection and billing emails.
process.env.GCLOUD_PROJECT = 'demo-living-wiki';
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'demo-living-wiki', storageBucket: 'demo-living-wiki.appspot.com' });
process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.SENDGRID_API_KEY = 'SG.fake';
const test = require('node:test');
const assert = require('node:assert/strict');
const { FakeFirestore } = require('./fake-firestore.cjs');
const { createFakeStripe } = require('./fake-stripe.cjs');

const fake = new FakeFirestore();
const firebasePath = require.resolve('../lib/firebase.js');
require.cache[firebasePath] = { id: firebasePath, filename: firebasePath, loaded: true, exports: { db: fake, storage: {} } };
const sent = [];
const sgMail = require('@sendgrid/mail');
const mail = sgMail.default ?? sgMail;
mail.setApiKey = () => {};
mail.send = async (message) => { sent.push(message); return [{ statusCode: 202 }]; };
const billing = require('../lib/talkthru-billing.js');
const setup = require('../lib/talkthru-stripe-setup.js');
const email = require('../lib/talkthru-billing-email.js');

let stripe;
test.beforeEach(() => {
  fake.docs.clear();
  sent.length = 0;
  stripe = createFakeStripe();
  billing.setTalkThruStripeClientForTests(() => stripe);
});

const callAs = (uid, data, emailAddress = `${uid}@agency.com`) => billing.talkThruBillingCommand.run({
  auth: { uid, token: { email: emailAddress } },
  data,
  rawRequest: { headers: { origin: 'https://livingwiki.com' } },
});

test('setup creates products, prices and portals once, then finds them', async () => {
  const first = await setup.ensureTalkThruCatalog(stripe, true);
  assert.equal(stripe.state.products.length, 3);
  assert.equal(stripe.state.prices.length, 6);
  assert.equal(first.created.length, 9);
  const team = stripe.state.prices.find((price) => price.lookup_key === 'talkthru_team_monthly');
  assert.equal(team.billing_scheme, 'tiered');
  assert.equal(team.tiers_mode, 'graduated');
  assert.deepEqual(team.tiers, [{ up_to: 10, unit_amount: 2500 }, { up_to: null, unit_amount: 1900 }]);
  assert.equal(stripe.state.prices.find((price) => price.lookup_key === 'talkthru_pro_annual').unit_amount, 39000);
  const second = await setup.ensureTalkThruCatalog(stripe, true);
  assert.deepEqual(second.created, []);
  assert.deepEqual(second.prices, first.prices);
  const portals = await setup.ensureTalkThruPortals(stripe, second, 'https://livingwiki.com', true);
  const again = await setup.ensureTalkThruPortals(stripe, second, 'https://livingwiki.com', true);
  assert.equal(stripe.state.portals.length, 2);
  assert.deepEqual([again.personal, again.team], [portals.personal, portals.team]);
  const teamPortal = stripe.state.portals.find((portal) => portal.id === portals.team);
  assert.deepEqual(teamPortal.features.subscription_update.default_allowed_updates, ['price', 'quantity']);
  assert.equal(teamPortal.features.subscription_update.products[0].product, second.products.team);
  const personalPortal = stripe.state.portals.find((portal) => portal.id === portals.personal);
  assert.ok(personalPortal.features.subscription_update.products.every((entry) => entry.product !== second.products.team));
});

test('a changed price gets a new Stripe price; the old one is retired, not deleted', async () => {
  await setup.ensureTalkThruCatalog(stripe, true);
  const old = stripe.state.prices.find((price) => price.lookup_key === 'talkthru_solo_monthly');
  old.unit_amount = 1500;
  const result = await setup.ensureTalkThruCatalog(stripe, true);
  assert.deepEqual(result.created, ['price:talkthru_solo_monthly']);
  assert.equal(old.active, false);
  assert.equal(old.lookup_key, null);
  assert.equal(stripe.state.prices.find((price) => price.lookup_key === 'talkthru_solo_monthly').unit_amount, 1900);
});

test('check-only setup reports problems without changing Stripe', async () => {
  stripe.state.webhooks.push({ id: 'we_1', url: 'https://us-central1-x.cloudfunctions.net/stripeBusinessWebhook', status: 'enabled', enabled_events: ['checkout.session.completed'] });
  const report = await setup.runTalkThruStripeSetup(stripe, 'test', 'https://livingwiki.com', false);
  assert.equal(report.ready, false);
  assert.equal(stripe.state.products.length, 0);
  assert.equal(report.webhook.status, 'needs_events');
  assert.ok(report.webhook.missingEvents.includes('customer.subscription.trial_will_end'));
  assert.ok(report.problems.some((problem) => /Price talkthru_pro_monthly is missing/.test(problem)));
});

test('applied setup adds missing webhook events and saves portal IDs', async () => {
  stripe.state.webhooks.push({ id: 'we_1', url: 'https://us-central1-x.cloudfunctions.net/stripeBusinessWebhook', status: 'enabled', enabled_events: ['checkout.session.completed', 'account.updated'] });
  const report = await setup.runTalkThruStripeSetup(stripe, 'test', 'https://livingwiki.com', true);
  assert.equal(report.ready, true, report.problems.join('; '));
  assert.equal(report.webhook.status, 'updated');
  const events = stripe.state.webhooks[0].enabled_events;
  for (const event of setup.TALKTHRU_WEBHOOK_EVENTS) assert.ok(events.includes(event), event);
  assert.ok(events.includes('account.updated'), 'keeps events other features rely on');
  const saved = fake.data('talkthru_config/stripe_test');
  assert.equal(saved.portal_personal, report.portals.personal);
  assert.equal(saved.portal_team, report.portals.team);
  const missing = createFakeStripe();
  const none = await setup.runTalkThruStripeSetup(missing, 'test', 'https://livingwiki.com', true);
  assert.equal(none.webhook.status, 'missing');
  assert.equal(none.ready, false);
});

test('only platform admins can run Stripe setup from the app', async () => {
  fake.seed('users/u1', { role: 'member' });
  await assert.rejects(callAs('u1', { action: 'setup', apply: true }), /Platform admin/);
  fake.seed('users/admin', { role: 'admin' });
  stripe.state.webhooks.push({ id: 'we_1', url: 'https://x/stripeBusinessWebhook', status: 'enabled', enabled_events: ['*'] });
  const report = await callAs('admin', { action: 'setup', apply: true });
  assert.equal(report.ready, true);
});

test('the first checkout on a fresh Stripe account creates the catalog, then opens Checkout with a free month', async () => {
  const result = await callAs('u1', { action: 'checkout', plan: 'pro', billingCycle: 'annual', returnPath: '/boards?create=real-estate' });
  assert.equal(result.outcome, 'checkout');
  assert.equal(stripe.state.prices.length, 6);
  const session = stripe.state.sessions[0];
  assert.equal(session.mode, 'subscription');
  assert.equal(session.line_items[0].price, stripe.state.prices.find((price) => price.lookup_key === 'talkthru_pro_annual').id);
  assert.equal(session.subscription_data.trial_period_days, 30);
  assert.equal(session.payment_method_collection, 'always');
  assert.equal(session.customer_email, 'u1@agency.com');
  assert.equal(session.subscription_data.metadata.source, 'talkthru');
  assert.equal(session.subscription_data.metadata.userId, 'u1');
  assert.equal(session.success_url, 'https://livingwiki.com/boards?create=real-estate&talkthruCheckout=success&session_id={CHECKOUT_SESSION_ID}');
  assert.equal(session.cancel_url, 'https://livingwiki.com/boards?create=real-estate&talkthruCheckout=cancelled');
});

test('a second checkout expires the first open one and skips the trial once it was used', async () => {
  await callAs('u1', { action: 'checkout', plan: 'solo', returnPath: '/talkthrus/billing' });
  fake.seed('talkthru_trial_claims/user_u1', { scope: 'user' });
  await callAs('u1', { action: 'checkout', plan: 'pro', returnPath: '/talkthrus/billing' });
  assert.deepEqual(stripe.state.expired, [stripe.state.sessions[0].id]);
  assert.equal(stripe.state.sessions[1].subscription_data.trial_period_days, undefined);
  // The same email on another account cannot start a second free month either.
  fake.seed('talkthru_trial_claims/email_' + require('node:crypto').createHash('sha256').update('shared@agency.com').digest('hex'), { scope: 'user' });
  await callAs('u2', { action: 'checkout', plan: 'pro' }, 'Shared@Agency.com');
  assert.equal(stripe.state.sessions[2].subscription_data.trial_period_days, undefined);
});

function liveSubscription(overrides = {}) {
  const price = stripe.state.prices.find((p) => p.lookup_key === (overrides.lookupKey ?? 'talkthru_solo_monthly'));
  const subscription = {
    id: overrides.id ?? 'sub_1', status: overrides.status ?? 'trialing', created: overrides.created ?? 100,
    customer: 'cus_1', cancel_at_period_end: false, cancel_at: null, trial_start: 1, trial_end: 1_800_000_000,
    metadata: { source: 'talkthru', scope: 'user', userId: 'u1', plan: 'solo', trialClaimKeys: 'user_u1' },
    items: { data: [{ id: 'si_1', quantity: 1, current_period_end: 1_800_000_000, price }] },
  };
  stripe.state.subscriptions.push(subscription);
  return subscription;
}

test('people who already pay switch plans in place, prorated, with no new checkout', async () => {
  await setup.ensureTalkThruCatalog(stripe, true);
  const subscription = liveSubscription();
  await billing.syncTalkThruSubscription(subscription);
  const result = await callAs('u1', { action: 'checkout', plan: 'pro', billingCycle: 'monthly' });
  assert.equal(result.outcome, 'changed');
  assert.equal(stripe.state.sessions.length, 0);
  const [, , params] = stripe.state.calls.find(([name]) => name === 'subscriptions.update');
  assert.equal(params.proration_behavior, 'create_prorations');
  assert.equal(params.cancel_at_period_end, false);
  assert.equal(fake.data('talkthru_billing/u1').plan, 'pro');
});

test('if two checkouts both finish, the newer subscription is kept and the older cancelled', async () => {
  await setup.ensureTalkThruCatalog(stripe, true);
  await billing.syncTalkThruSubscription(liveSubscription({ id: 'sub_old', created: 100 }));
  await billing.syncTalkThruSubscription(liveSubscription({ id: 'sub_new', created: 200 }));
  assert.equal(fake.data('talkthru_billing/u1').stripe_subscription_id, 'sub_new');
  assert.deepEqual(stripe.state.cancelled.map(([id]) => id), ['sub_old']);
  // A late event for the older one never takes over again.
  await billing.syncTalkThruSubscription(liveSubscription({ id: 'sub_older', created: 50 }));
  assert.equal(fake.data('talkthru_billing/u1').stripe_subscription_id, 'sub_new');
  assert.deepEqual(stripe.state.cancelled.map(([id]) => id), ['sub_old', 'sub_older']);
});

test('the billing portal uses the TalkThru configuration and creates it if needed', async () => {
  fake.seed('talkthru_billing/u1', { stripe_customer_id: 'cus_1' });
  const result = await callAs('u1', { action: 'portal', returnPath: '/talkthrus/billing' });
  assert.equal(result.url, 'https://billing.stripe.test/session');
  const params = stripe.state.portalSessions[0];
  assert.equal(params.customer, 'cus_1');
  assert.equal(params.return_url, 'https://livingwiki.com/talkthrus/billing');
  const saved = fake.data('talkthru_config/stripe_test');
  assert.equal(params.configuration, saved.portal_personal);
  await callAs('u1', { action: 'portal', returnPath: '/talkthrus/billing' });
  assert.equal(stripe.state.portals.length, 2, 'portals are created once and reused');
});

test('trial-ending reminder: sent once, with the real price, and not after cancelling', async () => {
  await setup.ensureTalkThruCatalog(stripe, true);
  stripe.state.customers.push({ id: 'cus_1', email: 'agent@agency.com' });
  const subscription = liveSubscription({ lookupKey: 'talkthru_pro_annual' });
  subscription.metadata.userId = 'no-such-user';
  await billing.handleTalkThruTrialWillEnd(subscription);
  await billing.handleTalkThruTrialWillEnd(subscription);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'agent@agency.com');
  assert.match(sent[0].subject, /Agent Pro ends/);
  assert.match(sent[0].text, /\$390\/year/);
  assert.match(sent[0].text, /https:\/\/livingwiki.com\/talkthrus\/billing/);
  sent.length = 0;
  fake.docs.clear();
  subscription.cancel_at_period_end = true;
  await billing.handleTalkThruTrialWillEnd(subscription);
  assert.equal(sent.length, 0);
});

test('failed payment: plan refreshed and one email per invoice, other products untouched', async () => {
  await setup.ensureTalkThruCatalog(stripe, true);
  stripe.state.customers.push({ id: 'cus_1', email: 'agent@agency.com' });
  const subscription = liveSubscription({ status: 'past_due' });
  subscription.metadata.userId = 'no-such-user';
  const invoice = { id: 'in_1', amount_due: 1900, hosted_invoice_url: 'https://invoice.stripe.test/in_1' };
  assert.equal(await billing.handleTalkThruInvoicePaymentFailed(invoice, 'sub_1'), true);
  assert.equal(await billing.handleTalkThruInvoicePaymentFailed(invoice, 'sub_1'), true);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /\$19 for Solo Agent/);
  assert.match(sent[0].html, /invoice\.stripe\.test/);
  assert.equal(fake.data('talkthru_billing/no-such-user').status, 'past_due');
  stripe.state.subscriptions.push({ id: 'sub_other', metadata: { source: 'user_pricing' }, items: { data: [] } });
  assert.equal(await billing.handleTalkThruInvoicePaymentFailed({ id: 'in_2' }, 'sub_other'), false);
});

test('email copy and price labels', () => {
  assert.equal(email.talkThruPriceLabel('team', 'monthly', 12), '$288/month for 12 agents');
  assert.equal(email.talkThruPriceLabel('solo', 'annual'), '$190/year');
  const content = email.buildTrialEndingEmail({ planName: 'Agent Pro', priceLabel: '$39/month', endDate: 'November 12, 2026', manageUrl: 'https://livingwiki.com/talkthrus/billing' });
  assert.match(content.subject, /November 12, 2026/);
  assert.doesNotMatch(content.html, /<script/i);
  const escaped = email.buildPaymentFailedEmail({ planName: '<b>x</b>', amountLabel: '$1', manageUrl: 'https://a', invoiceUrl: '' });
  assert.match(escaped.html, /&lt;b&gt;x&lt;\/b&gt;/);
});
