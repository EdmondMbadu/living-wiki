import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { before, after, test } from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../functions/package.json', import.meta.url));
process.env.GCLOUD_PROJECT = 'demo-living-wiki';
const { db, storage } = require('./lib/firebase');
const pipeline = require('./lib/pipeline');
const gemini = require('./lib/gemini');
const { authorizeAvatarQa, avatarQaCommand, processAvatarQaCase } = require('./lib/avatar-qa');
const boardId = 'qa-test-board', cardId = 'qa-card', atlasId = 'qa-test-atlas';
const owner = 'qa-owner';
const target = { boardId, cardId };
const answer = { id: 'AMD-001', question: 'A test question?', expectedAnswer: 'Reviewed response.', category: 'education', source: 'Answer key v1', approval: 'draft', followUps: [] };
const originalBucket = storage.bucket;
const originalQuery = pipeline.runPublicAtlasQuery;
const blobs = new Map();
const command = (action, options = {}, uid = owner) => avatarQaCommand.run({ data: { ...target, action, ...options }, auth: uid ? { uid } : undefined });
let callCount = 0;
before(async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'Never run this test against production.');
  storage.bucket = () => ({ file: path => ({
    save: async content => { if (blobs.has(path)) throw Object.assign(new Error('exists'), { code: 412 }); blobs.set(path, content); },
    download: async () => [Buffer.from(blobs.get(path))],
  }) });
  await db.collection('avatar_qa_quotas').doc(createHash('sha256').update(JSON.stringify([owner, new Date().toISOString().slice(0,10)])).digest('hex')).delete();
  await db.collection('atlases').doc(atlasId).set({ name: 'QA guide', user_id: owner, persona_prompt: 'Reference-only educational guide.', admin_user_ids: ['qa-admin'] });
  await db.collection('boards').doc(boardId).set({ owner_user_id: owner, title: 'QA board', visibility: 'public', cards: [{ id: cardId, title: 'QA guide', tags: [], conversation: { provider: 'atlas', atlasId, openingMessage: 'Hello.' } }] });
  pipeline.runPublicAtlasQuery = async options => {
    callCount++;
    assert.equal(options.atlasId, atlasId);
    assert.equal(options.atlasOwnerUserId, owner);
    assert.ok(options.qaSandbox);
    assert.equal('expectedAnswer' in options, false);
    options.qaSandbox.capture({ answerMode: 'wiki' });
    return { answer: options.question === 'Fail?' ? 'Wrong wording.' : 'Reviewed response.', citedPassages: [], citedEntryIds: [], knowledgeGap: false };
  };
});
after(async () => {
  storage.bucket = originalBucket; pipeline.runPublicAtlasQuery = originalQuery;
  const context = await authorizeAvatarQa(owner, target);
  const list = await db.collection('avatar_qa_runs').where('workspaceKey', '==', context.key).get();
  for (const run of list.docs) await db.recursiveDelete(run.ref);
  await db.collection('avatar_qa_workspaces').doc(context.key).delete();
  await db.collection('atlases').doc(atlasId).delete(); await db.collection('boards').doc(boardId).delete();
});
test('public access, forged card IDs, and board ownership alone do not grant QA access', async () => {
  for (const uid of [undefined, 'qa-visitor']) await assert.rejects(authorizeAvatarQa(uid, target));
  await assert.rejects(authorizeAvatarQa(owner, { ...target, cardId: 'forged' }), { code: 'not-found' });
  await authorizeAvatarQa('qa-admin', target);
  await db.collection('atlases').doc(atlasId).update({ user_id: 'foreign-owner' });
  await assert.rejects(authorizeAvatarQa(owner, target), { code: 'permission-denied' });
  await db.collection('atlases').doc(atlasId).update({ user_id: owner });
});
test('avatar administrators cannot use a public board to inspect author-only cards', async () => {
  const ref = db.collection('boards').doc(boardId);
  const original = (await ref.get()).data();
  try {
    await ref.update({ cards: [{ id: 'hidden-parent', authorOnly: true, relatedCards: original.cards }] });
    await assert.rejects(authorizeAvatarQa('qa-admin', target), { code: 'not-found' });
    await authorizeAvatarQa(owner, target);
  } finally { await ref.set(original); }
});
test('clients cannot read or forge QA evidence, including the avatar owner', async () => {
  const [host, rawPort] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  const environment = await initializeTestEnvironment({ projectId: 'demo-living-wiki', firestore: { host, port: Number(rawPort) } });
  try {
    for (const uid of [owner, 'qa-visitor']) {
      const client = environment.authenticatedContext(uid).firestore();
      await assertFails(getDoc(doc(client, 'avatar_qa_runs', 'forged')));
      await assertFails(setDoc(doc(client, 'avatar_qa_runs', 'forged'), { status: 'completed', passed: 100 }));
      await assertFails(setDoc(doc(client, 'avatar_qa_workspaces', 'forged'), { references: [] }));
    }
  } finally { await environment.cleanup(); }
});
test('library revisions prevent overwriting edits from another browser', async () => {
  await command('save', { revision: 0, references: [answer] });
  await assert.rejects(command('save', { revision: 0, references: [] }), { code: 'aborted' });
  const workspace = await command('load'); assert.equal(workspace.references.length, 1);
});
test('start is idempotent; duplicate worker delivery cannot duplicate provider calls or totals', async () => {
  const { runId } = await command('start', { requestId: 'run-once' });
  assert.equal((await command('start', { requestId: 'run-once' })).runId, runId);
  await assert.rejects(command('start', { requestId: 'second-active' }), { code: 'already-exists' });
  const beforeCalls = callCount;
  await Promise.all([processAvatarQaCase(runId, answer.id), processAvatarQaCase(runId, answer.id)]);
  const workspace = await command('load', { runId });
  assert.equal(callCount - beforeCalls, 1); assert.equal(workspace.selectedRun.completed, 1);
  assert.equal(workspace.selectedRun.passed, 1); assert.equal(workspace.selectedRun.status, 'completed');
  assert.equal(workspace.selectedRun.stale, false);
  const evidence = await command('export', { runId });
  assert.equal(evidence.results[0].turns[0].actualAnswer, 'Reviewed response.');
  assert.equal(evidence.configuration.atlas.persona_prompt, 'Reference-only educational guide.');
});
test('follow-ups share history, critical mismatches are preserved, and reviews are append-only', async () => {
  const state = await command('load');
  await command('save', { revision: state.revision, references: [{ ...answer, category: 'urgent', followUps: [{ question: 'Fail?', expectedAnswer: 'Reviewed response.' }] }] });
  const { runId } = await command('start', { requestId: 'run-followup' });
  await processAvatarQaCase(runId, answer.id);
  let workspace = await command('load', { runId });
  assert.equal(workspace.selectedRun.critical, 1); assert.equal(workspace.selectedRun.failed, 1);
  assert.equal(workspace.selectedRun.results[0].turns.length, 2);
  await command('review', { runId, resultId: answer.id, decision: 'disputed', note: 'Reviewer requests a closer wording assessment.' });
  await command('review', { runId, resultId: answer.id, decision: 'follow_up', note: 'Keep the case open.' });
  workspace = await command('load', { runId });
  assert.equal(workspace.selectedRun.reviews.length, 2); assert.equal(workspace.selectedRun.failed, 1);
});
test('cancellation stops new calls and finalizes pending cases', async () => {
  const { runId } = await command('start', { requestId: 'run-cancel' });
  await command('cancel', { runId });
  const beforeCalls = callCount;
  await processAvatarQaCase(runId, answer.id);
  const workspace = await command('load', { runId });
  assert.equal(callCount, beforeCalls); assert.equal(workspace.selectedRun.cancelled, 1);
  assert.equal(workspace.selectedRun.status, 'cancelled');
});
test('configuration changes make a run stale and prevent false passing evidence', async () => {
  const { runId } = await command('start', { requestId: 'run-changed' });
  await db.collection('atlases').doc(atlasId).update({ persona_prompt: 'Changed script.' });
  const beforeCalls = callCount;
  await processAvatarQaCase(runId, answer.id);
  const workspace = await command('load', { runId });
  assert.equal(callCount, beforeCalls); assert.equal(workspace.selectedRun.errors, 1);
  assert.equal(workspace.selectedRun.stale, true);
});
test('a provider error preserves earlier turns and cannot turn into a pass', async () => {
  const saved = pipeline.runPublicAtlasQuery;
  let turns = 0;
  pipeline.runPublicAtlasQuery = async options => {
    if (++turns === 2) throw new Error('Provider temporarily unavailable.');
    return saved(options);
  };
  try {
    const { runId } = await command('start', { requestId: 'run-provider-error' });
    await processAvatarQaCase(runId, answer.id);
    const state = await command('load', { runId });
    assert.equal(state.selectedRun.errors, 1); assert.equal(state.selectedRun.passed, 0);
    assert.equal(state.selectedRun.results[0].turns.length, 1);
    assert.match(state.selectedRun.results[0].error, /Provider temporarily unavailable/);
  } finally { pipeline.runPublicAtlasQuery = saved; }
});
test('sandbox uses the actual fallback path without writing visitor histories, and respects visitor limits', async () => {
  const search = gemini.answerWithGoogleSearch;
  gemini.answerWithGoogleSearch = async () => ({ answer: 'Fallback response.', cited_entry_ids: [], citations: [] });
  try {
    const counts = await Promise.all(['public_chat_threads', 'public_chat_messages'].map(name => db.collection(name).count().get().then(s => s.data().count)));
    const history = []; let mode;
    const options = { atlasId, atlasOwnerUserId: owner, question: 'No knowledge exists here', answerMode: 'wiki', visitor: { kind: 'anonymous', visitorUserId: null, anonymousVisitorId: 'qa_fixture', visitorDisplayName: null, visitorEmail: null }, qaSandbox: { history, capture: exchange => { mode = exchange.answerMode; } } };
    const response = await originalQuery(options);
    assert.equal(mode, 'internet'); assert.equal(response.answer, 'Fallback response.');
    const afterCounts = await Promise.all(['public_chat_threads', 'public_chat_messages'].map(name => db.collection(name).count().get().then(s => s.data().count)));
    assert.deepEqual(counts, afterCounts);
    history.push(...Array(5).fill({ role: 'user', text: 'Question' }));
    assert.equal((await originalQuery(options)).blocked, true);
  } finally { gemini.answerWithGoogleSearch = search; }
});
