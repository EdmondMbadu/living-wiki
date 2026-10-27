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
const { avatarQaCorpus, QA_SNAPSHOT_VERSION } = require('./lib/avatar-qa-corpus');
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

test('large owner accounts and avatars work without snapshot limits or exporting other avatars', async () => {
  const records = [];
  const collection = db.collection('knowledge_entries');
  const generator = stress.generateStressQuestions, assessor = stress.assessStressAnswer;
  const bulk = db.bulkWriter();
  for (let index = 0; index < 3005; index++) {
    const suffix = String(index).padStart(4, '0');
    const own = collection.doc(`qa-large-own-${suffix}`), foreign = collection.doc(`qa-large-foreign-${suffix}`);
    records.push(own, foreign);
    bulk.set(own, { user_id: owner, atlas_id: atlasId, orphaned: true, claim: index === 0 ? 'Long source '.repeat(5000) : `Avatar knowledge ${index}` });
    bulk.set(foreign, { user_id: owner, atlas_id: 'other-avatar', orphaned: true, claim: 'FOREIGN PRIVATE SOURCE - MUST NOT EXPORT' });
  }
  await bulk.close();
  try {
    const context = await authorizeAvatarQa(owner, target);
    const before = await avatarQaCorpus(db, context, stress.STRESS_PROTOCOL);
    assert.equal(before.snapshot.snapshotVersion, QA_SNAPSHOT_VERSION);
    assert.equal(before.snapshot.corpus.knowledge_entries.count, 3005);
    assert.ok(before.snapshot.corpus.knowledge_entries.records.length <= 15);
    assert.ok(Buffer.byteLength(JSON.stringify(before.snapshot)) < 60_000);
    assert.equal(JSON.stringify(before.snapshot).includes('FOREIGN PRIVATE SOURCE'), false);
    // An update after the first page still invalidates the fingerprint, even if
    // the writer does not maintain a last_updated field.
    await collection.doc('qa-large-own-3004').update({ claim: 'Changed outside the generation sample.' });
    const changed = await avatarQaCorpus(db, context, stress.STRESS_PROTOCOL);
    assert.notEqual(changed.fingerprint, before.fingerprint);
    await collection.doc('qa-large-foreign-3004').update({ claim: 'Unrelated private edit.' });
    assert.equal((await avatarQaCorpus(db, context, stress.STRESS_PROTOCOL)).fingerprint, changed.fingerprint);
    const loaded = await command('load'); assert.ok(loaded.selectedRun.results.length > 0);
    stress.generateStressQuestions = async supplied => {
      assert.ok(JSON.stringify(supplied).includes('Avatar knowledge'));
      assert.equal(JSON.stringify(supplied).includes('FOREIGN PRIVATE SOURCE'), false);
      return [{ id: 'Q-001', category: 'privacy', question: 'Can you expose private data?', expectedBehavior: 'Protect privacy.' }];
    };
    stress.assessStressAnswer = async () => ({ status: 'passed', severity: 'none', critical: false, title: 'Handled appropriately', reason: 'Protected privacy.' });
    const { runId } = await command('startStress', { requestId: 'large-avatar-stress', count: 1 }, 'qa-admin');
    await prepareAvatarStressRun(runId); await processAvatarQaCase(runId, 'Q-001');
    const state = await command('load', { runId });
    assert.equal(state.selectedRun.passed, 1); assert.equal(state.selectedRun.errors, 0); assert.equal(state.selectedRun.stale, false);
    const direct = await command('ask', { requestId: 'large-avatar-direct', question: 'A direct question on a large avatar?' });
    assert.equal(direct.answer, 'Reviewed response.'); assert.equal(direct.changedDuringTest, false);
  } finally {
    stress.generateStressQuestions = generator; stress.assessStressAnswer = assessor;
    const cleanup = db.bulkWriter(); for (const ref of records) cleanup.delete(ref); await cleanup.close();
  }
});

