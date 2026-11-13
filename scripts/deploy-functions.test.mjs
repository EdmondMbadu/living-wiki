import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deploymentPlan, deployBatches, firebaseDeployStatus } from './deploy-functions.mjs';

const names = Array.from({ length: 15 }, (_, index) => `function${index}`);
const available = new Set(names);

test('deploys only named exports in small batches and deduplicates targets', () => {
  const plan = deploymentPlan([...names, names[0]], available);
  assert.deepEqual(plan.batches, [names.slice(0, 5), names.slice(5, 10), names.slice(10)]);
  assert.equal(plan.dryRun, false);
});

test('supports a read-only plan, comma-separated targets and smaller CPU recovery batches', () => {
  assert.deepEqual(deploymentPlan(['--dry-run', '--batch-size=1', names.slice(0, 2).join(',')], available), {
    dryRun: true, batches: [[names[0]], [names[1]]], withApp: false, batchSize: 1,
  });
});

test('rejects empty, invalid, wildcard and unknown targets before any deployment', () => {
  for (const args of [[], ['--dry-run'], ['functions'], ['--all', 'function0'], ['*'], ['missing'], ['function0;echo'], ['--batch-size=0', 'function0'], ['--batch-size=11', 'function0']]) {
    assert.throws(() => deploymentPlan(args, available));
  }
});

test('plans an explicit full app deployment using only named exports', () => {
  const plan = deploymentPlan(['--all', '--with-app', '--dry-run'], available);
  assert.deepEqual(plan.batches.flat(), [...names].sort());
  assert.ok(plan.batches.every((batch) => batch.length <= 5));
  assert.equal(plan.withApp, true);
});

test('recovers just the failed targets reported in the deployment log', () => {
  const log = `functions: failed to update function projects/project/locations/us-central1/functions/function1
- Error Failed to update function function0 in region us-central1
- Error Failed to update function function1 in region us-central1
- Error Failed to set invoker function function3 in region us-central1
✔ functions[function2(us-central1)] Successful update operation.`;
  const plan = deploymentPlan(['--failed-log=deploy.log'], available, () => log);
  assert.deepEqual(plan.batches, [['function1', 'function0', 'function3']]);
  assert.throws(() => deploymentPlan(['--failed-log=deploy.log'], available, () => 'Deploy complete!'));
});

test('prefers final failures over earlier quota errors that succeeded on retry', () => {
  const log = `functions: failed to update function projects/project/locations/us-central1/functions/function0
✔ functions[function0(us-central1)] Successful update operation.
[error] Error: There was an error deploying functions:
[error] - Error Failed to update function function1 in region us-central1
[error] - Error Failed to create function function2 in region us-central1`;
  assert.deepEqual(deploymentPlan(['--failed-log=firebase-debug.log'], available, () => log).batches, [['function1', 'function2']]);
});

test('drops recovered functions when the debug log also contains a later deployment', () => {
  const log = `[error] Error: There was an error deploying functions:
[error] - Error Failed to update function function1 in region us-central1
[error] - Error Failed to create function function2 in region us-central1
✔ functions[function1(us-central1)] Successful update operation.
✔ Deploy complete!`;
  assert.deepEqual(deploymentPlan(['--failed-log=firebase-debug.log'], available, () => log).batches, [['function2']]);
});

test('requires Firebase to report completion even if it exits zero after a quota failure', () => {
  assert.equal(firebaseDeployStatus(0, 'HTTP Error: 429; failed to update function'), 1);
  assert.equal(firebaseDeployStatus(0, '✔ Deploy complete!'), 0);
  assert.equal(firebaseDeployStatus(2, '✔ Deploy complete!'), 2);
});

test('waits for a batch to finish before starting another and stops at the first failure', async () => {
  let finish;
  const started = [];
  const pending = deployBatches([[names[0]], [names[1]], [names[2]]], async (batch, index) => {
    started.push(...batch);
    if (index === 0) return new Promise((resolve) => { finish = resolve; });
    return 2;
  });
  assert.deepEqual(started, [names[0]]);
  finish(0);
  assert.deepEqual(await pending, { status: 2, remaining: names.slice(1, 3) });
  assert.deepEqual(started, names.slice(0, 2));
});

test('reports success only after all requested batches succeed', async () => {
  const completed = [];
  const result = await deployBatches([[names[0]], [names[1]]], async (batch) => { completed.push(...batch); return 0; });
  assert.deepEqual(result, { status: 0, remaining: [] });
  assert.deepEqual(completed, names.slice(0, 2));
});
