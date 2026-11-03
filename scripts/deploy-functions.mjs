import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export function deploymentPlan(args, available) {
  let batchSize = 5;
  let dryRun = false;
  const names = [];
  for (const arg of args) {
    if (arg === '--dry-run') dryRun = true;
    else if (arg.startsWith('--batch-size=')) batchSize = Number(arg.slice(13));
    else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    else names.push(...arg.split(',').filter(Boolean));
  }
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 10) {
    throw new Error('Batch size must be between 1 and 10.');
  }
  const unique = [...new Set(names)];
  if (!unique.length) throw new Error('Specify the functions to update: npm run deploy:functions -- functionOne functionTwo');
  for (const name of unique) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name) || !available.has(name)) {
      throw new Error(`Unknown function: ${name}`);
    }
  }
  const batches = [];
  for (let index = 0; index < unique.length; index += batchSize) batches.push(unique.slice(index, index + batchSize));
  return { batches, dryRun };
}

/** Stop at the first failure; never start the next batch while one is running. */
export async function deployBatches(batches, run) {
  for (let index = 0; index < batches.length; index++) {
    const status = await run(batches[index], index);
    if (status !== 0) return { status: status || 1, remaining: batches.slice(index).flat() };
  }
  return { status: 0, remaining: [] };
}

function otherDeployment() {
  const result = spawnSync('ps', ['-A', '-o', 'pid=,command='], { encoding: 'utf8' });
  return (result.stdout ?? '').split('\n').some((line) =>
    /(?:^|[/\s])firebase(?:\.js)?\s+deploy(?:\s|$)/.test(line));
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  if (!args.length) throw new Error('Specify the functions to update: npm run deploy:functions -- functionOne functionTwo');
  if (!dryRun && otherDeployment()) {
    throw new Error('Another Firebase deployment is running. Let it finish before starting a targeted deployment.');
  }
  const root = fileURLToPath(new URL('../', import.meta.url));
  // Build before discovery so validation always uses the current checkout.
  const build = spawnSync('npm', ['--prefix', 'functions', 'run', 'build'], { cwd: root, stdio: 'inherit' });
  if (build.error) throw build.error;
  if (build.status !== 0) { process.exitCode = build.status || 1; return; }
  // Firebase normally supplies this during discovery. Loading exports here only
  // inspects trigger metadata; no handlers are invoked.
  process.env.GCLOUD_PROJECT ??= 'living-atlas-7622a';
  process.env.FIREBASE_CONFIG ??= JSON.stringify({ projectId: 'living-atlas-7622a', storageBucket: 'living-atlas-7622a.firebasestorage.app' });
  const require = createRequire(new URL('../functions/package.json', import.meta.url));
  const endpoints = require('../functions/lib/index.js');
  const available = new Set(Object.keys(endpoints).filter((name) => endpoints[name]?.__endpoint || endpoints[name]?.__trigger));
  const plan = deploymentPlan(args, available);
  console.log(`${plan.dryRun ? 'Plan' : 'Deploy'}: ${plan.batches.flat().length} functions in ${plan.batches.length} sequential batches.`);
  const result = await deployBatches(plan.batches, async (batch, index) => {
    const parameters = ['deploy', '--project', 'living-atlas-7622a', '--only', batch.map((name) => `functions:${name}`).join(',')];
    console.log(`\n[${index + 1}/${plan.batches.length}] ${batch.join(', ')}`);
    if (plan.dryRun) { console.log(`firebase ${parameters.join(' ')}`); return 0; }
    const deployed = spawnSync('firebase', parameters, { cwd: root, stdio: 'inherit' });
    if (deployed.error) throw deployed.error;
    if (deployed.signal) throw new Error(`Deployment interrupted (${deployed.signal}); no later batches were started.`);
    return deployed.status ?? 1;
  });
  if (result.remaining.length) {
    console.error('\nStopped after a failed batch. Earlier successful batches do not need another deployment.');
    console.error(`Retry the unfinished batches: npm run deploy:functions -- ${result.remaining.join(' ')}`);
  } else if (!plan.dryRun) console.log('\nAll requested function updates completed.');
  process.exitCode = result.status;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