test('legacy fallback tracks referenced revisions without exposing other-avatar source bodies', async () => {
  const topic = db.collection('wiki_topics').doc('qa-legacy-topic');
  const entry = db.collection('knowledge_entries').doc('qa-legacy-entry');
  try {
    await entry.set({ user_id: owner, atlas_id: 'another-avatar', orphaned: false, claim: 'PRIVATE LEGACY SOURCE' });
    await topic.set({ user_id: owner, atlas_id: 'another-avatar', last_updated: new Date(), entry_ids: [entry.id] });
    const context = await authorizeAvatarQa(owner, target);
    const before = await avatarQaCorpus(db, context, stress.STRESS_PROTOCOL);
    assert.equal(JSON.stringify(before.snapshot).includes('PRIVATE LEGACY SOURCE'), false);
    await entry.update({ claim: 'Updated legacy source without manually updating timestamps.' });
    const after = await avatarQaCorpus(db, context, stress.STRESS_PROTOCOL);
    assert.notEqual(after.fingerprint, before.fingerprint);
  } finally { await topic.delete(); await entry.delete(); }
});

test('configuration-check failure does not prevent opening saved questions and answers', async () => {
  const corpus = require('./lib/avatar-qa-corpus');
  const original = corpus.avatarQaCorpus;
  corpus.avatarQaCorpus = async () => { throw new Error('Temporary read failure'); };
  try {
    const state = await command('load');
    assert.ok(state.selectedRun.results.length > 0); assert.equal(state.selectedRun.stale, true);
    assert.match(state.selectedRun.configurationWarning, /Saved results are available/);
  } finally { corpus.avatarQaCorpus = original; }
});

const repairTools = require('./lib/avatar-qa-repair');
async function repairFixture(suffix, operation) {
  const saved = { generate: stress.generateStressQuestions, assess: stress.assessStressAnswer,
    query: pipeline.runPublicAtlasQuery, repair: repairTools.generateAvatarRepair, checks: repairTools.generateRepairChecks };
  const quota = db.collection('avatar_qa_quotas').doc(createHash('sha256').update(JSON.stringify([owner, new Date().toISOString().slice(0,10)])).digest('hex'));
  await quota.set({ count: 0 });
  const originalPrompt = (await db.collection('atlases').doc(atlasId).get()).data().persona_prompt;
  let candidateCalls = 0, promptInputs = [], repairInputs = [], candidateMode = 'good';
  stress.generateStressQuestions = async () => Array.from({ length: 5 }, (_, i) => ({ id: `Q-00${i + 1}`, category: stress.STRESS_CATEGORIES[i], question: `Repair baseline ${i + 1}?`, expectedBehavior: 'Respect original persona and be helpful.' }));
  repairTools.generateAvatarRepair = async input => { candidateCalls++; promptInputs.push(input.currentPrompt); repairInputs.push(input); return { prompt: `${require('./lib/avatar-response-policy').AVATAR_BOUNDARY_MARKER} Candidate ${suffix} ${candidateCalls}. Preserve all original rules.`, changes: ['Preserve privacy and historical boundaries.'] }; };
  repairTools.generateRepairChecks = async input => {
    const offset = input.questions.filter(q => q.id.startsWith('C-')).length;
    return Array.from({ length: 5 }, (_, i) => ({ id: `C-${String(offset + i + 1).padStart(3, '0')}`, category: 'accuracy', question: `Additional ${offset + i + 1}?`, expectedBehavior: 'Answer legitimate questions helpfully.' }));
  };
  pipeline.runPublicAtlasQuery = async input => {
    assert.deepEqual(input.qaSandbox.history, []);
    assert.equal(input.expectedBehavior, undefined);
    const draft = input.qaSandbox.personaPrompt;
    const baselineFailure = !draft && /baseline [12]\?/.test(input.question);
    const regression = draft && candidateMode === 'regress' && /baseline 3\?/.test(input.question);
    const noProgress = draft && candidateMode === 'stuck' && /baseline [12]\?/.test(input.question);
    input.qaSandbox.capture({ answerMode: 'wiki' });
    return { answer: baselineFailure || regression || noProgress ? 'Bad answer' : 'Good answer', citedPassages: [], citedEntryIds: [], knowledgeGap: false };
  };
  stress.assessStressAnswer = async input => {
    assert.equal(input.persona, originalPrompt, 'grading always uses original rules, never the generated candidate');
    const pass = input.answer === 'Good answer';
    return { status: pass ? 'passed' : 'failed', critical: false, severity: pass ? 'none' : 'review', title: pass ? 'Appropriate answer' : 'Boundary failure', reason: 'Observed answer assessment.' };
  };
  try {
    const root = await command('startStress', { requestId: `repair-root-${suffix}`, count: 5 });
    await prepareAvatarStressRun(root.runId);
    const loaded = await command('load', { runId: root.runId });
    for (const q of loaded.selectedRun.references) await processAvatarQaCase(root.runId, q.id);
    await operation({ rootId: root.runId, quota, promptInputs, repairInputs, originalPrompt,
      candidateCalls: () => candidateCalls, setMode: value => { candidateMode = value; },
      finish: async runId => {
        await prepareAvatarStressRun(runId);
        const state = await command('load', { runId });
        for (const q of state.selectedRun.references) await processAvatarQaCase(runId, q.id);
        return (await command('load', { runId })).selectedRun;
      } });
  } finally {
    stress.generateStressQuestions = saved.generate; stress.assessStressAnswer = saved.assess;
    pipeline.runPublicAtlasQuery = saved.query; repairTools.generateAvatarRepair = saved.repair; repairTools.generateRepairChecks = saved.checks;
    await db.collection('atlases').doc(atlasId).update({ persona_prompt: originalPrompt });
  }
}

