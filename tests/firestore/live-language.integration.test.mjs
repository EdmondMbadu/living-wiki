import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

process.env.GCLOUD_PROJECT = 'demo-living-wiki';
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'demo-living-wiki', storageBucket: 'demo-living-wiki.appspot.com' });
const require = createRequire(new URL('../../functions/package.json', import.meta.url));
const { db } = require('./lib/firebase');
const gemini = require('./lib/gemini');
const { translateLiveCard } = require('./lib/translate-live-card');
const { liveCardTranslationSource, liveCardTranslationCacheId, readyLiveCardTranslation, applyLiveCardTranslation, liveNarrationBoard } = require('./lib/live-card-translation');
const { extractBoardTranslationSource } = require('./lib/board-translation');
let calls;
const boardId = 'live-board-test';
const board = () => ({ owner_user_id: 'owner', visibility: 'public', title: 'Museum', description: 'A collection',
  cards: [{ id: 'one', title: 'First', notes: 'First card narration.' }, { id: 'two', title: 'Second', notes: 'Second card narration.' },
    { id: 'hidden', title: 'Private draft', notes: 'Secret', authorOnly: true }],
  learningQuiz: { questions: [{ prompt: 'Unrelated quiz text' }] } });
const call = (data = {}, uid = null) => translateLiveCard.run({ data: { boardId, cardId: 'one', targetLanguage: 'fr', ...data },
  ...(uid ? { auth: { uid, token: {} } } : {}), rawRequest: { ip: '127.0.0.1', headers: { 'user-agent': 'Live language tests' } } });

