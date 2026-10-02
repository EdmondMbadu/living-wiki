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
