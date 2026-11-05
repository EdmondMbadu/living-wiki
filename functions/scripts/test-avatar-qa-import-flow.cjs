// Run real callable authorization, transactions, case execution and exports against
// fake storage/model boundaries. Never contact the real Firebase project or an AI.
process.env.GCLOUD_PROJECT = 'demo-avatar-import';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:1';
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'demo-avatar-import' });
const assert = require('node:assert/strict');
const { test, beforeEach } = require('node:test');
const { createHash } = require('node:crypto');
const { Timestamp } = require('firebase-admin/firestore');
const { FakeFirestore } = require('./fake-firestore.cjs');
const fake = new FakeFirestore(), files = new Map(), revisions = new Map();
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const docPrototype = Object.getPrototypeOf(fake.doc('test/doc'));
const originalGet = docPrototype.get;
docPrototype.get = async function() { const snapshot = await originalGet.call(this); snapshot.updateTime = Timestamp.fromMillis(revisions.get(this.path) || 1); return snapshot; };
const queryPrototype = Object.getPrototypeOf(Object.getPrototypeOf(fake.collection('test')));
queryPrototype.orderBy = function() { return this; };
const originalWhere = queryPrototype.where;
queryPrototype.where = function(field, operator, values) {
  if (operator !== 'in') return originalWhere.call(this, field, operator, values);
  const source = this;
  return { limit: count => ({ get: async () => {
    const all = await source.get();
    return { docs: all.docs.filter(document => values.includes(document.data()[field])).slice(0, count) };
  } }) };
};
const putModule = (name, exports) => { const path = require.resolve('../lib/' + name); require.cache[path] = { id: path, filename: path, loaded: true, exports }; };
putModule('firebase', { db: fake, storage: { bucket: () => ({ file: path => ({
  save: async value => { if (files.has(path)) throw Object.assign(new Error('exists'), { code: 412 }); files.set(path, value); },
  download: async () => [Buffer.from(files.get(path))],
}) }) } });
let afterCorpus, pipelineCalls, generationCalls, evaluatorFails;
putModule('avatar-qa-corpus', { QA_SNAPSHOT_VERSION: 2, avatarQaCorpus: async (_db, context, protocol) => {
  const snapshot = { atlas: { name: context.atlas.name, persona_prompt: context.atlas.persona_prompt }, card: context.card, boardTitle: context.board.title, protocol, corpus: {} };
  if (afterCorpus) { afterCorpus(); afterCorpus = null; }
  return { snapshot, fingerprint: hash(snapshot) };
} });
putModule('pipeline', { runPublicAtlasQuery: async options => { pipelineCalls.push(options); options.qaSandbox.capture({ answerMode: 'wiki' }); return { answer: 'A real captured test answer.', citedPassages: [], citedEntryIds: [] }; } });
const stress = require('../lib/avatar-stress-test');
stress.generateStressQuestions = async () => { generationCalls++; throw new Error('Imported questions must not be generated again.'); };
stress.assessStressAnswer = async () => { if (evaluatorFails) throw new Error('Evaluator offline'); return { status: 'passed', critical: false, severity: 'none', title: 'Handled appropriately', reason: 'Respected the boundaries.' }; };
const { avatarQaCommand, processAvatarQaCase, prepareAvatarStressRun, recoverAvatarQaCases } = require('../lib/avatar-qa');
const { qaExampleSuite } = require('../lib/avatar-qa-questions');
const call = (action, options = {}, uid = 'owner') => avatarQaCommand.run({ auth: uid ? { uid } : undefined, data: { boardId: 'board', cardId: 'card', action, ...options } });
const suite = () => ({ ...qaExampleSuite('Washington'), questions: qaExampleSuite('Washington').questions.slice(0, 2) });
const start = (options = {}) => call('startImported', { requestId: 'request1', suite: suite(), ...options });
const run = id => fake.data('avatar_qa_runs/' + id);
beforeEach(() => {
  fake.docs.clear(); files.clear(); revisions.clear(); afterCorpus = null; pipelineCalls = []; generationCalls = 0; evaluatorFails = false;
  fake.seed('boards/board', { owner_user_id: 'owner', title: 'Board', visibility: 'public', cards: [{ id: 'card', conversation: { provider: 'atlas', atlasId: 'atlas' } }] });
  fake.seed('atlases/atlas', { user_id: 'owner', name: 'Washington', wiki_type: 'person', persona_prompt: 'Washington in 1799.' });
});

