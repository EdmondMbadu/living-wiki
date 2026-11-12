import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../functions/package.json', import.meta.url));
process.env.GCLOUD_PROJECT = 'demo-living-wiki';
const { db } = require('./lib/firebase');
const { loadTalkingCardAtlas, getTalkingCardAvatar } = require('./lib/talking-card-access');
const boardId = 'talking-access-board';
const atlasId = 'talking-private-avatar';
const cardId = 'talking-card';
const target = { boardId, cardId };
const card = { id: cardId, conversation: { provider: 'atlas', atlasId } };
const board = { owner_user_id: 'talking-owner', visibility: 'public', cards: [card] };
before(async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'Use the emulator, never production.');
  await db.collection('atlases').doc(atlasId).set({
    user_id: 'talking-owner', is_public: false, name: 'Private guide', wiki_type: 'person',
    persona_prompt: 'Private prompt', admin_user_ids: ['talking-admin'],
    chat_guide: { name: 'Private guide', image_url: '' },
  });
});
after(async () => {
  await db.collection('atlases').doc(atlasId).delete();
  await db.collection('boards').doc(boardId).delete();
});
for (const visibility of ['public', 'unlisted', 'private']) {
  test(`private avatar remains private and conversation access follows the ${visibility} board`, async () => {
    await db.collection('boards').doc(boardId).set({ ...board, visibility });
    for (const uid of [null, 'visitor']) {
      if (visibility === 'private') {
        await assert.rejects(loadTalkingCardAtlas(atlasId, uid, target), { code: 'permission-denied' });
      } else {
        const result = await loadTalkingCardAtlas(atlasId, uid, target);
        assert.equal(result.id, atlasId);
        assert.equal(result.is_public, false);
        const response = await getTalkingCardAvatar.run({ data: { atlasId, ...target }, auth: uid ? { uid } : undefined });
        assert.equal(response.atlas.name, 'Private guide');
        for (const key of ['persona_prompt', 'admin_user_ids', 'user_id']) assert.equal(key in response.atlas, false);
      }
    }
    assert.equal((await loadTalkingCardAtlas(atlasId, 'talking-owner', target)).is_public, false);
    assert.equal((await db.collection('atlases').doc(atlasId).get()).data().is_public, false);
  });
}
for (const [label, data, selectedTarget] of [
  ['foreign board owner', { ...board, owner_user_id: 'other-owner' }, target],
  ['hidden card', { ...board, cards: [{ ...card, authorOnly: true }] }, target],
  ['hidden by tag', { ...board, cards: [{ ...card, tags: ['author-only'] }] }, target],
  ['missing card', { ...board, cards: [] }, target],
  ['wrong avatar', { ...board, cards: [{ ...card, conversation: { provider: 'atlas', atlasId: 'other' } }] }, target],
  ['forged card id', board, { ...target, cardId: 'other-card' }],
  ['no board context', board, {}],
  ['missing board', board, { ...target, boardId: 'absent-board' }],
  ['team board', { ...board, team_id: 'private-team' }, target],
  ['hidden parent', { ...board, cards: [{ id: 'parent', authorOnly: true, relatedCards: [card] }] }, target],
]) {
  test(`visitor cannot access a private avatar with ${label}`, async () => {
    await db.collection('boards').doc(boardId).set(data);
    await assert.rejects(loadTalkingCardAtlas(atlasId, 'visitor', selectedTarget), { code: 'permission-denied' });
  });
}
test('a visible nested Talking Card grants access and removing it revokes access', async () => {
  await db.collection('boards').doc(boardId).set({ ...board, cards: [{ id: 'parent', relatedCards: [card] }] });
  await loadTalkingCardAtlas(atlasId, null, target);
  await db.collection('boards').doc(boardId).update({ cards: [] });
  await assert.rejects(loadTalkingCardAtlas(atlasId, null, target), { code: 'permission-denied' });
});

