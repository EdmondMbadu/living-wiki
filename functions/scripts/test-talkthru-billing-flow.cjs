// End-to-end billing flows against an in-memory Firestore: the listing-limit
// trigger, Stripe subscription sync, downgrade/upgrade reconciliation, team
// publish and seat gates. No network, Stripe or emulator needed.
process.env.GCLOUD_PROJECT = 'demo-living-wiki';
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'demo-living-wiki', storageBucket: 'demo-living-wiki.appspot.com' });
const test = require('node:test');
const assert = require('node:assert/strict');
const { Timestamp } = require('firebase-admin/firestore');
const { FakeFirestore } = require('./fake-firestore.cjs');

const fake = new FakeFirestore();
const firebasePath = require.resolve('../lib/firebase.js');
require.cache[firebasePath] = {
  id: firebasePath,
  filename: firebasePath,
  loaded: true,
  exports: { db: fake, storage: { bucket: () => ({ deleteFiles: async () => {} }) } },
};
const billing = require('../lib/talkthru-billing.js');
const access = require('../lib/talkthru-billing-access.js');

const listingCards = [{ id: 'c1', tags: ['listing', 'real-estate', 'listing-story'] }];
function seedTalkThru(id, uid, visibility, updatedAt) {
  fake.seed(`boards/${id}`, {
    id, owner_user_id: uid, visibility, title: `Listing ${id}`, description: '', cards: listingCards, updated_at_iso: updatedAt,
  });
}
function snap(data) { return data ? { data: () => JSON.parse(JSON.stringify(data)) } : undefined; }
async function write(boardId, nextPatch) {
  const before = fake.data(`boards/${boardId}`);
  const after = nextPatch === null ? undefined : { ...before, ...nextPatch };
  if (after) fake.seed(`boards/${boardId}`, after); else fake.docs.delete(`boards/${boardId}`);
  await billing.enforceTalkThruListingLimit.run({ params: { boardId }, data: { before: snap(before), after: snap(after) } });
}
function subscription({ id = 'sub_1', status = 'trialing', lookupKey = 'talkthru_pro_monthly', quantity = 1, metadata, trial = true, cancelAtPeriodEnd = false }) {
  const now = Math.floor(Date.UTC(2026, 9, 13) / 1000);
  return {
    id,
    status,
    metadata,
    customer: 'cus_123',
    cancel_at_period_end: cancelAtPeriodEnd,
    cancel_at: null,
    trial_start: trial ? now : null,
    trial_end: trial ? now + 30 * 86400 : null,
    items: { data: [{ id: 'si_1', quantity, current_period_end: now + 30 * 86400, price: { id: `price_${lookupKey}`, lookup_key: lookupKey, recurring: { interval: lookupKey.endsWith('annual') ? 'year' : 'month' } } }] },
  };
}
const userMeta = (uid, extra = {}) => ({ source: 'talkthru', scope: 'user', userId: uid, plan: 'pro', trialClaimKeys: `user_${uid},email_abc`, ...extra });

test.beforeEach(() => fake.docs.clear());

test('a free account keeps one live TalkThru; a second one is paused, not deleted', async () => {
  seedTalkThru('a', 'u1', 'public', '2026-01-01T00:00:00Z');
  seedTalkThru('b', 'u1', 'private', '2026-02-01T00:00:00Z');
  await write('b', { visibility: 'unlisted' });
  assert.equal(fake.data('boards/b').visibility, 'private');
  const pause = fake.data('talkthru_paused_boards/b');
  assert.equal(pause.owner_user_id, 'u1');
  assert.equal(pause.previous_visibility, 'unlisted');
  assert.equal(pause.reason, 'listing_limit');
  assert.equal(fake.data('boards/a').visibility, 'public');
});

test('the first TalkThru, edits to live ones and other boards never trigger a pause', async () => {
  seedTalkThru('a', 'u1', 'private', '2026-01-01T00:00:00Z');
  await write('a', { visibility: 'public' });
  assert.equal(fake.data('boards/a').visibility, 'public');
  const writesBefore = fake.writes;
  await write('a', { title: 'New title' });
  fake.seed('boards/x', { owner_user_id: 'u1', visibility: 'public', title: 'Paris cafés', cards: [{ tags: ['cafe'] }] });
  await write('x', { title: 'Paris cafés!' });
  // Only the test's own seed writes happened: the trigger itself wrote nothing.
  assert.equal(fake.writes, writesBefore);
  assert.equal(fake.data('talkthru_paused_boards/a'), undefined);
});

test('team listing snapshots and child boards never count toward personal limits', async () => {
  seedTalkThru('a', 'u1', 'public', '2026-01-01T00:00:00Z');
  fake.seed('boards/t', { owner_user_id: 'u1', team_id: 'team1', visibility: 'public', title: 'Team', cards: listingCards });
  fake.seed('boards/child', { owner_user_id: 'u1', parentBoardId: 'a', visibility: 'private', title: 'Child', cards: listingCards });
  await write('child', { visibility: 'public' });
  assert.equal(fake.data('boards/child').visibility, 'public');
  // Only 'a' counts: one live personal TalkThru is exactly the free limit.
  await assert.rejects(
    access.assertTalkThruCreationAllowed('u1'),
    (error) => error.details.reason === 'listing_limit' && error.details.activeCount === 1,
  );
});

