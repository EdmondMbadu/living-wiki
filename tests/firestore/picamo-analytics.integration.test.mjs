import assert from 'node:assert/strict';
import { before, beforeEach, after, test } from 'node:test';
import { createRequire } from 'node:module';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
const require = createRequire(new URL('../../functions/package.json', import.meta.url));
process.env.GCLOUD_PROJECT = 'demo-living-wiki';
const { db } = require('./lib/firebase');
const api = require('./lib/picamo-analytics');
const { Timestamp } = require('firebase-admin/firestore');
const from = '2026-01-30',
  to = '2026-02-02',
  start = Date.parse('2026-01-31T23:59:30Z');
const b = (actor = 'account-a', extra = {}) => ({
  actor,
  account: true,
  internal: false,
  source: 'assistant',
  label: 'Assistant',
  atlasId: '',
  ...extra,
});
const meta = (n = 1, session = 'session-0000000001') => ({
  sessionId: session,
  requestId: `request-${String(n).padStart(12, '0')}`,
});
const report = (extra = {}) =>
  api.getPicamoAnalytics.run({
    auth: { uid: 'admin' },
    data: { from, to, group: 'day', refresh: true, ...extra },
  });
async function turn(binding = b(), m = meta(), at = start, outcome = 'success') {
  const trace = await api.beginPicamoText(binding, m, at);
  await api.finishPicamoText(trace, outcome, at + 2000);
  return trace;
}
before(() =>
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'Use the Firestore emulator, never production.'),
);
beforeEach(async () => {
  await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-living-wiki/databases/(default)/documents`,
    { method: 'DELETE' },
  );
  await db.doc('users/admin').set({ role: 'admin' });
  await db.doc('users/member').set({ role: 'user' });
});
after(async () => {
  await db.terminate();
});

test('admin authorization is enforced by the callable, and raw metadata is opaque to clients', async () => {
  await assert.rejects(api.getPicamoAnalytics.run({ data: {} }), /Sign in/);
  await assert.rejects(
    api.getPicamoAnalytics.run({ auth: { uid: 'member' }, data: {} }),
    /administrators/,
  );
  const env = await initializeTestEnvironment({ projectId: 'demo-living-wiki' });
  try {
    for (const uid of ['member', 'admin']) {
      const client = env.authenticatedContext(uid).firestore();
      for (const collection of [
        'sessions',
        'requests',
        'daily',
        'participants',
        'scopes',
        'voice_sessions',
        'providers',
        'meta',
      ]) {
        await assertFails(getDoc(doc(client, `picamo_analytics_${collection}/private`)));
        await assertFails(
          setDoc(doc(client, `picamo_analytics_${collection}/forged`), { messages: 999 }),
        );
      }
    }
  } finally {
    await env.cleanup();
  }
});

test('eight questions in one chat count once, including duplicate and concurrent receipt delivery', async () => {
  for (let n = 1; n <= 8; n++) await turn(b(), meta(n), start + n * 1000);
  const traces = await Promise.all([
    api.beginPicamoText(b(), meta(8), start + 8000),
    api.beginPicamoText(b(), meta(8), start + 8000),
  ]);
  await Promise.all(traces.map((t) => api.finishPicamoText(t, 'success', start + 10000)));
  const r = await report();
  assert.equal(r.totals.conversations, 1);
  assert.equal(r.totals.text, 1);
  assert.equal(r.totals.messages, 8);
  assert.equal(r.totals.responses, 8);
  assert.equal(r.totals.accounts, 1);
  assert.equal(r.rows[0].messages, 8);
  assert.equal(r.rows[0].seconds, 7);
});

test('inactivity starts a new session, while messages crossing midnight retain their actual date', async () => {
  await turn(b(), meta(1), start);
  await turn(b(), meta(2), start + 60000);
  await turn(b(), meta(3), start + 32 * 60000);
  const r = await report();
  assert.equal(r.totals.text, 2);
  assert.equal(r.totals.accounts, 1);
  assert.equal(r.series.find((s) => s.period === '2026-01-31').messages, 1);
  assert.equal(r.series.find((s) => s.period === '2026-02-01').messages, 2);
  assert.equal(r.series.find((s) => s.period === '2026-02-01').text, 1);
});

test('local turns count as messages without inventing successful AI answers; backend completion supersedes local handling once', async () => {
  const trace = await api.beginPicamoText(b(), meta(), start);
  await api.finishPicamoText(trace, 'handled', start + 1000);
  assert.equal((await report()).totals.responses, 0);
  await api.finishPicamoText(trace, 'failed', start + 2000);
  await api.finishPicamoText(trace, 'handled', start + 3000);
  await api.finishPicamoText(trace, 'success', start + 3000);
  const r = await report();
  assert.equal(r.totals.failures, 1);
  assert.equal(r.totals.successes, 0);
  assert.equal(r.totals.conversations, 1);
  assert.equal(r.rows[0].status, 'failed');
});

test('ordinary owners count, platform admins are server-classified and excluded by default', async () => {
  const wrapped = api.withPicamoAssistantText(async () => ({ reply: 'OK' }));
  for (const uid of ['member', 'admin'])
    await wrapped({
      auth: { uid },
      data: { message: 'Hello', picamoTracking: meta(), internal: false },
    });
  const range = {
    from: new Date().toISOString().slice(0, 10),
    to: new Date().toISOString().slice(0, 10),
  };
  assert.equal((await report(range)).totals.text, 1);
  assert.equal((await report({ ...range, includeInternal: true })).totals.text, 2);
  assert.equal((await db.collection('picamo_analytics_requests').get()).size, 2);
});

test('only genuine Picamo cities are tracked; other personas, absent metadata, and voice tools remain excluded', async () => {
  await db
    .doc('atlases/city-picamo')
    .set({ wiki_type: 'city', city_config: { enabled: true, city_name: 'Miami' } });
  await db
    .doc('atlases/city-persona')
    .set({ wiki_type: 'city', chat_guide: { name: 'Other', city_persona_override: true } });
  for (const [atlasId, tracking] of [
    ['city-picamo', meta()],
    ['city-persona', meta()],
    ['city-picamo', undefined],
  ]) {
    assert.equal(
      await api.trackPicamoCityText(
        { atlasId, uid: 'member', tracking },
        async () => 'real answer',
      ),
      'real answer',
    );
  }
  const range = {
    from: new Date().toISOString().slice(0, 10),
    to: new Date().toISOString().slice(0, 10),
  };
  const r = await report(range);
  assert.equal(r.totals.text, 1);
  assert.equal(r.rows[0].label, 'Miami');
  assert.equal((await report({ ...range, source: 'assistant' })).totals.text, 0);
  assert.equal((await report({ ...range, source: 'city' })).totals.text, 1);
});

const job = (extra = {}) => ({ ...b(), agentId: 'agent-verified', issuedAt: start, ...extra });
const voice = (extra = {}) => ({
  user_id: 'pca_test-session',
  agent_id: 'agent-verified',
  conversation_id: 'provider-conversation-0001',
  status: 'done',
  metadata: { start_time_unix_secs: start / 1000, call_duration_secs: 90 },
  transcript: [
    { role: 'agent', message: 'Welcome' },
    { role: 'user', message: 'Hello', time_in_call_secs: 10 },
    { role: 'user', message: 'Tell me more', time_in_call_secs: 40 },
  ],
  ...extra,
});
test('verified voice splits time and messages across UTC dates and is deduplicated by provider ID', async () => {
  const d = voice();
  await api.recordPicamoVerifiedVoice(d.user_id, job(), d);
  await api.recordPicamoVerifiedVoice(d.user_id, job(), d);
  const r = await report();
  assert.equal(r.totals.voice, 1);
  assert.equal(r.totals.text, 0);
  assert.equal(r.totals.messages, 2);
  assert.equal(r.totals.seconds, 90);
  assert.equal(r.series.find((s) => s.period === '2026-01-31').seconds, 30);
  assert.equal(r.series.find((s) => s.period === '2026-02-01').seconds, 60);
  assert.equal(r.series.find((s) => s.period === '2026-02-01').messages, 1);
  const raw = (await db.doc(`picamo_analytics_sessions/${d.user_id}`).get()).data();
  assert.ok(!JSON.stringify(raw).includes('Tell me more'));
  assert.ok(!('transcript' in raw));
});
test('greeting-only calls, running calls, and silence are excluded; missing duration stays unknown', async () => {
  const d = voice({
    transcript: [
      { role: 'agent', message: 'Hello' },
      { role: 'user', message: '...' },
    ],
  });
  await api.recordPicamoVerifiedVoice(d.user_id, job(), d);
  assert.equal((await report()).totals.voice, 0);
  assert.equal(
    await api.recordPicamoVerifiedVoice(d.user_id, job(), voice({ status: 'processing' })),
    false,
  );
  await api.recordPicamoVerifiedVoice(
    d.user_id,
    job(),
    voice({ metadata: { start_time_unix_secs: start / 1000 } }),
  );
  const r = await report();
  assert.equal(r.totals.unknownDurations, 1);
  assert.equal(r.rows[0].seconds, null);
});
test('forged voice agent and nonce, anonymous attachment and invalid dates are rejected', async () => {
  await assert.rejects(
    api.recordPicamoVerifiedVoice('different-nonce', job(), voice()),
    /verified/,
  );
  await assert.rejects(
    api.recordPicamoVerifiedVoice('pca_test-session', job({ agentId: 'other' }), voice()),
    /verified/,
  );
  await assert.rejects(
    api.syncPicamoVoiceAnalytics.run({
      data: {
        sessionId: 'pca_00000000-0000-0000-0000-000000000000',
        conversationId: 'provider-conversation-0001',
      },
    }),
    /not available/,
  );
  await assert.rejects(report({ from: '2026-02-30' }), /valid dates/);
});
test('period uniques deduplicate across days and sources; account and browser counts remain separate', async () => {
  await turn(b(), meta(1), start);
  await turn(b(), meta(2), start + 60000);
  await turn(
    b('account-a', { source: 'city', label: 'Miami', atlasId: 'miami' }),
    meta(3),
    start + 60000,
  );
  await turn(b('guest-a', { account: false }), meta(1), start);
  const r = await report({ group: 'month' });
  assert.equal(r.totals.accounts, 1);
  assert.equal(r.totals.guests, 1);
  assert.equal(r.series.find((s) => s.period === '2026-01').messages, 2);
  assert.equal(r.series.find((s) => s.period === '2026-02').messages, 2);
  assert.equal(r.series.find((s) => s.period === '2026-01').recorded, true);
  assert.equal(r.series.find((s) => s.period === '2026-01').partial, true);
});
test('history before capture is unrecorded, rather than measured zero', async () => {
  let r = await report();
  assert.equal(r.coverage.unrecorded, true);
  assert.equal(r.trackingSince, null);
  await turn();
  r = await report({ from: '2026-01-01', to: '2026-01-30' });
  assert.equal(r.coverage.unrecorded, true);
  assert.ok(r.series.every((s) => !s.recorded));
});
test('recent sessions paginate deterministically, date/mode filters work, and export includes every matching row', async () => {
  for (let n = 1; n <= 27; n++) await turn(b(`account-${n}`), meta(n), start);
  const first = await report();
  assert.equal(first.rows.length, 25);
  assert.ok(first.nextCursor);
  const second = await report({ cursor: first.nextCursor });
  assert.equal(second.rows.length, 2);
  assert.equal(new Set([...first.rows, ...second.rows].map((r) => r.id)).size, 27);
  assert.equal((await report({ export: true })).rows.length, 27);
  assert.equal((await report({ mode: 'voice' })).rows.length, 0);
  assert.equal((await report({ recentFrom: '2026-02-01', recentTo: '2026-02-01' })).rows.length, 0);
});
test('recording failures cannot break an answer, and original model errors propagate unchanged', async () => {
  const handler = api.withPicamoAssistantText(async () => {
    throw new Error('original model error');
  });
  await assert.rejects(
    handler({ auth: { uid: 'member' }, data: { message: 'Hello', picamoTracking: meta() } }),
    /original model error/,
  );
  assert.equal(
    (await db.collection('picamo_analytics_requests').get()).docs[0].data().status,
    'failed',
  );
  const ordinary = api.withPicamoAssistantText(async () => 'still works');
  assert.equal(
    await ordinary({
      auth: { uid: 'member' },
      data: { message: 'Hello', picamoTracking: { sessionId: 'bad/path' } },
    }),
    'still works',
  );
});
