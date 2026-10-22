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
const { authorizeAvatarQa, avatarQaCommand, processAvatarQaCase, prepareAvatarStressRun } = require('./lib/avatar-qa');
const stress = require('./lib/avatar-stress-test');
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
  await db.recursiveDelete(db.collection('avatar_qa_workspaces').doc(context.key));
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
      await assertFails(getDoc(doc(client, 'avatar_qa_workspaces', 'forged', 'questions', 'forged')));
      await assertFails(setDoc(doc(client, 'avatar_qa_workspaces', 'forged', 'questions', 'forged'), { answer: 'Forged answer', assessment: { status: 'passed' } }));
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

test('generated stress tests are capped, durable and idempotent, with fresh visitor history and no answer key', async () => {
  for (const count of [0, 51, 1.5, '25']) await assert.rejects(command('startStress', { requestId: 'invalid-count', count }), { code: 'invalid-argument' });
  const generator = stress.generateStressQuestions, assessor = stress.assessStressAnswer, query = pipeline.runPublicAtlasQuery;
  let generated = 0, assessed = 0;
  const categories = [...stress.STRESS_CATEGORIES];
  stress.generateStressQuestions = async (context, count, boundaries) => {
    generated++; assert.equal(count, 5); assert.equal(boundaries, 'Never promise refunds.');
    assert.equal(context.avatar.name, 'QA guide');
    return categories.map((category, index) => ({ id: `Q-00${index + 1}`, category, question: `Stress question ${index + 1}?`, expectedBehavior: 'Respect the relevant boundary.' }));
  };
  pipeline.runPublicAtlasQuery = async options => { assert.deepEqual(options.qaSandbox.history, []); return query(options); };
  stress.assessStressAnswer = async input => {
    assessed++; assert.equal(input.answer, 'Reviewed response.'); assert.equal(input.boundaries, 'Never promise refunds.');
    return { status: assessed === 1 ? 'failed' : 'passed', severity: assessed === 1 ? 'review' : 'none', title: assessed === 1 ? 'Needs closer review' : 'Handled appropriately', reason: 'Assessment of observed behavior.', critical: false };
  };
  try {
    const { runId } = await command('startStress', { requestId: 'stress-once', count: 5, boundaries: 'Never promise refunds.' });
    assert.equal((await command('startStress', { requestId: 'stress-once', count: 5, boundaries: 'Never promise refunds.' })).runId, runId);
    await assert.rejects(command('startStress', { requestId: 'stress-once', count: 10 }), { code: 'aborted' });
    await assert.rejects(command('startStress', { requestId: 'stress-overlap', count: 5 }), { code: 'already-exists' });
    let state = await command('load', { runId }); assert.equal(state.selectedRun.status, 'generating');
    await assert.rejects(command('report', { runId }), { code: 'failed-precondition' });
    await Promise.all([prepareAvatarStressRun(runId), prepareAvatarStressRun(runId)]); assert.equal(generated, 1);
    state = await command('load', { runId }); assert.equal(state.selectedRun.references.length, 5);
    for (const question of state.selectedRun.references) await processAvatarQaCase(runId, question.id);
    state = await command('load', { runId });
    assert.equal(state.selectedRun.status, 'completed'); assert.equal(state.selectedRun.passed, 4); assert.equal(state.selectedRun.failed, 1);
    assert.equal(stress.stressScore(state.selectedRun), 80); assert.equal(state.selectedRun.stale, false);
    const evidence = await command('export', { runId }); assert.match(evidence.limitation, /Automated assessment/);
    const calls = assessed; await processAvatarQaCase(runId, 'Q-001'); assert.equal(assessed, calls);
  } finally { stress.generateStressQuestions = generator; stress.assessStressAnswer = assessor; pipeline.runPublicAtlasQuery = query; }
});

test('stress evaluator failure retains the delivered response and cannot count as a pass', async () => {
  const generator = stress.generateStressQuestions, assessor = stress.assessStressAnswer;
  stress.generateStressQuestions = async () => [{ id: 'Q-001', category: 'privacy', question: 'Privacy test?', expectedBehavior: 'Protect private data.' }];
  stress.assessStressAnswer = async () => { throw new Error('Evaluator unavailable'); };
  try {
    const { runId } = await command('startStress', { requestId: 'stress-assessment-error', count: 1 });
    await prepareAvatarStressRun(runId); await processAvatarQaCase(runId, 'Q-001');
    const state = await command('load', { runId });
    assert.equal(state.selectedRun.errors, 1); assert.equal(state.selectedRun.passed, 0);
    assert.equal(state.selectedRun.results[0].turns[0].actualAnswer, 'Reviewed response.');
    assert.equal(stress.stressScore(state.selectedRun), null);
  } finally { stress.generateStressQuestions = generator; stress.assessStressAnswer = assessor; }
});

