#!/usr/bin/env node
/*
 * Optional command-line version of the admin “Check Stripe setup” button on
 * /talkthrus/billing. Creates or verifies the TalkThru products, prices,
 * Customer Portal configurations and webhook events. Safe to re-run.
 *
 *   npm --prefix functions run build
 *   STRIPE_SECRET_KEY=sk_test_... node functions/scripts/setup-talkthru-stripe.cjs [--check]
 *
 * --check only reports. Nothing here is required: the deployed functions create
 * whatever is missing on the first checkout, and the admin button does all of it.
 */
process.env.GCLOUD_PROJECT ||= 'living-atlas-7622a';
const Stripe = require('stripe');
const { ensureTalkThruCatalog, ensureTalkThruPortals, ensureTalkThruWebhook } = require('../lib/talkthru-stripe-setup.js');

const secret = process.env.STRIPE_SECRET_KEY || '';
if (!/^(sk|rk)_(test|live)_/.test(secret)) {
  console.error('Set STRIPE_SECRET_KEY to a Stripe secret key (sk_test_... first).');
  process.exit(1);
}
const apply = !process.argv.includes('--check');
const stripe = new Stripe(secret);
const appUrl = process.env.TALKTHRU_APP_URL || 'https://livingwiki.com';

(async () => {
  console.log(`Stripe ${/_live_/.test(secret) ? 'LIVE' : 'TEST'} mode · ${apply ? 'applying' : 'checking only'}`);
  const catalog = await ensureTalkThruCatalog(stripe, apply);
  for (const [key, id] of Object.entries(catalog.prices)) console.log(`price   ${key} -> ${id}`);
  if (catalog.created.length) console.log(`created ${catalog.created.join(', ')}`);
  const portals = await ensureTalkThruPortals(stripe, catalog, appUrl, apply);
  console.log(`portal  personal -> ${portals.personal || '(missing)'}`);
  console.log(`portal  team     -> ${portals.team || '(missing)'}`);
  const webhook = await ensureTalkThruWebhook(stripe, apply);
  console.log(`webhook ${webhook.status}${webhook.url ? ` · ${webhook.url}` : ''}${webhook.missingEvents.length ? ` · missing ${webhook.missingEvents.join(', ')}` : ''}`);
  const problems = [...catalog.problems, ...portals.problems];
  if (webhook.status === 'missing') problems.push('Add a webhook endpoint for stripeBusinessWebhook and store its signing secret as STRIPE_WEBHOOK_SECRET.');
  console.log(problems.length ? `\nTo fix:\n- ${problems.join('\n- ')}` : '\nStripe is ready for TalkThru plans.');
})().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