test('typed conversation uses the verified private-avatar owner and rejects forged board context', async () => {
  const pipeline = require('./lib/pipeline');
  const originalQuery = pipeline.runPublicAtlasQuery;
  let captured;
  pipeline.runPublicAtlasQuery = async (options) => { captured = options; return { answer: 'Fixture answer' }; };
  try {
    const { askPublicAtlas } = require('./lib/index');
    await db.collection('boards').doc(boardId).set(board);
    const request = { data: { atlasId, ...target, question: 'What can I learn?', anonymousVisitorId: 'visitor_fixture_12345678' } };
    const response = await askPublicAtlas.run(request);
    assert.equal(response.answer, 'Fixture answer');
    assert.equal(captured.atlasOwnerUserId, 'talking-owner');
    await assert.rejects(askPublicAtlas.run({ data: { ...request.data, cardId: 'forged' } }), { code: 'permission-denied' });
    await db.collection('boards').doc(boardId).update({ visibility: 'private' });
    await assert.rejects(askPublicAtlas.run(request), { code: 'permission-denied' });
  } finally { pipeline.runPublicAtlasQuery = originalQuery; }
});

test('voice sessions follow board access without publishing the avatar or calling a live provider', async () => {
  const originalFetch = globalThis.fetch;
  const keys = ['ELEVENLABS_API_KEY', 'ELEVENLABS_AGENT_ID'];
  const previous = keys.map(key => process.env[key]);
  process.env.ELEVENLABS_API_KEY = 'local-fixture-key';
  process.env.ELEVENLABS_AGENT_ID = 'agent_local_fixture';
  globalThis.fetch = async () => new Response(JSON.stringify({ signed_url: 'wss://example.test/fixture', voices: [] }), { status: 200 });
  try {
    const { createElevenLabsVoiceSession } = require('./lib/index');
    await db.collection('boards').doc(boardId).set(board);
    const request = { data: { atlasId, ...target, experience: 'talking-card', anonymousVisitorId: 'visitor_fixture_12345678', connectionType: 'websocket' } };
    const session = await createElevenLabsVoiceSession.run(request);
    assert.equal(session.signedUrl, 'wss://example.test/fixture');
    assert.equal(session.dynamicVariables.board_id, boardId);
    assert.equal(session.dynamicVariables.card_id, cardId);
    await assert.rejects(createElevenLabsVoiceSession.run({ data: { ...request.data, cardId: 'forged' } }), { code: 'permission-denied' });
    await db.collection('boards').doc(boardId).update({ visibility: 'private' });
    await assert.rejects(createElevenLabsVoiceSession.run(request), { code: 'permission-denied' });
    assert.equal((await db.collection('atlases').doc(atlasId).get()).data().is_public, false);
  } finally {
    globalThis.fetch = originalFetch;
    keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
  }
});

test('sponsor speech uses server-approved text and rechecks board/card access before using cached audio', async () => {
  const { storage } = require('./lib/firebase');
  const originalBucket = storage.bucket, originalFetch = globalThis.fetch;
  const previousKey = process.env.ELEVENLABS_API_KEY;
  process.env.ELEVENLABS_API_KEY = 'local-fixture-key';
  const file = { exists: async () => [true], getMetadata: async () => [{ metadata: { firebaseStorageDownloadTokens: 'fixture-token' } }] };
  storage.bucket = () => ({ name: 'demo-living-wiki', file: () => file });
  globalThis.fetch = async () => { throw new Error('No live provider calls are allowed in this test.'); };
  const sponsor = { name: 'William Penn Foundation', message: 'Our conversation today has been generously supported by a grant from the William Penn Foundation of Philadelphia.' };
  try {
    const { synthesizeChatAnswerSpeech } = require('./lib/index');
    await db.collection('boards').doc(boardId).set({ ...board, sponsorship: sponsor });
    const data = { mode: 'sponsorship', atlasId, ...target, anonymousVisitorId: 'visitor_fixture_12345678', expectedMessage: sponsor.message, text: 'Injected visitor text must never be spoken.' };
    const result = await synthesizeChatAnswerSpeech.run({ data });
    assert.equal(result.speechText, sponsor.message); assert.equal(result.cached, true);
    assert.ok(result.audioUrl.startsWith('https://firebasestorage.googleapis.com/'));
    await assert.rejects(synthesizeChatAnswerSpeech.run({ data: { ...data, expectedMessage: 'Stale message' } }), { code: 'failed-precondition' });
    await assert.rejects(synthesizeChatAnswerSpeech.run({ data: { ...data, cardId: 'forged' } }));
    await db.collection('boards').doc(boardId).update({ visibility: 'private' });
    await assert.rejects(synthesizeChatAnswerSpeech.run({ data }), { code: 'permission-denied' });
    await db.collection('boards').doc(boardId).set({ ...board, sponsorship: sponsor, cards: [{ ...card, conversation: { ...card.conversation, sponsorship: { mode: 'off' } } }] });
    await assert.rejects(synthesizeChatAnswerSpeech.run({ data }), { code: 'failed-precondition' });
    await assert.rejects(synthesizeChatAnswerSpeech.run({ data: { ...data, preview: true, sponsor } }), { code: 'permission-denied' });
    await db.collection('boards').doc(boardId).set({ ...board, sponsorship: sponsor, cards: [{ id: 'parent', relatedCards: [card] }] });
    assert.equal((await synthesizeChatAnswerSpeech.run({ data })).speechText, sponsor.message);
    await db.collection('boards').doc(boardId).update({ cards: [{ id: 'parent', authorOnly: true, relatedCards: [card] }] });
    await assert.rejects(synthesizeChatAnswerSpeech.run({ data }));
  } finally {
    storage.bucket = originalBucket; globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.ELEVENLABS_API_KEY; else process.env.ELEVENLABS_API_KEY = previousKey;
  }
});

