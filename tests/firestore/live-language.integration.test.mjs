import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

process.env.GCLOUD_PROJECT = 'demo-living-wiki';
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'demo-living-wiki', storageBucket: 'demo-living-wiki.appspot.com' });
const require = createRequire(new URL('../../functions/package.json', import.meta.url));
const { db } = require('./lib/firebase');
const gemini = require('./lib/board-translation-provider');
const { translateLiveCard } = require('./lib/translate-live-card');
const { translateBoard } = require('./lib/index');
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

for (const language of ['en', 'fr', 'ja', 'pt', 'es', 'de', 'zh', 'it', 'ko', 'ar', 'hi', 'ru']) {
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

for (const kind of ['Live', 'Board']) {
  const translate = () => kind === 'Live' ? call({targetLanguage: 'en'}) : translateBoard.run({
    data: {boardId, targetLanguage: 'en'}, rawRequest: {ip: '127.0.0.1', headers: {}} });
  test(`${kind}: English original bypasses provider, quota and stale English paraphrases`, async () => {
    const value = board();
    value.description = 'This is the story of our city and the people who lived here.';
    await db.doc(`boards/${boardId}`).set(value);
    const source = kind === 'Live' ? liveCardTranslationSource(value, 'one') : extractBoardTranslationSource(value);
    const collection = kind === 'Live' ? 'board_card_translations' : 'board_translations';
    const cacheId = kind === 'Live' ? liveCardTranslationCacheId(boardId, 'en', 'one')
      : createHash('sha256').update(`${boardId}:en`).digest('hex');
    await db.collection(collection).doc(cacheId).set({status: 'ready', fingerprint: source.fingerprint, changed: true,
      segments: source.segments.map((segment) => ({...segment, text: `Unwanted rewrite: ${segment.text}`}))});
    const result = await translate();
    assert.equal(result.changed, false);
    assert.deepEqual(result.segments, source.segments);
    assert.equal(calls.length, 0);
    assert.equal((await db.collection('live_translation_limits').get()).size, 0);
    assert.equal((await db.collection('board_translation_limits').get()).size, 0);
    if (kind === 'Live') {
      const translated = await liveNarrationBoard(value, 'one', async (id) =>
        (await db.collection(collection).doc(liveCardTranslationCacheId(boardId, 'en', id)).get()).data());
      assert.equal(translated.cards[0].notes, value.cards[0].notes);
    }
    await db.doc(`boards/${boardId}`).update({visibility: 'private'});
    await assert.rejects(translate(), (error) => error.code === 'permission-denied');
  });
  test(`${kind}: foreign content still translates into English`, async () => {
    const value = board();
    value.description = 'Une promenade dans la ville avec les lieux et des histoires locales.';
    await db.doc(`boards/${boardId}`).set(value);
    const result = await translate();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].language, 'en');
    assert.equal(result.changed, true);
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

test('board translation streams validated partial text before completion and shares progress with another visitor', async () => {
  const request = {data:{boardId,targetLanguage:'fr'}, acceptsStreaming:true, rawRequest:{ip:'127.0.0.1',headers:{}}};
  let release; let firstReady;
  const ready = new Promise(resolve=>{firstReady=resolve;});
  gemini.translateBoardTextSegments = async (segments, language, onBatch) => {
    calls.push({segments,language});
    const translated=segments.map(segment=>({...segment,text:`fr: ${segment.text}`}));
    await onBatch(translated.slice(0,1)); firstReady();
    await new Promise(resolve=>{release=resolve;});
    await onBatch(translated.slice(1)); return translated;
  };
  const chunks=[];
  const response = {signal:new AbortController().signal,sendChunk:async chunk=>{chunks.push(chunk);return true;}};
  const first=translateBoard.run(request,response); await ready;
  assert.equal(chunks.at(-1).segments.length,1);
  assert.ok(chunks.at(-1).totalSegmentCount>1);
  let followerReady;
  const followerReceived=new Promise(resolve=>{followerReady=resolve;});
  const second=translateBoard.run(request,{...response,sendChunk:async chunk=>{if(chunk.segments.length===1) followerReady();return true;}});
  await followerReceived;
  assert.equal(calls.length,1);
  release(); const results=await Promise.all([first,second]);
  assert.equal(results[0].segments.length,results[0].expectedSegmentCount);
  assert.equal(results[1].cached,true);
  assert.deepEqual(chunks.at(-1).segments,results[0].segments);
});

test('board translation releases its lease when visitor quota is exhausted', async () => {
  const quota=db.collection('board_translation_limits').doc(createHash('sha256').update(':').digest('hex'));
  await quota.set({window_started_at_ms:Date.now(),count:10});
  const request={data:{boardId,targetLanguage:'fr'},rawRequest:{headers:{}}};
  await assert.rejects(translateBoard.run(request),error=>error.code==='resource-exhausted');
  const cache=await db.collection('board_translations').doc(createHash('sha256').update(`${boardId}:fr`).digest('hex')).get();
  assert.equal(cache.data().status,'error');
  assert.equal(cache.data().lease_token,undefined);
  assert.equal(calls.length,0);
});