test('starting a trial records the plan and the trial claim, and restores paused listings', async () => {
  seedTalkThru('a', 'u1', 'public', '2026-01-01T00:00:00Z');
  seedTalkThru('b', 'u1', 'private', '2026-02-01T00:00:00Z');
  fake.seed('talkthru_paused_boards/b', { owner_user_id: 'u1', previous_visibility: 'unlisted', paused_at_ms: 5 });
  await billing.syncTalkThruSubscription(subscription({ metadata: userMeta('u1') }));
  const record = fake.data('talkthru_billing/u1');
  assert.equal(record.plan, 'pro');
  assert.equal(record.status, 'trialing');
  assert.equal(record.billing_cycle, 'monthly');
  assert.equal(record.stripe_customer_id, 'cus_123');
  assert.ok(record.trial_end instanceof Timestamp);
  assert.equal(fake.data('talkthru_trial_claims/user_u1').owner_id, 'u1');
  assert.ok(fake.data('talkthru_trial_claims/email_abc'));
  assert.equal(fake.data('boards/b').visibility, 'unlisted');
  assert.equal(fake.data('talkthru_paused_boards/b'), undefined);
  await assert.doesNotReject(access.assertTalkThruCreationAllowed('u1'));
  const { entitlement } = await access.loadTalkThruEntitlement('u1');
  assert.equal(entitlement.videoExport, true);
});

test('when a plan ends, the most recently updated listing stays live and the rest pause', async () => {
  seedTalkThru('old', 'u1', 'public', '2026-01-01T00:00:00Z');
  seedTalkThru('new', 'u1', 'public', '2026-03-01T00:00:00Z');
  seedTalkThru('mid', 'u1', 'unlisted', '2026-02-01T00:00:00Z');
  await billing.syncTalkThruSubscription(subscription({ status: 'canceled', metadata: userMeta('u1') }));
  assert.equal(fake.data('boards/new').visibility, 'public');
  assert.equal(fake.data('boards/old').visibility, 'private');
  assert.equal(fake.data('boards/mid').visibility, 'private');
  assert.equal(fake.data('talkthru_paused_boards/mid').previous_visibility, 'unlisted');
  assert.equal(fake.data('talkthru_paused_boards/old').reason, 'plan_change');
  // Resubscribing brings both back.
  await billing.syncTalkThruSubscription(subscription({ id: 'sub_2', status: 'active', trial: false, metadata: userMeta('u1') }));
  assert.equal(fake.data('boards/old').visibility, 'public');
  assert.equal(fake.data('boards/mid').visibility, 'unlisted');
});

test('Solo keeps ten live listings and pauses the eleventh', async () => {
  for (let index = 0; index < 11; index += 1) {
    seedTalkThru(`l${index}`, 'u1', 'public', `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00Z`);
  }
  await billing.syncTalkThruSubscription(subscription({ lookupKey: 'talkthru_solo_annual', status: 'active', metadata: userMeta('u1', { plan: 'solo' }) }));
  assert.equal(fake.data('talkthru_billing/u1').billing_cycle, 'annual');
  assert.equal(fake.data('boards/l0').visibility, 'private');
  assert.equal(fake.data('boards/l10').visibility, 'public');
  await assert.rejects(access.assertTalkThruCreationAllowed('u1'), (error) => error.details.reason === 'listing_limit' && error.details.activeLimit === 10);
});

test('an old cancelled subscription never overwrites a newer live one', async () => {
  fake.seed('talkthru_billing/u1', { plan: 'pro', status: 'trialing', stripe_subscription_id: 'sub_new' });
  await billing.syncTalkThruSubscription(subscription({ id: 'sub_old', status: 'canceled', metadata: userMeta('u1') }));
  assert.equal(fake.data('talkthru_billing/u1').stripe_subscription_id, 'sub_new');
  assert.equal(fake.data('talkthru_billing/u1').status, 'trialing');
});

test('subscriptions from other products and mismatched prices are ignored', async () => {
  await billing.syncTalkThruSubscription(subscription({ metadata: { source: 'user_pricing', userId: 'u1' } }));
  await billing.syncTalkThruSubscription(subscription({ lookupKey: 'talkthru_team_monthly', metadata: userMeta('u1') }));
  assert.equal(fake.data('talkthru_billing/u1'), undefined);
});