test('recap email includes the saved acknowledgement exactly once even when the AI summary omits it', async () => {
  const gemini = require('./lib/gemini');
  const mail = require('@sendgrid/mail');
  const originalRecap = gemini.generateVoiceConversationRecap, originalLocations = gemini.extractMappableLocations, originalSend = mail.send;
  const previousKey = process.env.SENDGRID_API_KEY;
  process.env.SENDGRID_API_KEY = 'SG.local.fixture';
  const sponsor = { name: 'William Penn Foundation', message: 'Approved sponsor acknowledgement <literal> & exact wording.' };
  let sent;
  gemini.generateVoiceConversationRecap = async () => ({ title: 'Our conversation', summary: 'An educational conversation.', key_questions: [], useful_takeaways: [], contextual_answer: 'A useful answer.', suggested_places: [] });
  gemini.extractMappableLocations = async () => [];
  mail.send = async message => { sent = message; return [{ statusCode: 202, headers: { 'x-message-id': 'local-fixture' } }]; };
  try {
    const { sendVoiceConversationSummary } = require('./lib/index');
    const { beginCardText, finishCardText, getCardConversation } = require('./lib/card-analytics');
    await db.collection('boards').doc(boardId).set({ ...board, sponsorship: sponsor });
    const sessionId = 'talking-recap-test-session';
    const conversation = await beginCardText({ data: { ...target, question: 'What can I learn about history?',
      anonymousVisitorId: 'visitor_fixture_12345678', analyticsVisitorId: 'recap-test-browser',
      analyticsSessionId: sessionId, analyticsRequestId: 'recap-test-question' } }, { id: atlasId, user_id: 'talking-owner' });
    await finishCardText(conversation, { answer: 'You can explore the record and ask questions about it.' });
    const result = await sendVoiceConversationSummary.run({ data: { atlasId, ...target, source: 'talking_card', anonymousVisitorId: 'visitor_fixture_12345678', recipientEmail: 'visitor@example.test', createAnswerCard: false,
      textSessions: [sessionId], shareRecapEmailWithAnalytics: true,
      sponsorship: { name: 'Forged', message: 'FORGED SPONSOR' }, transcript: [{ role: 'user', text: 'What can I learn about history?' }, { role: 'agent', text: 'You can explore the record and ask questions about it.' }] } });
    assert.equal(result.sent, true);
    assert.equal(sent.text.split(sponsor.message).length - 1, 1);
    assert.ok(sent.html.includes('Approved sponsor acknowledgement &lt;literal&gt; &amp; exact wording.'));
    assert.ok(!sent.html.includes('FORGED SPONSOR')); assert.ok(!sent.text.includes('FORGED SPONSOR'));
    const detail = await getCardConversation.run({ data: { ...target, conversationId: conversation.ref.id }, auth: { uid: 'talking-owner' } });
    assert.deepEqual(detail.conversation.participant, { recapEmail: 'visitor@example.test' });
    await db.recursiveDelete(conversation.ref);
    const summaries = await db.collection('voice_conversation_summaries').where('board_id', '==', boardId).get();
    for (const doc of summaries.docs) { assert.deepEqual(doc.data().sponsorship, sponsor); await doc.ref.delete(); }
  } finally {
    gemini.generateVoiceConversationRecap = originalRecap; gemini.extractMappableLocations = originalLocations; mail.send = originalSend;
    if (previousKey === undefined) delete process.env.SENDGRID_API_KEY; else process.env.SENDGRID_API_KEY = previousKey;
  }
});
