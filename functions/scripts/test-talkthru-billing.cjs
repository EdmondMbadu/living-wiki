const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const plans = require('../lib/talkthru-plans.js');

const listing = (extra = {}) => ({
  visibility: 'public',
  title: '12 Ocean Ave',
  cards: [{ tags: ['listing', 'real-estate', 'listing-story'] }],
  ...extra,
});

test('free accounts get one live TalkThru and no video export', () => {
  const entitlement = plans.resolveTalkThruEntitlement({ isAdmin: false, personal: null, teams: [] });
  assert.deepEqual(entitlement, { plan: 'free', source: 'free', activeLimit: 1, videoExport: false, teamId: '' });
});

test('trialing, active and past_due subscriptions keep the plan; ended ones do not', () => {
  for (const status of ['trialing', 'active', 'past_due']) {
    const entitlement = plans.resolveTalkThruEntitlement({ isAdmin: false, personal: { plan: 'solo', status }, teams: [] });
    assert.equal(entitlement.plan, 'solo', status);
    assert.equal(entitlement.activeLimit, 10);
    assert.equal(entitlement.videoExport, false);
  }
  for (const status of ['canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused', undefined]) {
    const entitlement = plans.resolveTalkThruEntitlement({ isAdmin: false, personal: { plan: 'pro', status }, teams: [] });
    assert.equal(entitlement.plan, 'free', String(status));
  }
});

test('the highest plan wins across personal, complimentary and team seats', () => {
  const entitlement = plans.resolveTalkThruEntitlement({
    isAdmin: false,
    personal: { plan: 'solo', status: 'active' },
    teams: [{ teamId: 't1', record: { plan: 'team', status: 'trialing' } }],
  });
  assert.equal(entitlement.plan, 'team');
  assert.equal(entitlement.source, 'team');
  assert.equal(entitlement.teamId, 't1');
  assert.equal(entitlement.activeLimit, null);
  assert.equal(entitlement.videoExport, true);
  const comp = plans.resolveTalkThruEntitlement({ isAdmin: false, personal: { comp_plan: 'pro' }, teams: [] });
  assert.equal(comp.source, 'comp');
  assert.equal(comp.activeLimit, null);
  const admin = plans.resolveTalkThruEntitlement({ isAdmin: true, personal: null, teams: [] });
  assert.equal(admin.source, 'admin');
  const ended = plans.resolveTalkThruEntitlement({
    isAdmin: false, personal: null, teams: [{ teamId: 't1', record: { plan: 'team', status: 'canceled' } }],
  });
  assert.equal(ended.plan, 'free');
});

test('TalkThru detection matches sale and rental listings only', () => {
  assert.equal(plans.isTalkThruBoardRecord(listing()), true);
  assert.equal(plans.isTalkThruBoardRecord({ cards: [{ tags: ['listing', 'rental', 'listing-story'] }] }), true);
  assert.equal(plans.isTalkThruBoardRecord({ cards: [{ tags: ['real-estate', 'listing'] }] }), true);
  assert.equal(plans.isTalkThruBoardRecord({ title: 'Real Estate VirtualTalkThru: Elm St', cards: [] }), true);
  assert.equal(plans.isTalkThruBoardRecord({ title: 'Paris cafés', cards: [{ tags: ['cafe'] }] }), false);
  assert.equal(plans.isTalkThruBoardRecord({ cards: [{ tags: ['real-estate'] }] }), false);
  assert.equal(plans.isTalkThruBoardRecord(null), false);
});

test('only visible personal TalkThrus count toward the limit', () => {
  assert.equal(plans.isActivePersonalTalkThru(listing()), true);
  assert.equal(plans.isActivePersonalTalkThru(listing({ visibility: 'unlisted' })), true);
  assert.equal(plans.isActivePersonalTalkThru(listing({ visibility: 'private' })), false);
  assert.equal(plans.isActivePersonalTalkThru(listing({ team_id: 'team1' })), false);
  assert.equal(plans.isActivePersonalTalkThru(listing({ parentBoardId: 'parent' })), false);
  assert.equal(plans.isActivePersonalTalkThru(undefined), false);
});

test('downgrades keep the most recently updated listings live', () => {
  const active = [
    { id: 'a', visibility: 'public', updatedAt: '2026-01-01T00:00:00Z' },
    { id: 'b', visibility: 'public', updatedAt: '2026-03-01T00:00:00Z' },
    { id: 'c', visibility: 'unlisted', updatedAt: '2026-02-01T00:00:00Z' },
  ];
  assert.deepEqual(plans.talkThruListingsToPause(active, 1), ['c', 'a']);
  assert.deepEqual(plans.talkThruListingsToPause(active, 3), []);
  assert.deepEqual(plans.talkThruListingsToPause(active, null), []);
  assert.deepEqual(plans.talkThruListingsToPause(active, 0), ['b', 'c', 'a']);
});