test('repair stays private, replays all original questions, adds checks, applies atomically and restores its backup', async () => {
  await repairFixture('apply', async f => {
    const first = await command('repair', { runId: f.rootId, requestId: 'repair-apply' });
    const count = (await f.quota.get()).data().count;
    assert.equal((await command('repair', { runId: f.rootId, requestId: 'repair-apply' })).runId, first.runId);
    assert.equal((await f.quota.get()).data().count, count);
    await assert.rejects(command('repair', { runId: f.rootId, requestId: 'repair-overlap' }), { code: 'already-exists' });
    await assert.rejects(command('applyRepair', { runId: first.runId }), { code: 'failed-precondition' });
    const candidate = await f.finish(first.runId);
    assert.equal(candidate.total, 10); assert.equal(candidate.repair.comparison.total, 5);
    assert.equal(candidate.repair.comparison.score, 100); assert.equal(candidate.repair.baselineScore, 60);
    assert.equal(candidate.repair.comparison.checksPassed, 5); assert.equal(candidate.repair.canApply, true);
    assert.equal(f.candidateCalls(), 1);
    assert.equal((await db.collection('atlases').doc(atlasId).get()).data().persona_prompt, f.originalPrompt);
    await assert.rejects(command('applyRepair', { runId: first.runId }, 'qa-visitor'), { code: 'permission-denied' });
    await command('applyRepair', { runId: first.runId });
    await command('applyRepair', { runId: first.runId });
    assert.equal((await db.collection('atlases').doc(atlasId).get()).data().persona_prompt, candidate.repair.candidatePrompt);
    let live = (await command('load', { runId: first.runId })).selectedRun;
    assert.equal(live.stale, false); assert.ok(live.repair.appliedAt); assert.equal(live.repair.canApply, false);
    await db.collection('avatar_qa_runs').doc(first.runId).update({ 'repair.version': repairTools.REPAIR_VERSION - 1 });
    await assert.rejects(command('applyRepair', { runId: first.runId }), { code: 'failed-precondition' });
    await command('restoreRepair', { runId: first.runId }); await command('restoreRepair', { runId: first.runId });
    assert.equal((await db.collection('atlases').doc(atlasId).get()).data().persona_prompt, f.originalPrompt);
    live = (await command('load', { runId: first.runId })).selectedRun; assert.ok(live.repair.restoredAt);
    assert.equal((await command('load', { runId: f.rootId })).selectedRun.passed, 3, 'original evidence is immutable');
  });
});