test('generation failures and cancellation free the active run without fabricated results', async () => {
  const generator = stress.generateStressQuestions;
  stress.generateStressQuestions = async () => { throw new Error('Generation unavailable'); };
  try {
    const { runId } = await command('startStress', { requestId: 'stress-generation-error', count: 10 });
    await prepareAvatarStressRun(runId);
    let state = await command('load', { runId });
    assert.equal(state.selectedRun.status, 'error'); assert.equal(state.selectedRun.completed, 0); assert.equal(stress.stressScore(state.selectedRun), null);
    const cancelled = await command('startStress', { requestId: 'stress-generation-cancel', count: 10 });
    await command('cancel', { runId: cancelled.runId }); await prepareAvatarStressRun(cancelled.runId);
    state = await command('load', { runId: cancelled.runId }); assert.equal(state.selectedRun.status, 'cancelled');
    assert.equal(state.selectedRun.results.length, 0);
  } finally { stress.generateStressQuestions = generator; }
});

test('direct answers arrive separately from assessment, are idempotent and remain private to their requester', async () => {
  const assessor = stress.assessStressAnswer; let assessments = 0;
  stress.assessStressAnswer = async () => { assessments++; return { status: 'passed', severity: 'none', critical: false, title: 'Handled appropriately', reason: 'The answer respected the relevant boundaries.' }; };
  try {
    const beforeCalls = callCount;
    const answer = await command('ask', { requestId: 'direct-once', question: 'A direct question?' });
    assert.equal(answer.answer, 'Reviewed response.'); assert.equal(answer.assessment, null); assert.equal(assessments, 0);
    const again = await command('ask', { requestId: 'direct-once', question: 'A direct question?' });
    assert.equal(again.id, answer.id); assert.equal(callCount - beforeCalls, 1);
    await assert.rejects(command('assessQuestion', { questionId: answer.id }, 'qa-admin'), { code: 'not-found' });
    const result = await command('assessQuestion', { questionId: answer.id }); assert.equal(result.assessment.status, 'passed');
    await command('assessQuestion', { questionId: answer.id }); assert.equal(assessments, 1);
    await assert.rejects(command('ask', { requestId: 'direct-invalid', question: 'x'.repeat(1001) }), { code: 'invalid-argument' });
  } finally { stress.assessStressAnswer = assessor; }
});

test('direct assessment errors preserve the visitor answer without a passing label', async () => {
  const assessor = stress.assessStressAnswer;
  stress.assessStressAnswer = async () => { throw new Error('Evaluator timeout'); };
  try {
    const answer = await command('ask', { requestId: 'direct-error', question: 'Another direct question?' });
    const result = await command('assessQuestion', { questionId: answer.id });
    assert.equal(result.answer, 'Reviewed response.'); assert.equal(result.assessment, null); assert.match(result.assessmentError, /could not be completed/);
  } finally { stress.assessStressAnswer = assessor; }
});

test('a maximum-sized stress test completes all 50 distinct questions with correct totals', async () => {
  const generator = stress.generateStressQuestions, assessor = stress.assessStressAnswer;
  stress.generateStressQuestions = async (_context, count) => {
    assert.equal(count, 50);
    return Array.from({ length: count }, (_, index) => ({ id: `Q-${String(index + 1).padStart(3, '0')}`, category: stress.STRESS_CATEGORIES[index % 5], question: `Maximum test question ${index + 1}?`, expectedBehavior: 'Handle appropriately.' }));
  };
  stress.assessStressAnswer = async () => ({ status: 'passed', severity: 'none', critical: false, title: 'Handled appropriately', reason: 'Stayed within the boundaries.' });
  try {
    const { runId } = await command('startStress', { requestId: 'stress-maximum', count: 50 });
    await prepareAvatarStressRun(runId);
    const initial = await command('load', { runId });
    assert.equal(initial.selectedRun.references.length, 50);
    // Exercise concurrent workers and transactional counters, in bounded batches.
    for (let index = 0; index < 50; index += 5) await Promise.all(initial.selectedRun.references.slice(index, index + 5).map(question => processAvatarQaCase(runId, question.id)));
    const state = await command('load', { runId });
    assert.equal(state.selectedRun.completed, 50); assert.equal(state.selectedRun.passed, 50);
    assert.equal(state.selectedRun.results.length, 50); assert.equal(stress.stressScore(state.selectedRun), 100);
    await assert.rejects(command('startStress', { requestId: 'stress-over-quota', count: 1 }), { code: 'resource-exhausted' });
  } finally { stress.generateStressQuestions = generator; stress.assessStressAnswer = assessor; }
});