test('upgrades restore paused listings within the new room, newest pause first', () => {
  const paused = [{ id: 'x', pausedAt: 1 }, { id: 'y', pausedAt: 3 }, { id: 'z', pausedAt: 2 }];
  assert.deepEqual(plans.talkThruListingsToRestore(paused, 0, null), ['y', 'z', 'x']);
  assert.deepEqual(plans.talkThruListingsToRestore(paused, 8, 10), ['y', 'z']);
  assert.deepEqual(plans.talkThruListingsToRestore(paused, 1, 1), []);
  assert.deepEqual(plans.talkThruListingsToRestore(paused, 5, 1), []);
});

test('team pricing is graduated so adding an agent never lowers the bill', () => {
  assert.equal(plans.teamSeatTotalCents(3, 'monthly'), 7500);
  assert.equal(plans.teamSeatTotalCents(10, 'monthly'), 25000);
  assert.equal(plans.teamSeatTotalCents(11, 'monthly'), 26900);
  assert.equal(plans.teamSeatTotalCents(25, 'monthly'), 25000 + 15 * 1900);
  assert.equal(plans.teamSeatTotalCents(3, 'annual'), 75000);
  let previous = 0;
  for (let seats = 1; seats <= 25; seats += 1) {
    const total = plans.teamSeatTotalCents(seats, 'monthly');
    assert.ok(total > previous, `seat ${seats}`);
    previous = total;
  }
});

test('team checkout seats respect the minimum, current members and the self-serve cap', () => {
  assert.equal(plans.teamCheckoutSeats(undefined, 1), 3);
  assert.equal(plans.teamCheckoutSeats(2, 1), 3);
  assert.equal(plans.teamCheckoutSeats(5, 7), 7);
  assert.equal(plans.teamCheckoutSeats(12, 4), 12);
  assert.equal(plans.teamCheckoutSeats(40, 4), 25);
  assert.equal(plans.teamCheckoutSeats('9', 4), 4);
});

test('lookup keys round-trip and reject anything else', () => {
  assert.equal(plans.TALKTHRU_LOOKUP_KEYS.length, 6);
  for (const key of plans.TALKTHRU_LOOKUP_KEYS) assert.ok(plans.parseTalkThruLookupKey(key));
  assert.deepEqual(plans.parseTalkThruLookupKey('talkthru_pro_annual'), { plan: 'pro', cycle: 'annual' });
  assert.equal(plans.parseTalkThruLookupKey('talkthru_gold_monthly'), null);
  assert.equal(plans.parseTalkThruLookupKey(null), null);
});

test('checkout return paths stay inside the app', () => {
  assert.equal(plans.safeTalkThruReturnPath('/boards?create=real-estate'), '/boards?create=real-estate');
  assert.equal(plans.safeTalkThruReturnPath('https://evil.example'), '/talkthrus/billing');
  assert.equal(plans.safeTalkThruReturnPath('//evil.example/x'), '/talkthrus/billing');
  assert.equal(plans.safeTalkThruReturnPath('/\\evil'), '/talkthrus/billing');
  assert.equal(plans.safeTalkThruReturnPath(''), '/talkthrus/billing');
  assert.equal(
    plans.withCheckoutParams('/boards?create=real-estate', 'success'),
    '/boards?create=real-estate&talkthruCheckout=success&session_id={CHECKOUT_SESSION_ID}',
  );
  assert.equal(plans.withCheckoutParams('/talkthrus/billing', 'cancelled'), '/talkthrus/billing?talkthruCheckout=cancelled');
  assert.equal(
    plans.withCheckoutParams('/teams/abc?talkthruCheckout=cancelled&x=1#plan', 'cancelled'),
    '/teams/abc?x=1&talkthruCheckout=cancelled#plan',
  );
});

test('browser plan catalog matches the server catalog', () => {
  const file = path.join(__dirname, '../../src/app/talkthru-billing/talkthru-plans.ts');
  const source = fs.readFileSync(file, 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const browser = { exports: {} };
  new Function('module', 'exports', 'require', output)(browser, browser.exports, () => ({}));
  const client = browser.exports;
  assert.deepEqual(client.TALKTHRU_PLAN_CATALOG, plans.TALKTHRU_PLAN_CATALOG);
  for (const name of ['TALKTHRU_TRIAL_DAYS', 'TALKTHRU_FREE_ACTIVE_LIMIT', 'TALKTHRU_TEAM_FREE_PUBLISHED_LIMIT', 'TALKTHRU_TEAM_MIN_SEATS', 'TALKTHRU_TEAM_MAX_SELF_SERVE_SEATS']) {
    assert.equal(client[name], plans[name], name);
  }
  for (let seats = 1; seats <= 25; seats += 1) {
    for (const cycle of ['monthly', 'annual']) {
      assert.equal(client.teamSeatTotalCents(seats, cycle), plans.teamSeatTotalCents(seats, cycle));
    }
  }
});