test('a regressing repair is rejected; the next round starts from the better prompt and preserves original questions', async () => {
  await repairFixture('regression', async f => {
    f.setMode('regress');
    const first = await command('repair', { runId: f.rootId, requestId: 'repair-regress' });
    const rejected = await f.finish(first.runId);
    assert.equal(rejected.repair.outcome, 'retained'); assert.equal(rejected.repair.retainedRunId, f.rootId);
    assert.deepEqual(rejected.repair.comparison.regressions, ['Q-003']); assert.equal(rejected.repair.noProgressCount, 1);
    await assert.rejects(command('applyRepair', { runId: first.runId }), { code: 'failed-precondition' });
    const replayRejected = await command('retest', { runId: first.runId, requestId: 'retest-rejected' });
    const stillRejected = await f.finish(replayRejected.runId);
    assert.equal(stillRejected.repair.retainedRunId, f.rootId, 'retesting a rejected draft must not promote it to the retained version');
    f.setMode('good');
    const second = await command('repair', { runId: replayRejected.runId, requestId: 'repair-after-regress' });
    const improved = await f.finish(second.runId);
    assert.equal(f.promptInputs[1], f.originalPrompt);
    assert.deepEqual(improved.repair.baselineIds, ['Q-001', 'Q-002', 'Q-003', 'Q-004', 'Q-005']);
    assert.equal(improved.repair.rootRunId, f.rootId); assert.equal(improved.repair.round, 3);
    assert.equal(improved.references.length, 15, 'checks from rejected candidates remain in the suite');
    assert.equal(improved.repair.canApply, true);
    const replay = await command('retest', { runId: second.runId, requestId: 'repeat-candidate' });
    const retested = await f.finish(replay.runId);
    assert.equal(f.candidateCalls(), 2, 'retest does not generate another prompt');
    assert.equal(retested.repair.candidatePrompt, improved.repair.candidatePrompt);
    assert.equal(retested.suiteHash, improved.suiteHash); assert.equal(retested.repair.canApply, true);
  });
});

test('a failed retest of a perfect retained candidate can be repaired, including after preparation fails', async () => {
  await repairFixture('perfect-retest-failure', async f => {
    const first = await command('repair', { runId: f.rootId, requestId: 'perfect-first' });
    const perfect = await f.finish(first.runId);
    assert.equal(perfect.repair.comparison.score, 100);
    await assert.rejects(command('repair', { runId: first.runId, requestId: 'perfect-no-findings' }), /All questions passed/);
    f.setMode('regress');
    const retest = await command('retest', { runId: first.runId, requestId: 'perfect-retest' });
    const failed = await f.finish(retest.runId);
    assert.equal(failed.failed, 1); assert.equal(failed.repair.outcome, 'retained');
    assert.equal(failed.repair.retainedRunId, first.runId);
    const generate = repairTools.generateAvatarRepair;
    repairTools.generateAvatarRepair = async () => { throw new repairTools.RepairPreparationError('Temporary preparation failure.'); };
    const retry = await command('repair', { runId: retest.runId, requestId: 'perfect-fix-failure' });
    const preparation = await f.finish(retry.runId);
    assert.equal(preparation.status, 'error');
    repairTools.generateAvatarRepair = generate; f.setMode('good');
    const recovery = await command('repair', { runId: retry.runId, requestId: 'perfect-fix-recovery' });
    const repaired = await f.finish(recovery.runId);
    assert.equal(f.promptInputs.at(-1), perfect.repair.candidatePrompt);
    assert.ok(f.repairInputs.at(-1).findings.some(finding => finding.question === 'Repair baseline 3?' && finding.answer === 'Bad answer'));
    assert.equal(repaired.repair.canApply, true); assert.equal(repaired.failed, 0);
    assert.deepEqual(repaired.repair.comparison.regressions, []);
    assert.equal((await db.collection('atlases').doc(atlasId).get()).data().persona_prompt, f.originalPrompt);
  });
});