before(() => assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'Live language tests require the Firestore emulator.'));
beforeEach(async () => {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-living-wiki/databases/(default)/documents`, { method: 'DELETE' });
  await db.doc(`boards/${boardId}`).set(board());
  calls = [];
  gemini.translateBoardTextSegments = async (segments, language) => {
    calls.push({ segments, language });
    return segments.map((segment) => ({ ...segment, text: `${language}: ${segment.text}` }));
  };
});
after(async () => { await db.terminate(); });

test('Live source excludes other cards and quizzes, and survives unrelated edits and reordering', () => {
  const value = board(); const source = liveCardTranslationSource(value, 'one');
  assert.ok(source.segments.some((segment) => segment.key === 'cardsById.one.notes'));
  assert.ok(source.segments.every((segment) => !segment.key.includes('two') && !segment.key.includes('learningQuiz')));
  const changed = structuredClone(value); changed.cards[1].notes = 'Changed'; changed.cards.reverse();
  assert.equal(liveCardTranslationSource(changed, 'one').fingerprint, source.fingerprint);
  changed.cards.find((card) => card.id === 'one').notes = 'Updated first card';
  assert.notEqual(liveCardTranslationSource(changed, 'one').fingerprint, source.fingerprint);
  assert.throws(() => liveCardTranslationSource(value, 'hidden'));
  const cache = { status: 'ready', fingerprint: source.fingerprint, segments: source.segments };
  assert.equal(readyLiveCardTranslation(cache, source), true);
  assert.equal(readyLiveCardTranslation({ ...cache, segments: source.segments.slice(1) }, source), false);
  assert.equal(readyLiveCardTranslation({ ...cache, fingerprint: 'stale' }, source), false);
  const translated = applyLiveCardTranslation(value, [{ key: 'cardsById.one.notes', text: 'Bonjour' }]);
  assert.equal(translated.cards[0].notes, 'Bonjour');
  assert.equal(value.cards[0].notes, 'First card narration.');
});

for (const language of ['en', 'fr', 'ja', 'pt', 'es', 'de', 'zh']) {
  test(`generates and caches ${language} for the selected card, independently of other cards`, async () => {
    const first = await call({ targetLanguage: language, text: 'Never trust client supplied text' });
    assert.equal(first.cardId, 'one'); assert.equal(first.targetLanguage, language); assert.equal(first.cached, false);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].segments.every((segment) => !segment.key.startsWith('cardsById.two') && !segment.text.includes('Never trust')));
    const second = await call({ targetLanguage: language });
    assert.equal(second.cached, true); assert.equal(calls.length, 1);
    const cache = (await db.collection('board_card_translations').doc(liveCardTranslationCacheId(boardId, language, 'one')).get()).data();
    assert.equal(readyLiveCardTranslation(cache, liveCardTranslationSource(board(), 'one')), true);
  });
}

test('ready card caches still enforce visibility and exclude hidden or missing cards', async () => {
  await call();
  await db.doc(`boards/${boardId}`).update({ visibility: 'private' });
  await assert.rejects(call(), (error) => error.code === 'permission-denied');
  await assert.rejects(call({}, 'other'), (error) => error.code === 'permission-denied');
  assert.equal((await call({}, 'owner')).cached, true);
  await assert.rejects(call({ cardId: 'hidden' }, 'owner'), (error) => error.code === 'not-found');
  await assert.rejects(call({ cardId: 'missing' }, 'owner'), (error) => error.code === 'not-found');
});

test('large boards translate individual cards and edited cards invalidate their own cache', async () => {
  const value = board(); value.cards.push(...Array.from({ length: 80 }, (_, index) => ({ id: `large-${index}`, notes: 'x'.repeat(8000) })));
  await db.doc(`boards/${boardId}`).set(value);
  assert.throws(() => extractBoardTranslationSource(value), /too much text/);
  await call(); assert.equal(calls.length, 1);
  value.cards[1].notes = 'Changed second'; await db.doc(`boards/${boardId}`).set(value);
  assert.equal((await call()).cached, true); assert.equal(calls.length, 1);
  value.cards[0].notes = 'Changed first'; await db.doc(`boards/${boardId}`).set(value);
  assert.equal((await call()).cached, false); assert.equal(calls.length, 2);
});

test('an anonymous visitor never gains owner access to a legacy private board without an owner field', async () => {
  const value = board(); delete value.owner_user_id; value.visibility = 'private';
  await db.doc(`boards/${boardId}`).set(value);
  await assert.rejects(call(), (error) => error.code === 'permission-denied');
  assert.equal(calls.length, 0);
});

test('reuses a complete existing board translation without provider work', async () => {
  const source = extractBoardTranslationSource(board());
  await db.collection('board_translations').doc(createHash('sha256').update(`${boardId}:fr`).digest('hex')).set({
    status: 'ready', fingerprint: source.fingerprint, segments: source.segments.map((segment) => ({ ...segment, text: `fr: ${segment.text}` })),
  });
  const response = await call(); assert.equal(response.cached, true); assert.equal(calls.length, 0);
});

test('a failed provider releases its lease so retry works', async () => {
  gemini.translateBoardTextSegments = async () => { throw new Error('Provider billing unavailable'); };
  await assert.rejects(call(), (error) => error.code === 'unavailable');
  const ref = db.collection('board_card_translations').doc(liveCardTranslationCacheId(boardId, 'fr', 'one'));
  assert.equal((await ref.get()).data().status, 'error');
  assert.equal((await ref.get()).data().lease_token, undefined);
  gemini.translateBoardTextSegments = async (segments) => segments;
  assert.equal((await call()).cardId, 'one');
});

test('concurrent visitors share one in-flight provider request', async () => {
  let finish; let started;
  const ready = new Promise((resolve) => { started = resolve; });
  gemini.translateBoardTextSegments = async (segments) => { calls.push(segments); started(); return new Promise((resolve) => { finish = () => resolve(segments); }); };
  const first = call(); await ready;
  const second = call(); finish();
  const results = await Promise.all([first, second]);
  assert.equal(calls.length, 1); assert.equal(results.filter((result) => result.cached).length, 1);
});

test('narration authorization rebuilds both translated tour stops and rejects stale or hidden current-card caches', async () => {
  const value = board(); value.kind = 'walking-tour';
  value.cards[0].tour = { sequence: 1, guideScript: 'First guide', legToNext: { toCardId: 'two' } };
  value.cards[1].tour = { sequence: 2, guideScript: 'Second guide' };
  await db.doc(`boards/${boardId}`).set(value);
  await call(); await call({ cardId: 'two' });
  const read = async (id) => (await db.collection('board_card_translations').doc(liveCardTranslationCacheId(boardId, 'fr', id)).get()).data();
  const translated = await liveNarrationBoard(value, 'one', read);
  assert.equal(translated.cards[0].tour.guideScript, 'fr: First guide');
  assert.equal(translated.cards[1].title, 'fr: Second');
  assert.equal(value.cards[0].tour.guideScript, 'First guide');
  value.cards[0].notes = 'Edited card';
  assert.equal(await liveNarrationBoard(value, 'one', read), null);
  assert.equal(await liveNarrationBoard(value, 'hidden', read), null);
});