test('queues exactly imported cases under the stress protocol without generating questions', async () => {
  const { runId } = await start();
  const value = run(runId);
  assert.equal(value.source, 'imported'); assert.equal(value.status, 'queued');
  assert.equal(value.protocol, 'avatar-stress-v1'); assert.equal(value.total, 2);
  assert.deepEqual(value.references, suite().questions);
  for (const question of suite().questions) assert.deepEqual(fake.data(`avatar_qa_runs/${runId}/cases/${question.id}`).reference, question);
  await prepareAvatarStressRun(runId);
  assert.equal(generationCalls, 0); assert.equal(pipelineCalls.length, 0);
  assert.ok(files.has(value.snapshotPath));
  assert.equal(fake.data('atlases/atlas').persona_prompt, 'Washington in 1799.');
});
test('repeated starts are idempotent and changing the payload under the same key fails', async () => {
  const first = await start(); const second = await start(); assert.equal(first.runId, second.runId);
  const quota = fake.data('avatar_qa_quotas/' + hash(['owner', new Date().toISOString().slice(0, 10)]));
  assert.equal(quota.count, 1);
  await assert.rejects(start({ suite: { ...suite(), suiteName: 'Changed' } }), error => error.code === 'aborted');
  await assert.rejects(start({ boundaries: 'Different boundary' }), error => error.code === 'aborted');
});
test('authentication, avatar assignment and card access are checked before any run is created', async () => {
  await assert.rejects(call('startImported', { requestId: 'r', suite: suite() }, null), e => e.code === 'unauthenticated');
  await assert.rejects(call('startImported', { requestId: 'r', suite: suite() }, 'other'), e => e.code === 'permission-denied');
  await assert.rejects(start({ cardId: 'missing' }), e => e.code === 'not-found');
  assert.equal([...fake.docs.keys()].filter(k => k.startsWith('avatar_qa_runs/')).length, 0);
});
test('malformed server payloads cannot bypass client validation or spend quota', async () => {
  await assert.rejects(start({ suite: { ...suite(), questions: [{ ...suite().questions[0], status: 'passed' }] } }), e => e.code === 'invalid-argument');
  assert.equal([...fake.docs.keys()].filter(k => k.startsWith('avatar_qa_quotas/')).length, 0);
});
test('the active-run lock and daily quota apply to imported tests', async () => {
  await start();
  await assert.rejects(start({ requestId: 'request2' }), e => e.code === 'already-exists');
  fake.docs.delete('avatar_qa_workspaces/' + run((await start()).runId).workspaceKey);
  fake.seed('avatar_qa_quotas/' + hash(['owner', new Date().toISOString().slice(0, 10)]), { count: 10 });
  await assert.rejects(start({ requestId: 'request3' }), e => e.code === 'resource-exhausted');
});
test('configuration changes during preparation abort before a run or quota is committed', async () => {
  afterCorpus = () => revisions.set('atlases/atlas', 2);
  await assert.rejects(start(), e => e.code === 'aborted');
  assert.equal([...fake.docs.keys()].filter(k => k.startsWith('avatar_qa_runs/')).length, 0);
  assert.equal([...fake.docs.keys()].filter(k => k.startsWith('avatar_qa_quotas/')).length, 0);
});
test('actual visitor answers are captured and exported when the evaluator fails', async () => {
  const { runId } = await start(); evaluatorFails = true;
  for (const question of suite().questions) await processAvatarQaCase(runId, question.id);
  const value = run(runId);
  assert.equal(value.errors, 2); assert.equal(value.passed, 0); assert.equal(value.status, 'completed');
  assert.equal(pipelineCalls[0].question, suite().questions[0].question);
  assert.equal(fake.data(`avatar_qa_runs/${runId}/cases/EXT-001`).capturedTurns[0].actualAnswer, 'A real captured test answer.');
  const output = await call('exportAnswers', { runId });
  assert.equal(output.questions[0].turns[0].actualAnswer, 'A real captured test answer.');
  assert.equal(output.questions[0].status, 'error');
  assert.ok(!JSON.stringify(output).includes('Washington in 1799.'));
});
test('case re-delivery never repeats an avatar request and completed runs remain loadable', async () => {
  const { runId } = await start();
  for (const question of suite().questions) await processAvatarQaCase(runId, question.id);
  await processAvatarQaCase(runId, 'EXT-001');
  assert.equal(pipelineCalls.length, 2); assert.equal(run(runId).passed, 2);
  const loaded = await call('load', { runId });
  assert.equal(loaded.selectedRun.source, 'imported'); assert.equal(loaded.selectedRun.results.length, 2);
  assert.equal(loaded.runs[0].suiteName, suite().suiteName);
});
test('cancelled tests and private run scope cannot leak or execute questions', async () => {
  const { runId } = await start();
  await assert.rejects(call('exportAnswers', { runId }), e => e.code === 'failed-precondition');
  await call('cancel', { runId });
  await processAvatarQaCase(runId, 'EXT-001');
  assert.equal(pipelineCalls.length, 0); assert.equal(run(runId).cancelled, 2);
  const output = await call('exportAnswers', { runId }); assert.equal(output.questions[0].status, 'cancelled');
  fake.seed('boards/another', { ...fake.data('boards/board') });
  await assert.rejects(call('exportAnswers', { runId, boardId: 'another' }), e => e.code === 'not-found');
});
test('permission revocation is rechecked even for an idempotent retry', async () => {
  await start();
  fake.seed('atlases/atlas', { ...fake.data('atlases/atlas'), user_id: 'new-owner' });
  await assert.rejects(start(), e => e.code === 'permission-denied');
});

