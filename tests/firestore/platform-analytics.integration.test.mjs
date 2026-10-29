import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createRequire } from 'node:module';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
const require = createRequire(new URL('../../functions/package.json', import.meta.url));
process.env.GCLOUD_PROJECT = 'demo-living-wiki';
const { db } = require('./lib/firebase');
const { Timestamp, FieldValue } = require('firebase-admin/firestore');
const api = require('./lib/platform-analytics');
const cardApi = require('./lib/card-analytics');
const admin = 'platform-admin',
  owner = 'platform-owner',
  boardId = 'platform-board',
  teamBoard = 'platform-team-board',
  cardId = 'platform-card',
  atlasId = 'platform-avatar';
const cards = [
  { id: cardId, title: 'Guide', conversation: { provider: 'atlas', atlasId } },
  {
    id: 'ordinary',
    title: 'Ordinary',
    relatedCards: [{ id: 'nested', title: 'Nested', authorOnly: true }],
  },
  { id: 'nested', title: 'Duplicate reference' },
];
const actor = { auth: { uid: admin } };
const call = (options = {}) =>
  api.getPlatformAnalytics.run({
    ...actor,
    data: { from: '2026-01-01', to: '2026-02-28', group: 'day', view: 'cards', ...options },
  });
const usage = (extra = {}) => ({
  boardId,
  cardId,
  ownerId: owner,
  teamId: '',
  ownerKey: `user:${owner}`,
  boardTitle: 'Platform fixture',
  cardTitle: 'Guide',
  mode: 'voice',
  internal: false,
  startedAt: '2026-01-31T23:59:30.000Z',
  seconds: 110,
  questions: 1,
  failedAnswers: 0,
  ...extra,
});
async function bootstrap() {
  const id = await api.startPlatformSync();
  for (let n = 0; n < 100; n++) {
    const state = (await db.collection('platform_analytics_jobs').doc(id).get()).data();
    if (state.status === 'complete') return id;
    await api.processPlatformBatch(id, state.step);
  }
  throw new Error('Sync did not finish');
}
let baseline = { boards: 0, cards: 0, talkingCards: 0 };
async function totals() {
  const value = (await api.getPlatformInventory.run({ ...actor, data: {} })).inventory;
  return Object.fromEntries(Object.keys(baseline).map((key) => [key, value[key] - baseline[key]]));
}
before(async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'Use emulator, never production.');
  // Other serial integration suites may leave unrelated boards in this emulator.
  const canonical = new Map();
  for (const collection of ['boards', 'team_boards']) {
    for (const doc of (await db.collection(collection).get()).docs)
      canonical.set(doc.id, doc.data());
  }
  for (const board of canonical.values()) {
    if (board.deleted || board.is_deleted || board.deleted_at || board.deletedAt) continue;
    const list = api.platformCards(board.cards);
    baseline.boards++;
    baseline.cards += list.length;
    baseline.talkingCards += list.filter(
      (c) => c.conversation?.provider === 'atlas' && c.conversation?.atlasId,
    ).length;
  }
  await db.collection('users').doc(admin).set({ role: 'admin', displayName: 'Platform Admin' });
  await db.collection('users').doc(owner).set({ role: 'user', displayName: 'Fixture Owner' });
  await db
    .collection('atlases')
    .doc(atlasId)
    .set({ id: atlasId, user_id: owner, admin_user_ids: [] });
  await db
    .collection('boards')
    .doc(boardId)
    .set({ owner_user_id: owner, title: 'Platform fixture', visibility: 'public', cards });
  await db
    .collection('boards')
    .doc(teamBoard)
    .set({
      owner_user_id: owner,
      team_id: 'platform-team',
      title: 'Published',
      visibility: 'public',
      cards: [{ id: 'published-card', title: 'Published card' }],
    });
  await db
    .collection('team_boards')
    .doc(teamBoard)
    .set({
      owner_user_id: owner,
      team_id: 'platform-team',
      title: 'Working draft',
      visibility: 'private',
      cards: [
        { id: 'team-card', title: 'Team guide', conversation: { provider: 'atlas', atlasId } },
      ],
    });
  await db.collection('teams').doc('platform-team').set({ name: 'Fixture Team', status: 'active' });
});
after(async () => {
  for (const name of ['boards', 'team_boards'])
    for (const id of [boardId, teamBoard, 'platform-other-board', 'platform-creation-fixture'])
      await db.collection(name).doc(id).delete();
  await db.collection('atlases').doc(atlasId).delete();
  await db.collection('teams').doc('platform-team').delete();
  for (const name of (await db.listCollections())
    .map((c) => c.id)
    .filter((n) => n.startsWith('platform_analytics_')))
    await db.recursiveDelete(db.collection(name));
  for (const uid of [owner, admin]) await db.collection('users').doc(uid).delete();
  const jobs = await db
    .collection('card_analytics_voice_sessions')
    .where('board_id', '==', boardId)
    .get();
  for (const d of jobs.docs) await db.recursiveDelete(d.ref);
});
test('global APIs require a platform administrator, including cached inventory', async () => {
  for (const fn of [
    api.getPlatformAnalytics,
    api.getPlatformInventory,
    api.startPlatformAnalyticsSync,
  ]) {
    await assert.rejects(fn.run({ data: {} }), { code: 'unauthenticated' });
    await assert.rejects(fn.run({ data: {}, auth: { uid: owner } }), { code: 'permission-denied' });
  }
});
test('bootstrap is idempotent and counts nested cards and team drafts exactly once', async () => {
  const id = await bootstrap();
  assert.deepEqual(await totals(), { boards: 2, cards: 4, talkingCards: 2 });
  const complete = (await db.collection('platform_analytics_jobs').doc(id).get()).data();
  await api.processPlatformBatch(id, complete.step - 1);
  assert.deepEqual(await totals(), { boards: 2, cards: 4, talkingCards: 2 });
});
test('creation series uses saved UTC dates, fills gaps, and groups exact boundaries', () => {
  const records = [
    '2026-01-31T23:59:59Z',
    '2026-02-01T00:30:00+01:00',
    '2026-02-01T00:00:00Z',
    '2026-02-01T23:59:59Z',
    '2025-12-31T23:59:59Z',
    null,
    'invalid',
    '2099-01-01T00:00:00Z',
  ].map((created_at) => ({ created_at }));
  const dates = { from: '2026-01-30', to: '2026-02-01', group: 'day' };
  const daily = api.platformBoardCreationSeries(records, dates);
  assert.deepEqual(daily.series, [
    { period: '2026-01-30', boards: 0 },
    { period: '2026-01-31', boards: 2 },
    { period: '2026-02-01', boards: 2 },
  ]);
  assert.equal(daily.total, 4);
  assert.equal(daily.missingDates, 3);
  assert.equal(daily.datedBoards, 5);
  assert.deepEqual(api.platformBoardCreationSeries(records, { ...dates, group: 'month' }).series, [
    { period: '2026-01', boards: 2 },
    { period: '2026-02', boards: 2 },
  ]);
  assert.deepEqual(
    api.platformBoardCreationSeries(records, { ...dates, from: '2025-12-01', group: 'year' })
      .series,
    [
      { period: '2025', boards: 1 },
      { period: '2026', boards: 4 },
    ],
  );
  assert.equal(
    api.platformBoardCreatedAt('bad', Timestamp.fromDate(new Date('2026-01-01')), '2026-02-01'),
    '2026-01-01T00:00:00.000Z',
  );
});
test('unknown creation dates are never replaced by a sync date or a measured zero', () => {
  const dates = { from: '2026-01-01', to: '2026-01-02', group: 'day' };
  const unknown = api.platformBoardCreationSeries([{ created_at: null }], dates);
  assert.equal(unknown.total, null);
  assert.equal(unknown.missingDates, 1);
  assert.equal(api.platformBoardCreationSeries([], dates).total, 0);
});
test('creation history counts a team draft/published pair once and survives edits and deletion', async () => {
  const id = 'platform-creation-fixture';
  await db
    .collection('boards')
    .doc(id)
    .set({ owner_user_id: owner, created_at_iso: '2026-01-31T23:59:59Z', cards: [] });
  await api.syncPlatformInventoryBoard(id);
  await db.collection('team_boards').doc(id).set({
    owner_user_id: owner,
    team_id: 'platform-team',
    created_at_iso: '2026-02-02T00:00:00Z',
    cards: [],
  });
  await Promise.all([api.syncPlatformInventoryBoard(id), api.syncPlatformInventoryBoard(id)]);
  assert.equal((await totals()).boards, 3);
  const ref = db.collection('platform_analytics_board_creations').doc(id);
  assert.equal((await ref.get()).data().created_at, '2026-01-31T23:59:59.000Z');
  await db.collection('boards').doc(id).update({ created_at_iso: '2026-02-05T00:00:00Z' });
  await api.syncPlatformInventoryBoard(id);
  assert.equal((await ref.get()).data().created_at, '2026-01-31T23:59:59.000Z');
  await db.collection('boards').doc(id).delete();
  await db.collection('team_boards').doc(id).delete();
  await api.syncPlatformInventoryBoard(id);
  assert.equal((await totals()).boards, 2);
  assert.equal((await ref.get()).data().created_at, '2026-01-31T23:59:59.000Z');
  const visitor = await call({ refresh: true }),
    internal = await call({ includeInternal: true, refresh: true });
  assert.deepEqual(visitor.boardCreation, internal.boardCreation);
  assert.ok(
    visitor.boardCreation.series.some((row) => row.period === '2026-01-31' && row.boards >= 1),
  );
});
test('existing installations backfill creation history without blocking current usage reports', async () => {
  await db
    .collection('platform_analytics_meta')
    .doc('state')
    .update({ boardCreationsReady: FieldValue.delete() });
  const preparing = await call({ refresh: true });
  assert.equal(preparing.preparing, false);
  assert.ok(preparing.inventory);
  assert.equal(preparing.boardCreation.preparing, true);
  await bootstrap();
  const completed = await call({ refresh: true });
  assert.equal(completed.boardCreation.preparing, false);
  assert.ok(completed.boardCreation.series.length);
});
test('delayed deletion events retain a creation without restoring a deleted board', async () => {
  await api.syncPlatformInventoryBoard('platform-deleted-before-delivery', [
    { created_at_iso: '2026-01-15T08:00:00Z' },
  ]);
  assert.equal(
    (
      await db
        .collection('platform_analytics_inventory')
        .doc('platform-deleted-before-delivery')
        .get()
    ).exists,
    false,
  );
  const creation = await db
    .collection('platform_analytics_board_creations')
    .doc('platform-deleted-before-delivery')
    .get();
  assert.equal(creation.data().created_at, '2026-01-15T08:00:00.000Z');
  assert.equal((await totals()).boards, 2);
});
test('a stalled handoff is safely requeued once and drains without another event', async () => {
  const id = await api.startPlatformSync();
  await db
    .collection('platform_analytics_jobs')
    .doc(id)
    .update({ updatedAt: Timestamp.fromMillis(Date.now() - 120000) });
  const before = (await db.collection('platform_analytics_batches').where('jobId', '==', id).get())
    .size;
  await Promise.all([api.wakePlatformSync(id), api.wakePlatformSync(id)]);
  assert.equal(
    (await db.collection('platform_analytics_batches').where('jobId', '==', id).get()).size,
    before + 1,
  );
  await api.drainPlatformBatches(id, 0, 20000);
  assert.equal(
    (await db.collection('platform_analytics_jobs').doc(id).get()).data().status,
    'complete',
  );
  assert.deepEqual(await totals(), { boards: 2, cards: 4, talkingCards: 2 });
});
test('inventory sync reads the latest canonical data on repeated and out-of-order delivery', async () => {
  await db
    .collection('boards')
    .doc(boardId)
    .update({
      cards: [...cards, { id: 'second-placement', conversation: { provider: 'atlas', atlasId } }],
    });
  await Promise.all([
    api.syncPlatformInventoryBoard(boardId),
    api.syncPlatformInventoryBoard(boardId),
  ]);
  assert.deepEqual(await totals(), { boards: 2, cards: 5, talkingCards: 3 });
  await db.collection('boards').doc(boardId).update({ cards });
  await api.syncPlatformInventoryBoard(boardId);
  assert.deepEqual(await totals(), { boards: 2, cards: 4, talkingCards: 2 });
});
test('removing a published team copy preserves its draft and deleting both removes one board', async () => {
  await db
    .collection('boards')
    .doc('platform-other-board')
    .set({ owner_user_id: owner, cards: [{ id: 'single' }] });
  await db
    .collection('team_boards')
    .doc('platform-other-board')
    .set({ owner_user_id: owner, cards: [{ id: 'single' }] });
  await api.syncPlatformInventoryBoard('platform-other-board');
  await db.collection('boards').doc('platform-other-board').delete();
  await api.syncPlatformInventoryBoard('platform-other-board');
  assert.equal((await totals()).boards, 3);
  await db.collection('team_boards').doc('platform-other-board').delete();
  await api.syncPlatformInventoryBoard('platform-other-board');
  assert.equal((await totals()).boards, 2);
});
test('verified voice seconds split across UTC midnight and conversations stay on the start day', async () => {
  const days = api.platformUsageDays(usage());
  assert.equal(days['2026-01-31'].seconds, 30);
  assert.equal(days['2026-02-01'].seconds, 80);
  assert.equal(days['2026-01-31'].conversations, 1);
  assert.equal(days['2026-02-01'].conversations, 0);
  await api.capturePlatformUsage('voice-one', usage({ providerId: 'provider-one' }));
  let r = await call({ refresh: true });
  assert.equal(r.totals.conversations, 1);
  assert.equal(r.totals.seconds, 110);
  assert.equal(r.totals.activeCards, 1);
  assert.equal(r.series.find((d) => d.period === '2026-01-31').seconds, 30);
  assert.equal(r.series.find((d) => d.period === '2026-02-01').seconds, 80);
  const month = await call({ group: 'month' });
  assert.deepEqual(
    month.series.map((d) => d.seconds),
    [30, 80],
  );
  const year = await call({ group: 'year' });
  assert.equal(year.series[0].seconds, 110);
});
test('provider replays and a second ingestion source cannot double count one call', async () => {
  await api.capturePlatformUsage('voice-one', usage({ providerId: 'provider-one' }));
  await api.capturePlatformUsage('same-call-team-source', usage({ providerId: 'provider-one' }));
  const r = await call({ refresh: true });
  assert.equal(r.totals.voice, 1);
  assert.equal(r.totals.seconds, 110);
});
test('late provider attribution merges earlier receipts rather than adding another call', async () => {
  await api.capturePlatformUsage(
    'late-source-one',
    usage({ startedAt: '2026-02-02T12:00:00Z', seconds: 20 }),
  );
  await api.capturePlatformUsage(
    'late-source-two',
    usage({ startedAt: '2026-02-02T12:00:00Z', seconds: 20, providerId: 'provider-late' }),
  );
  await api.capturePlatformUsage(
    'late-source-one',
    usage({ startedAt: '2026-02-02T12:00:00Z', seconds: 20, providerId: 'provider-late' }),
  );
  const r = await call({ refresh: true });
  assert.equal(r.totals.voice, 2);
  assert.equal(r.totals.seconds, 130);
});
test('text time is not converted to voice minutes and failure updates are idempotent', async () => {
  const text = usage({
    mode: 'text',
    seconds: 900,
    startedAt: '2026-02-03T10:00:00Z',
    questions: 1,
  });
  await api.capturePlatformUsage('text-one', text);
  await api.capturePlatformUsage('text-one', { ...text, questions: 2, failedAnswers: 1 });
  await api.capturePlatformUsage('text-one', { ...text, questions: 2, failedAnswers: 1 });
  const r = await call({ refresh: true });
  assert.equal(r.totals.text, 1);
  assert.equal(r.totals.seconds, 130);
  assert.equal(r.totals.failedAnswers, 1);
  assert.equal(r.totals.activeCards, 1);
});
test('internal sessions are available only when included and preserve visitor totals', async () => {
  await api.capturePlatformUsage(
    'internal-voice',
    usage({
      internal: true,
      seconds: 65,
      startedAt: '2026-02-04T10:00:00Z',
      providerId: 'provider-internal',
    }),
  );
  const visitors = await call({ refresh: true });
  const all = await call({ includeInternal: true });
  assert.equal(all.totals.voice, visitors.totals.voice + 1);
  assert.equal(all.totals.seconds, visitors.totals.seconds + 65);
});
test('owner changes cannot rewrite the owner originally captured for a conversation', async () => {
  await api.capturePlatformUsage(
    'voice-one',
    usage({ ownerKey: 'user:other-owner', ownerId: 'other-owner', providerId: 'provider-one' }),
  );
  const r = await call({ view: 'users', refresh: true });
  assert.equal(r.breakdown.rows.find((row) => row.title === 'Fixture Owner').seconds, 130);
  assert.equal(
    r.breakdown.rows.some((row) => row.title === 'User other-ow'),
    false,
  );
});
test('raw conversation cleanup does not erase durable usage totals', async () => {
  await db
    .collection('card_analytics_conversations')
    .doc('platform-expired')
    .set({
      board_id: boardId,
      card_id: cardId,
      mode: 'text',
      started_at: Timestamp.fromDate(new Date('2026-02-05T10:00:00Z')),
      questions: 1,
      failed_answers: 0,
    });
  await api.ingestPlatformConversation(
    'platform-expired',
    (await db.collection('card_analytics_conversations').doc('platform-expired').get()).data(),
  );
  const before = await call({ refresh: true });
  await db.collection('card_analytics_conversations').doc('platform-expired').delete();
  await api.syncPlatformConversationUsage.run({
    params: { id: 'platform-expired' },
    data: { after: { exists: false } },
  });
  const after = await call({ refresh: true });
  assert.equal(after.totals.conversations, before.totals.conversations);
});
test('a real internal text handler is measured without storing question text or public transcripts', async () => {
  const wrapped = api.withPlatformTextUsage(async () => ({ answer: 'Private answer' }));
  const request = {
    auth: { uid: owner },
    data: {
      boardId,
      cardId,
      atlasId,
      analyticsSessionId: 'platform-internal-session',
      analyticsRequestId: 'internal-request-one',
      question: 'Private question',
    },
  };
  const before = (await db.collection('card_analytics_conversations').get()).size;
  await wrapped(request);
  await wrapped(request);
  const sessions = await db.collection('platform_analytics_text_sessions').get();
  assert.equal(sessions.size, 1);
  assert.equal(sessions.docs[0].data().questions, 1);
  assert.equal(JSON.stringify(sessions.docs[0].data()).includes('Private question'), false);
  assert.equal((await db.collection('card_analytics_conversations').get()).size, before);
  await api.ingestPlatformConversation(sessions.docs[0].id, sessions.docs[0].data(), 'internal');
  assert.equal(
    (
      await call({
        includeInternal: true,
        from: new Date().toISOString().slice(0, 10),
        to: new Date().toISOString().slice(0, 10),
        refresh: true,
      })
    ).totals.text,
    1,
  );
});
test('analytics preparation failures cannot interrupt a real answer', async () => {
  const original = db.getAll;
  db.getAll = async () => {
    throw new Error('Telemetry unavailable');
  };
  try {
    const answer = await api.withPlatformTextUsage(async () => 'Answer remains available')({
      auth: { uid: owner },
      data: {
        atlasId,
        boardId,
        cardId,
        analyticsSessionId: 'session_resilience',
        analyticsRequestId: 'request_resilience',
      },
    });
    assert.equal(answer, 'Answer remains available');
  } finally {
    db.getAll = original;
  }
});
test('internal draft conversations use the team board context', async () => {
  await api.withPlatformTextUsage(async () => 'Draft answer')({
    auth: { uid: owner },
    data: {
      atlasId,
      boardId: teamBoard,
      cardId: 'team-card',
      analyticsSessionId: 'draft_session',
      analyticsRequestId: 'draft_request',
    },
  });
  const sessions = await db
    .collection('platform_analytics_text_sessions')
    .where('board_id', '==', teamBoard)
    .get();
  assert.equal(sessions.size, 1);
  assert.equal(sessions.docs[0].data().team_id, 'platform-team');
});
test('automated QA and ordinary workspace requests without card metadata are not internal conversations', async () => {
  const before = (await db.collection('platform_analytics_text_sessions').get()).size;
  await api.withPlatformTextUsage(async () => ({ answer: 'QA fixture' }))({
    auth: { uid: owner },
    data: { atlasId, question: 'QA question' },
  });
  assert.equal((await db.collection('platform_analytics_text_sessions').get()).size, before);
});
test('invalid dates are rejected and old unrecorded periods are flagged instead of treated as measured zero', async () => {
  for (const dates of [
    { from: '2026-02-31', to: '2026-03-01' },
    { from: '2026-03-01', to: '2026-01-01' },
    { from: '2099-01-01', to: '2099-02-01' },
  ])
    await assert.rejects(call(dates), { code: 'invalid-argument' });
  const r = await call({ from: '2025-01-01', to: '2025-12-31', group: 'year', refresh: true });
  assert.equal(r.coverage.unrecorded, true);
  assert.equal(
    r.series.every((d) => !d.recorded),
    true,
  );
});
test('unknown voice durations stay explicitly unknown', async () => {
  await api.capturePlatformUsage(
    'unknown-duration',
    usage({ seconds: null, startedAt: '2026-02-07T10:00:00Z', providerId: 'provider-unknown' }),
  );
  const r = await call({ refresh: true });
  assert.equal(r.totals.unknownDurations, 1);
  assert.equal(r.totals.seconds, 130);
});
test('owner and legacy voice sessions are globally verified without creating fake browser visitors', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const baselineUsage = await call({
    from: today,
    to: today,
    includeInternal: true,
    refresh: true,
  });
  const originalFetch = globalThis.fetch;
  process.env.ELEVENLABS_API_KEY = 'fixture_key';
  for (const [uid, browser, message] of [
    [owner, 'platform_browser_123456', 'Hello'],
    [null, null, 'Hello'],
    [owner, 'platform_browser_123456', '...'],
  ]) {
    const request = {
      auth: uid ? { uid } : undefined,
      data: {
        boardId,
        cardId,
        anonymousVisitorId: 'platform_visitor_123456',
        analyticsVisitorId: browser,
      },
      rawRequest: { headers: { 'user-agent': 'Mozilla/5.0' } },
    };
    const nonce = await cardApi.issueCardVoice(
      request,
      { id: atlasId, user_id: owner },
      'platform-agent',
    );
    assert.ok(nonce);
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          user_id: nonce,
          agent_id: 'platform-agent',
          conversation_id: `conv_${nonce.replaceAll('-', '')}`,
          status: 'done',
          metadata: { start_time_unix_secs: Math.floor(Date.now() / 1000), call_duration_secs: 12 },
          transcript: [{ role: 'user', message, time_in_call_secs: 1 }],
        }),
        { status: 200 },
      );
    await cardApi.syncCardVoiceAnalytics.run({
      ...request,
      data: {
        ...request.data,
        sessionId: nonce,
        conversationId: `conv_${nonce.replaceAll('-', '')}`,
      },
    });
    assert.equal(
      (await db.collection('card_analytics_conversations').doc(nonce).get()).exists,
      false,
    );
  }
  globalThis.fetch = originalFetch;
  const r = await call({
    from: new Date().toISOString().slice(0, 10),
    to: new Date().toISOString().slice(0, 10),
    includeInternal: true,
    refresh: true,
  });
  assert.equal(r.totals.voice - baselineUsage.totals.voice, 2);
  assert.equal(r.totals.seconds - baselineUsage.totals.seconds, 24);
});
test('inventory pagination and exports include unused talking cards and never stop at the first page', async () => {
  const more = Array.from({ length: 31 }, (_, i) => ({
    id: `export-card-${i}`,
    title: `Export ${i}`,
    conversation: { provider: 'atlas', atlasId },
  }));
  await db
    .collection('boards')
    .doc('platform-other-board')
    .set({ owner_user_id: owner, title: 'Export board', visibility: 'private', cards: more });
  await api.syncPlatformInventoryBoard('platform-other-board');
  const first = await call({ search: 'Export', refresh: true });
  assert.equal(first.breakdown.total, 31);
  assert.equal(first.breakdown.rows.length, 25);
  const second = await call({ search: 'Export', page: 2 });
  assert.equal(second.breakdown.rows.length, 6);
  const exported = await call({ search: 'Export', export: true });
  assert.equal(exported.breakdown.rows.length, 31);
});
test('pending sessions and unverified calls remain separate from measured conversation minutes', async () => {
  await api.syncPlatformPending('pending-fixture', {
    board_id: boardId,
    card_id: cardId,
    issued_at: Timestamp.now(),
    status: 'waiting',
    internal: false,
  });
  await api.syncPlatformPending('unverified-fixture', {
    board_id: boardId,
    card_id: cardId,
    issued_at: Timestamp.now(),
    status: 'unavailable',
    internal: false,
  });
  let r = await call({ refresh: true });
  assert.equal(r.pending, 1);
  assert.equal(r.unverified, 1);
  await api.syncPlatformPending('pending-fixture', { status: 'done' });
  r = await call({ refresh: true });
  assert.equal(r.pending, 0);
});
test('Firestore clients cannot read or forge platform metrics, even as a platform admin', async () => {
  const env = await initializeTestEnvironment({ projectId: 'demo-living-wiki' });
  try {
    for (const uid of [admin, owner, null]) {
      const client = uid
        ? env.authenticatedContext(uid).firestore()
        : env.unauthenticatedContext().firestore();
      for (const collection of [
        'platform_analytics_inventory',
        'platform_analytics_board_creations',
        'platform_analytics_usage',
        'platform_analytics_daily',
        'platform_analytics_meta',
        'platform_analytics_jobs',
        'platform_analytics_providers',
      ]) {
        await assertFails(getDoc(doc(client, collection, 'private')));
        await assertFails(setDoc(doc(client, collection, 'private'), { forged: true }));
      }
    }
  } finally {
    await env.cleanup();
  }
});
