import assert from 'node:assert/strict';
import { before, beforeEach, after, test } from 'node:test';
import { createRequire } from 'node:module';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
const require = createRequire(new URL('../../functions/package.json', import.meta.url));
process.env.GCLOUD_PROJECT = 'demo-living-wiki';
const { db } = require('./lib/firebase');
const { CityWeeklyUpdates, cityUpdateWeek, cityUpdatePages, savedCity, publicCity } = require('./lib/city-weekly-updates');
const { getAuth } = require('firebase-admin/auth');
const users = new Map();
const notFound = () => Object.assign(new Error('Missing user'), { code: 'auth/user-not-found' });
const directory = {
  getUser: async uid => { if (!users.has(uid)) throw notFound(); return users.get(uid); },
  getUserByEmail: async email => { const user = [...users.values()].find(user => user.email.toLowerCase() === email); if (!user) throw notFound(); return user; },
};
const updates = new CityWeeklyUpdates(db, directory, 'https://example.com/functions');
const week = '2026-11-02';
let sent;
async function account(uid = 'account', city = 'philly', extra = {}) {
  users.set(uid, { uid, email: `${uid}@example.com`, emailVerified: true, disabled: false, ...extra });
  await db.doc(`users/${uid}`).set(city ? { preferredCitySlug: city } : {});
}
async function subscription(id = 'visitor', email = 'account@example.com', extra = {}) {
  const ref = db.doc(`atlas_subscriptions/${id}`);
  const data = { email, atlas_id: 'city-1', status: 'active', unsubscribe_token: 'visitor-token', ...extra };
  await ref.set(data);
  return { id, ref, data };
}
async function deliver(extra = {}) {
  return updates.deliver({
    atlasId: 'city-1', slug: 'philly', includeAccounts: true, week, subscriptions: [],
    send: async (email, url) => { sent.push({ email, url }); return 'message-id'; },
    manualUnsubscribeUrl: async subscription => `https://example.com/unsubscribe/${subscription.id}`,
    ...extra,
  });
}
before(() => assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'Emulator required; never production'));
beforeEach(async () => {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-living-wiki/databases/(default)/documents`, { method: 'DELETE' });
  users.clear(); sent = [];
});
after(async () => { await db.terminate(); });

test('existing accounts receive one update without a visit or migration, overlapping visitor mail is deduplicated', async () => {
  await account();
  const visitor = await subscription();
  assert.equal((await deliver({ subscriptions: [visitor] })).sentCount, 1);
  assert.equal(sent.length, 1);
  assert.match(sent[0].url, /unsubscribeCityWeeklyUpdates/);
  assert.equal((await deliver({ subscriptions: [visitor] })).sentCount, 0);
});

test('switching saved cities changes the next update, and does not create another delivery in the current week', async () => {
  await account();
  await deliver();
  await db.doc('users/account').update({ preferredCitySlug: 'boston' });
  await deliver({ atlasId: 'city-2', slug: 'boston' });
  assert.equal(sent.length, 1);
  await deliver({ week: '2026-11-09' });
  assert.equal(sent.length, 1);
  await deliver({ atlasId: 'city-2', slug: 'boston', week: '2026-11-09' });
  assert.equal(sent.length, 2);
  assert.equal((await db.collection('atlas_subscriptions').get()).size, 0);
});

test('opt-out stays off after a city change and matching visitor subscriptions are stopped', async () => {
  await account();
  const visitor = await subscription();
  await updates.setEnabled('account', false);
  assert.equal((await visitor.ref.get()).data().status, 'unsubscribed');
  await deliver({ subscriptions: [visitor] });
  await db.doc('users/account').update({ preferredCitySlug: 'boston' });
  await deliver({ atlasId: 'city-2', slug: 'boston', week: '2026-11-09' });
  assert.equal(sent.length, 0);
  await updates.setEnabled('account', true);
  await deliver({ atlasId: 'city-2', slug: 'boston', week: '2026-11-09' });
  assert.equal(sent.length, 1);
});

test('pre-existing unsubscribes, including subscriptions linked to an old account email, are respected', async () => {
  await account();
  await subscription('old', 'old@example.com', { status: 'unsubscribed', subscriber_user_id: 'account' });
  assert.equal((await updates.settings('account')).enabled, false);
  await deliver();
  assert.equal(sent.length, 0);
  await updates.setEnabled('account', true);
  await deliver();
  assert.equal(sent.length, 1);
});

test('email unsubscribe is token protected, idempotent and account-wide; old visitor links also opt accounts out', async () => {
  await account();
  const pref = await updates.preference('account', 'account@example.com');
  assert.equal(await updates.unsubscribe('account', 'wrong'), false);
  assert.equal(await updates.unsubscribe('bad/path', pref.unsubscribe_token), false);
  assert.equal(await updates.unsubscribe('account', pref.unsubscribe_token), true);
  assert.equal(await updates.unsubscribe('account', pref.unsubscribe_token), true);
  await updates.setEnabled('account', true);
  await updates.optOutEmail('account@example.com');
  await deliver();
  assert.equal(sent.length, 0);
});

test('missing city, unverified, disabled and deleted accounts are skipped; Auth email overrides stale profile email', async () => {
  await account('missing', null);
  await account('unverified', 'philly', { emailVerified: false });
  await account('disabled', 'philly', { disabled: true });
  await db.doc('users/deleted').set({ preferredCitySlug: 'philly' });
  await account('valid', 'philly', { email: 'new@example.com' });
  await db.doc('users/valid').update({ email: 'old@example.com', emailVerified: false });
  await deliver();
  assert.deepEqual(sent.map(item => item.email), ['new@example.com']);
});

test('queued recipients recheck city and opt-out immediately before delivery', async () => {
  await account('a'); await account('b'); await account('c');
  await deliver({ send: async (email, url) => {
    sent.push({ email, url });
    await db.doc('users/b').update({ preferredCitySlug: 'boston' });
    await updates.setEnabled('c', false);
    return null;
  } });
  assert.deepEqual(sent.map(item => item.email), ['a@example.com']);
});

test('concurrent scheduler invocations claim a single account/email delivery transactionally', async () => {
  await account();
  await Promise.all([deliver(), deliver(), deliver()]);
  assert.equal(sent.length, 1);
});

test('uncertain provider failures are retained for review and never automatically resent', async () => {
  await account();
  const result = await deliver({ send: async () => { sent.push('attempt'); throw new Error('Connection lost after request'); } });
  assert.equal(result.failedCount, 1);
  await deliver();
  assert.equal(sent.length, 1);
  const receipts = await db.collection('city_weekly_deliveries').get();
  assert.ok(receipts.docs.every(doc => doc.data().status === 'uncertain'));
});

test('explicit provider rejection retries only the rejected recipient, while others continue', async () => {
  await account('a'); await account('b');
  const first = await deliver({ send: async email => {
    if (email.startsWith('a@')) throw Object.assign(new Error('Rate limited'), { code: 429 });
    sent.push(email); return null;
  } });
  assert.equal(first.failedCount, 1);
  await deliver({ send: async email => { sent.push(email); return null; } });
  assert.deepEqual(sent, ['b@example.com', 'a@example.com']);
});

test('visitor-only subscriptions remain supported and are reread before sending', async () => {
  const visitor = await subscription('guest', 'guest@example.com');
  const inactive = await subscription('inactive', 'inactive@example.com');
  await inactive.ref.update({ status: 'unsubscribed' });
  await deliver({ subscriptions: [visitor, visitor, inactive] });
  assert.deepEqual(sent.map(item => item.email), ['guest@example.com']);
});

test('an unverified account cannot suppress a visitor subscription by claiming its email', async () => {
  await account('account', 'philly', { emailVerified: false });
  const visitor = await subscription();
  await updates.setEnabled('account', false);
  assert.equal((await visitor.ref.get()).data().status, 'active');
  await deliver({ subscriptions: [visitor] });
  assert.deepEqual(sent.map(item => item.email), ['account@example.com']);
});

test('private/non-city atlases cannot collect automatic account recipients; legacy city field is supported', async () => {
  assert.equal(publicCity({ is_public: false, wiki_type: 'city' }), false);
  assert.equal(publicCity({ is_public: true, wiki_type: 'university', city_config: {} }), false);
  assert.equal(publicCity({ is_public: true, city_config: {} }), true);
  assert.equal(savedCity({}), null);
  assert.equal(savedCity({ preferredCitySlug: 'bad/path' }), null);
  assert.equal(savedCity({ preferred_city_slug: 'Boston' }), 'boston');
  await account();
  await db.doc('users/account').set({ preferred_city_slug: 'philly' });
  await deliver({ includeAccounts: false }); assert.equal(sent.length, 0);
  await deliver(); assert.equal(sent.length, 1);
});

test('city settings reflect absent, default-active and explicitly paused newsletters', async () => {
  await account();
  assert.equal((await updates.settings('account')).available, false);
  await db.doc('atlases/city-1').set({ slug: 'philly', name: 'Philadelphia', is_public: true, wiki_type: 'city' });
  assert.deepEqual(await updates.settings('account'), { enabled: true, emailVerified: true, citySlug: 'philly', cityName: 'Philadelphia', available: true });
  await db.doc('atlases/city-1').update({ newsletter_config: { enabled: false } });
  assert.equal((await updates.settings('account')).available, false);
});

test('pagination reads every document and the UTC week stays stable over year boundaries', async () => {
  await Promise.all(Array.from({ length: 13 }, (_, i) => db.doc(`users/page-${i}`).set({ preferredCitySlug: 'philly' })));
  const ids = [];
  for await (const page of cityUpdatePages(db.collection('users').where('preferredCitySlug', '==', 'philly'), 4)) ids.push(...page.map(doc => doc.id));
  assert.equal(new Set(ids).size, 13);
  assert.equal(cityUpdateWeek(new Date('2026-11-08T23:59:59Z')), '2026-11-02');
  assert.equal(cityUpdateWeek(new Date('2026-11-09T00:00:00Z')), '2026-11-09');
  assert.equal(cityUpdateWeek(new Date('2027-01-01T00:00:00Z')), '2026-12-28');
});

test('public callables require authentication and validate preferences; account unsubscribe HTTP validates tokens', async () => {
  const auth = getAuth();
  const originalGetUser = auth.getUser, originalByEmail = auth.getUserByEmail;
  auth.getUser = directory.getUser; auth.getUserByEmail = directory.getUserByEmail;
  try {
    const api = require('./lib/index');
    await assert.rejects(api.cityWeeklyUpdatesPreference.run({ data: { action: 'get' } }), { code: 'unauthenticated' });
    await account();
    const call = data => api.cityWeeklyUpdatesPreference.run({ auth: { uid: 'account' }, data });
    await assert.rejects(call({ action: 'set', enabled: 'yes' }), { code: 'invalid-argument' });
    await assert.rejects(call({ action: 'oops' }), { code: 'invalid-argument' });
    assert.equal((await call({ action: 'set', enabled: false })).enabled, false);
    await call({ action: 'set', enabled: true });
    const token = (await db.doc('city_weekly_updates/account').get()).data().unsubscribe_token;
    const response = () => ({ code: 0, body: '', set() {}, status(code) { this.code = code; return this; }, send(body) { this.body = body; return this; } });
    const res = response();
    await api.unsubscribeCityWeeklyUpdates({ method: 'GET', query: { uid: 'account', token } }, res);
    assert.equal(res.code, 200); assert.match(res.body, /Changing your city will not turn them back on/);
    const invalid = response();
    await api.unsubscribeCityWeeklyUpdates({ method: 'GET', query: { uid: 'account', token: 'bad' } }, invalid);
    assert.equal(invalid.code, 400);
  } finally { auth.getUser = originalGetUser; auth.getUserByEmail = originalByEmail; }
});

test('preferences, unsubscribe tokens, content caches and delivery receipts stay private under existing rules', async () => {
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  const env = await initializeTestEnvironment({ projectId: 'demo-living-wiki', firestore: { host, port: Number(port) } });
  try {
    for (const path of ['city_weekly_updates/account', 'city_weekly_deliveries/receipt', 'atlas_newsletter_content/week']) {
      await db.doc(path).set({ enabled: true, unsubscribe_token: 'secret' });
      for (const client of [env.authenticatedContext('account').firestore(), env.unauthenticatedContext().firestore()]) {
        await assertFails(getDoc(doc(client, path)));
        await assertFails(setDoc(doc(client, path), { enabled: true }));
      }
    }
  } finally { await env.cleanup(); }
});

test('the actual weekly scheduler reuses cached content, merges account and guest recipients, and produces working email links', async () => {
  const { createHash } = require('node:crypto');
  const sgMail = require('@sendgrid/mail');
  const auth = getAuth();
  const originals = { getUser: auth.getUser, byEmail: auth.getUserByEmail, send: sgMail.send, key: sgMail.setApiKey, env: process.env.SENDGRID_API_KEY };
  auth.getUser = directory.getUser; auth.getUserByEmail = directory.getUserByEmail;
  const emails = [];
  sgMail.setApiKey = () => {};
  sgMail.send = async email => { emails.push(email); return [{ headers: { 'x-message-id': `message-${emails.length}` } }]; };
  process.env.SENDGRID_API_KEY = 'local-test-only';
  try {
    await account();
    await subscription('overlap');
    await subscription('guest', 'guest@example.com');
    const now = new Date();
    const key = `${now.toISOString().slice(0, 10)}:00:00`;
    await db.doc('atlases/city-1').set({ name: 'Philadelphia', slug: 'philly', wiki_type: 'city', is_public: true,
      newsletter_config: { day_of_week: now.getUTCDay(), send_time: '00:00', timezone: 'UTC' } });
    await account('paused', 'boston');
    await db.doc('atlases/paused-city').set({ slug: 'boston', name: 'Boston', wiki_type: 'city', is_public: true,
      newsletter_config: { enabled: false, day_of_week: now.getUTCDay(), send_time: '00:00', timezone: 'UTC' } });
    const cacheId = createHash('sha256').update(`city-1:${key}`).digest('hex');
    await db.doc(`atlas_newsletter_content/${cacheId}`).set({ subject: 'Philadelphia this week', markdown: 'A local briefing.', previewText: 'Weekly update' });
    const api = require('./lib/index');
    await api.sendWeeklyAtlasNewsletters.run({});
    assert.equal(emails.length, 2);
    const accountEmail = emails.find(item => item.to === 'account@example.com');
    assert.match(accountEmail.html, /is your saved home city/);
    assert.match(accountEmail.text, /unsubscribeCityWeeklyUpdates\?uid=account&token=/);
    assert.match(emails.find(item => item.to === 'guest@example.com').text, /unsubscribeAtlasSubscription/);
    assert.equal((await db.doc('atlases/city-1').get()).data().newsletter_config.last_recipient_count, 2);
    assert.equal((await db.collection('atlas_newsletter_runs').get()).size, 1);
    await api.sendWeeklyAtlasNewsletters.run({});
    assert.equal(emails.length, 2);
  } finally {
    auth.getUser = originals.getUser; auth.getUserByEmail = originals.byEmail;
    sgMail.send = originals.send; sgMail.setApiKey = originals.key;
    if (originals.env === undefined) delete process.env.SENDGRID_API_KEY; else process.env.SENDGRID_API_KEY = originals.env;
  }
});