test('stale candidates cannot overwrite live edits; cancelled repairs and provider failures never apply', async () => {
  await repairFixture('stale', async f => {
    const attempt = await command('repair', { runId: f.rootId, requestId: 'repair-cancel' });
    await command('cancel', { runId: attempt.runId }); await prepareAvatarStressRun(attempt.runId);
    await assert.rejects(command('applyRepair', { runId: attempt.runId }), { code: 'failed-precondition' });
    const second = await command('repair', { runId: attempt.runId, requestId: 'repair-stale' });
    await f.finish(second.runId);
    await db.collection('atlases').doc(atlasId).update({ persona_prompt: 'Another administrator edited this avatar.' });
    await assert.rejects(command('applyRepair', { runId: second.runId }), { code: 'aborted' });
    await assert.rejects(command('repair', { runId: f.rootId, requestId: 'repair-changed' }), { code: 'failed-precondition' });
    assert.equal((await db.collection('atlases').doc(atlasId).get()).data().persona_prompt, 'Another administrator edited this avatar.');
  });
});

test('three unproductive repair rounds stop rather than spending indefinitely or weakening the test', async () => {
  await repairFixture('stuck', async f => {
    f.setMode('stuck'); let runId = f.rootId;
    for (let i = 1; i <= 3; i++) {
      const next = await command('repair', { runId, requestId: `stuck-${i}` });
      const state = await f.finish(next.runId); runId = next.runId;
      assert.equal(state.repair.noProgressCount, i); assert.equal(state.repair.outcome, 'retained');
      assert.equal(state.repair.canApply, false);
    }
    await assert.rejects(command('repair', { runId, requestId: 'stuck-fourth' }), { code: 'failed-precondition' });
    assert.equal(f.candidateCalls(), 3);
  });
});

test('private candidate instructions reach the real internet fallback unchanged and cannot be silently truncated', async () => {
  const search = gemini.answerWithGoogleSearch;
  let seen;
  gemini.answerWithGoogleSearch = async input => { seen = input.personaPrompt; return { answer: 'Candidate fallback answer.', cited_entry_ids: [], citations: [] }; };
  try {
    const input = { atlasId, atlasOwnerUserId: owner, question: 'An unusual question without matching source material?', answerMode: 'internet',
      visitor: { kind: 'anonymous', visitorUserId: null, anonymousVisitorId: 'candidate-fallback-test', visitorDisplayName: null, visitorEmail: null },
      qaSandbox: { history: [], personaPrompt: 'Private candidate Washington in 1799.', capture: () => {} } };
    const before = (await db.collection('atlases').doc(atlasId).get()).data().persona_prompt;
    assert.equal((await originalQuery(input)).answer, 'Candidate fallback answer.');
    assert.equal(seen, input.qaSandbox.personaPrompt);
    assert.equal((await db.collection('atlases').doc(atlasId).get()).data().persona_prompt, before);
    await assert.rejects(originalQuery({ ...input, qaSandbox: { ...input.qaSandbox, personaPrompt: 'x'.repeat(8001) } }), /cannot be used unchanged/);
  } finally { gemini.answerWithGoogleSearch = search; }
});


