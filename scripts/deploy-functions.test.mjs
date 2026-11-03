import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deploymentPlan, deployBatches } from './deploy-functions.mjs';

const names = Array.from({ length: 15 }, (_, index) => `function${index}`);
const available = new Set(names);

test('deploys only named exports in small batches and deduplicates targets', () => {
  const plan = deploymentPlan([...names, names[0]], available);
  assert.deepEqual(plan.batches, [names.slice(0, 5), names.slice(5, 10), names.slice(10)]);
  assert.equal(plan.dryRun, false);
});

test('supports a read-only plan, comma-separated targets and smaller CPU recovery batches', () => {
  assert.deepEqual(deploymentPlan(['--dry-run', '--batch-size=1', names.slice(0, 2).join(',')], available), {
    dryRun: true, batches: [[names[0]], [names[1]]],
  });
});

test('rejects empty, invalid, wildcard and unknown targets before any deployment', () => {
  for (const args of [[], ['--dry-run'], ['functions'], ['--all'], ['*'], ['missing'], ['function0;echo'], ['--batch-size=0', 'function0'], ['--batch-size=11', 'function0']]) {
    assert.throws(() => deploymentPlan(args, available));
  }
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