function seedTeam({ planStatus } = {}) {
  fake.seed('teams/t1', { name: 'Shore Realty', status: 'active', owner_id: 'u1' });
  fake.seed('teams/t1/members/u1', { status: 'active', role: 'admin', email: 'a@x.com' });
  fake.seed('teams/t1/members/u2', { status: 'active', role: 'member', email: 'b@x.com' });
  fake.seed('users/u1/team_memberships/t1', { teamId: 't1' });
  fake.seed('users/u2/team_memberships/t1', { teamId: 't1' });
  for (const [id, status, updatedAt] of [['L1', 'published', '2026-01-01T00:00:00Z'], ['L2', 'published', '2026-02-01T00:00:00Z'], ['L3', 'draft', '2026-03-01T00:00:00Z']]) {
    const board = { id, team_id: 't1', title: id, cards: listingCards, team_status: status, team_revision: 3, published_revision: 3, representative_id: 'u2', created_by: 'u2', updated_at_iso: updatedAt, created_at_iso: updatedAt };
    fake.seed(`team_boards/${id}`, board);
    fake.seed(`teams/t1/listings/${id}`, { id, status, updatedAt });
    if (status === 'published') fake.seed(`boards/${id}`, { ...board, owner_user_id: 'team:t1', visibility: 'public' });
  }
  if (planStatus) fake.seed('talkthru_team_billing/t1', { plan: 'team', status: planStatus, seats: 3, stripe_subscription_id: 'sub_team' });
}

test('a team seat gives every member Agent Pro for personal listings', async () => {
  seedTeam({ planStatus: 'trialing' });
  const { entitlement } = await access.loadTalkThruEntitlement('u2');
  assert.equal(entitlement.source, 'team');
  assert.equal(entitlement.activeLimit, null);
  fake.seed('teams/t1/members/u2', { status: 'removed', role: 'member' });
  assert.equal((await access.loadTalkThruEntitlement('u2')).entitlement.plan, 'free');
});

test('free teams publish one listing; re-publishing it is always allowed', async () => {
  seedTeam();
  fake.docs.delete('teams/t1/listings/L1');
  fake.seed('teams/t1/listings/L1', { id: 'L1', status: 'draft' });
  await assert.doesNotReject(access.assertTeamCanPublishListing('t1', 'L2', 'u2'));
  await assert.rejects(access.assertTeamCanPublishListing('t1', 'L3', 'u2'), (error) => error.details.reason === 'team_listing_limit' && error.details.teamId === 't1');
  fake.seed('talkthru_team_billing/t1', { plan: 'team', status: 'active', seats: 3 });
  await assert.doesNotReject(access.assertTeamCanPublishListing('t1', 'L3', 'u2'));
});

test('when a team plan ends, extra published listings are unpublished like a manual Unpublish', async () => {
  seedTeam({ planStatus: 'active' });
  await billing.syncTalkThruSubscription(subscription({ id: 'sub_team', status: 'canceled', lookupKey: 'talkthru_team_monthly', quantity: 3, metadata: { source: 'talkthru', scope: 'team', teamId: 't1', userId: 'u1', plan: 'team', trialClaimKeys: 'team_t1' } }));
  assert.equal(fake.data('talkthru_team_billing/t1').status, 'canceled');
  assert.equal(fake.data('team_boards/L1').team_status, 'unpublished');
  assert.equal(fake.data('team_boards/L1').team_revision, 4);
  assert.ok(fake.data('team_boards/L1/revisions/4'));
  assert.equal(fake.data('teams/t1/listings/L1').status, 'unpublished');
  assert.equal(fake.data('boards/L1').visibility, 'private');
  assert.deepEqual(fake.data('boards/L1').cards, []);
  assert.equal(fake.data('team_boards/L2').team_status, 'published');
  assert.equal(fake.data('boards/L2').visibility, 'public');
  const notes = [...fake.docs.keys()].filter((path) => path.startsWith('users/u1/team_notifications/'));
  assert.equal(notes.length, 1);
  assert.match(fake.data(notes[0]).message, /1 listing was unpublished/);
});

test('paid teams invite within their seats; re-sending a pending invitation is free', async () => {
  seedTeam({ planStatus: 'active' });
  fake.seed('team_invitations/i1', { team_id: 't1', status: 'pending', email: 'c@x.com', expires_at_ms: Date.now() + 86400000 });
  fake.seed('team_invitations/old', { team_id: 't1', status: 'pending', email: 'old@x.com', expires_at_ms: Date.now() - 1000 });
  await assert.rejects(
    fake.runTransaction((tx) => access.assertTeamSeatsAvailable(tx, 't1', 2, ['d@x.com'])),
    (error) => error.details.reason === 'team_seats' && error.details.seats === 3 && error.details.needed === 4,
  );
  await assert.doesNotReject(fake.runTransaction((tx) => access.assertTeamSeatsAvailable(tx, 't1', 2, ['c@x.com'])));
  fake.seed('talkthru_team_billing/t1', { plan: 'team', status: 'canceled', seats: 3 });
  await assert.doesNotReject(fake.runTransaction((tx) => access.assertTeamSeatsAvailable(tx, 't1', 2, ['d@x.com', 'e@x.com'])));
});

test('a deleted TalkThru clears its pause record', async () => {
  seedTalkThru('b', 'u1', 'private', '2026-02-01T00:00:00Z');
  fake.seed('talkthru_paused_boards/b', { owner_user_id: 'u1', previous_visibility: 'public', paused_at_ms: 1 });
  await write('b', null);
  assert.equal(fake.data('talkthru_paused_boards/b'), undefined);
});