test('private repairs inherit imported question IDs and provenance instead of losing the suite', async () => {
  const { runId } = await start();
  for (const question of suite().questions) await processAvatarQaCase(runId, question.id);
  const resultPath = `avatar_qa_runs/${runId}/results/EXT-001`;
  const result = fake.data(resultPath);
  fake.seed(resultPath, { ...result, status: 'failed', turns: [{ ...result.turns[0], status: 'failed', reason: 'A synthetic identity failure.' }] });
  fake.seed('avatar_qa_runs/' + runId, { ...run(runId), passed: 1, failed: 1 });
  const repaired = await call('repair', { requestId: 'repair1', runId });
  const next = run(repaired.runId);
  assert.equal(next.source, 'imported'); assert.equal(next.suiteName, suite().suiteName);
  assert.deepEqual(next.repair.inheritedQuestions, suite().questions);
  assert.deepEqual(next.repair.baselineIds, suite().questions.map(q => q.id));
  assert.equal(next.repair.sourceRunId, runId);
  assert.equal(fake.data('atlases/atlas').persona_prompt, 'Washington in 1799.');
});
test('timeout recovery preserves the durable answer captured before assessment', async () => {
  const { runId } = await start();
  const casePath = `avatar_qa_runs/${runId}/cases/EXT-001`;
  fake.seed(casePath, { ...fake.data(casePath), status: 'running', startedAt: new Date(Date.now() - 13 * 60000).toISOString(),
    capturedTurns: [{ question: suite().questions[0].question, actualAnswer: 'Saved before worker timeout.', status: 'error', critical: false, reason: 'Assessment interrupted.' }] });
  await recoverAvatarQaCases.run({});
  const result = fake.data(`avatar_qa_runs/${runId}/results/EXT-001`);
  assert.equal(result.status, 'error'); assert.equal(result.turns[0].actualAnswer, 'Saved before worker timeout.');
  assert.equal(run(runId).errors, 1); assert.equal(pipelineCalls.length, 0);
});