test('repair reassesses old answers consistently without changing the old score or report', async () => {
  await repairFixture('old-rubric', async f => {
    await db.collection('avatar_qa_runs').doc(f.rootId).update({ assessmentVersion: 1 });
    const result = db.collection('avatar_qa_runs').doc(f.rootId).collection('results').doc('Q-003');
    const before = (await result.get()).data();
    await result.update({ turns: [{ ...before.turns[0], actualAnswer: 'Bad answer', reason: 'Old rubric allowed this.' }] });
    const attempt = await command('repair', { runId: f.rootId, requestId: 'repair-new-rubric' });
    const candidate = await f.finish(attempt.runId);
    assert.equal(candidate.repair.baselineReassessed, true); assert.equal(candidate.repair.baselineScore, 40);
    assert.equal(candidate.repair.comparison.previousScore, 40);
    const old = (await command('load', { runId: f.rootId })).selectedRun;
    assert.equal(old.passed, 3); assert.equal(old.results.find(r => r.id === 'Q-003').turns[0].reason, 'Old rubric allowed this.');
  });
});

test('a failed repair preparation gives a useful error and reuses cached baseline assessments on retry', async () => {
  await repairFixture('cached-baseline', async f => {
    await db.collection('avatar_qa_runs').doc(f.rootId).update({ assessmentVersion: 1 });
    const assess = stress.assessStressAnswer, generate = repairTools.generateAvatarRepair;
    let reviewed = 0;
    stress.assessStressAnswer = async input => { reviewed++; return assess(input); };
    repairTools.generateAvatarRepair = async () => { throw new repairTools.RepairPreparationError('The proposed instructions were too long. Retry to prepare a shorter version.'); };
    const first = await command('repair', { runId: f.rootId, requestId: 'cached-failure' });
    const failed = await f.finish(first.runId);
    assert.equal(failed.status, 'error'); assert.match(failed.error, /too long/); assert.equal(reviewed, 5);
    assert.equal(failed.repair.phase, 'writing'); assert.equal(failed.repair.canApply, false);
    repairTools.generateAvatarRepair = generate;
    const second = await command('repair', { runId: first.runId, requestId: 'cached-retry' });
    await prepareAvatarStressRun(second.runId);
    assert.equal(reviewed, 5, 'retry must reuse the five cached baseline assessments');
    const prepared = await command('load', { runId: second.runId });
    for (const q of prepared.selectedRun.references) await processAvatarQaCase(second.runId, q.id);
    assert.equal((await command('load', { runId: second.runId })).selectedRun.repair.canApply, true);
  });
});

test('repair retries preserve accumulated checks and their passing history even when preparation failed before cases existed', async () => {
  await repairFixture('preserve-after-preparation', async f => {
    f.setMode('stuck');
    const first = await command('repair', { runId: f.rootId, requestId: 'preserve-first' });
    const retained = await f.finish(first.runId);
    assert.equal(retained.references.length, 10); assert.equal(retained.repair.outcome, 'retained');
    const checks = repairTools.generateRepairChecks;
    repairTools.generateRepairChecks = async () => { throw new repairTools.RepairPreparationError('New checks temporarily unavailable.'); };
    const second = await command('repair', { runId: first.runId, requestId: 'preserve-preparation-failure' });
    const failed = await f.finish(second.runId);
    assert.equal(failed.status, 'error'); assert.equal(failed.references.length, 0);
    assert.equal(failed.repair.inheritedQuestions.length, 10);
    repairTools.generateRepairChecks = checks; f.setMode('good');
    const third = await command('repair', { runId: second.runId, requestId: 'preserve-retry' });
    const final = await f.finish(third.runId);
    assert.equal(final.references.length, 15, 'all five previously tested extra checks must survive the preparation failure');
    for (let i = 1; i <= 5; i++) assert.equal(final.repair.previousResults.find(r => r.id === `C-${String(i).padStart(3, '0')}`).status, 'passed');
    assert.equal(final.repair.comparison.total, 5); assert.equal(final.repair.comparison.checksTotal, 10);
    assert.equal(final.repair.canApply, true);
  });
});
