import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const project = 'living-atlas-7622a';
const batchIntervalMs = 60_000;
const usage = 'Specify function names, --failed-log=PATH, or --all.';

export function failedFunctionsFromLog(log) {
  const summary = 'There was an error deploying functions:';
  const summaryStart = log.lastIndexOf(summary);
  // Firebase may report a failed attempt and then succeed on retry. When it
  // prints a final summary, that list is the source of truth for recovery.
  const output = summaryStart < 0 ? log : log.slice(summaryStart + summary.length);
  const updates = output.matchAll(/\bFailed to (?:update|create) function (?:projects\/[^/\s]+\/locations\/[^/\s]+\/functions\/)?([A-Za-z][A-Za-z0-9_]*)(?=\s|$)|\bfunctions\[([A-Za-z][A-Za-z0-9_]*)\([^)]+\)\]\s+Successful (?:update|create) operation\./gi);
  const failed = new Set();
  for (const [, failure, success] of updates) {
    if (failure) failed.add(failure);
    else failed.delete(success);
  }
  return [...failed];
}

export function deploymentPlan(args, available, readLog = readFileSync) {
  let batchSize = 5;
  let dryRun = false;
  let all = false;
  let withApp = false;
  const names = [];
  for (const arg of args) {
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--all') all = true;
    else if (arg === '--with-app') withApp = true;
    else if (arg.startsWith('--batch-size=')) batchSize = Number(arg.slice(13));
    else if (arg.startsWith('--failed-log=')) {
      const path = arg.slice('--failed-log='.length);
      const failed = failedFunctionsFromLog(readLog(path, 'utf8'));
      if (!failed.length) throw new Error(`No failed function updates found in ${path}.`);
      names.push(...failed);
    }
    else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    else names.push(...arg.split(',').filter(Boolean));
  }
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 10) {
    throw new Error('Batch size must be between 1 and 10.');
  }
  if (all && names.length) throw new Error('--all cannot be combined with named functions or --failed-log.');
  const unique = all ? [...available].sort() : [...new Set(names)];
  if (!unique.length) throw new Error(usage);
  for (const name of unique) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name) || !available.has(name)) {
      throw new Error(`Unknown function: ${name}`);
    }
  }
  const batches = [];
  for (let index = 0; index < unique.length; index += batchSize) batches.push(unique.slice(index, index + batchSize));
  return { batches, dryRun, withApp, batchSize };
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
  return (result.stdout ?? '').split('\n').some((line) => {
    const match = line.match(/^\s*(\d+)\s+(.*)$/);
    return match && Number(match[1]) !== process.pid
      && /(?:^|[/\s])(?:firebase(?:\.js)?\s+deploy|deploy-functions\.mjs)(?:\s|$)/.test(match[2]);
  });
}

export function firebaseDeployStatus(status, output) {
  // The CLI can exit zero after logging a quota error without completing deployment.
  return status || (/Deploy complete!/i.test(output) ? 0 : 1);
}

function runFirebase(parameters, cwd) {
  return new Promise((resolveRun, reject) => {
    const child = spawn('firebase', parameters, { cwd, stdio: ['inherit', 'pipe', 'pipe'] });
    let completed = false;
    for (const [source, destination] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
      let tail = '';
      source.setEncoding('utf8');
      source.on('data', (chunk) => {
        destination.write(chunk);
        const output = tail + chunk;
        if (firebaseDeployStatus(0, output) === 0) completed = true;
        tail = output.slice(-32);
      });
    }
    child.on('error', reject);
    child.on('close', (status, signal) => {
      if (signal) reject(new Error(`Deployment interrupted (${signal}); no later batches were started.`));
      else resolveRun(firebaseDeployStatus(status, completed ? 'Deploy complete!' : ''));
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  if (!args.length) throw new Error(usage);
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
  process.env.GCLOUD_PROJECT ??= project;
  process.env.FIREBASE_CONFIG ??= JSON.stringify({ projectId: project, storageBucket: `${project}.firebasestorage.app` });
  const require = createRequire(new URL('../functions/package.json', import.meta.url));
  const endpoints = require('../functions/lib/index.js');
  const available = new Set(Object.keys(endpoints).filter((name) => endpoints[name]?.__endpoint || endpoints[name]?.__trigger));
  const plan = deploymentPlan(args, available);
  console.log(`${plan.dryRun ? 'Plan' : 'Deploy'}: ${plan.batches.flat().length} functions in ${plan.batches.length} sequential batches.`);
  let nextBatchStart = 0;
  const deploy = async (targets) => {
    const parameters = ['deploy', '--project', project, '--only', targets, '--non-interactive'];
    if (plan.dryRun) { console.log(`firebase ${parameters.join(' ')}`); return 0; }
    if (otherDeployment()) throw new Error('Another Firebase deployment is running. Let it finish before continuing.');
    return runFirebase(parameters, root);
  };
  const result = await deployBatches(plan.batches, async (batch, index) => {
    console.log(`\n[${index + 1}/${plan.batches.length}] ${batch.join(', ')}`);
    const waitMs = nextBatchStart - performance.now();
    if (!plan.dryRun && waitMs > 0) {
      console.log(`Waiting ${Math.ceil(waitMs / 1000)} seconds before the next function batch.`);
      await delay(waitMs);
    }
    nextBatchStart = performance.now() + batchIntervalMs;
    return deploy(batch.map((name) => `functions:${name}`).join(','));
  });
  if (result.remaining.length) {
    console.error('\nStopped after a failed batch. Earlier successful batches do not need another deployment.');
    const flags = [`--batch-size=${plan.batchSize}`, ...(plan.withApp ? ['--with-app'] : [])];
    console.error(`Retry the unfinished batches: npm run deploy:functions -- ${[...flags, ...result.remaining].join(' ')}`);
  } else {
    if (!plan.dryRun) console.log('\nAll requested function updates completed.');
    if (plan.withApp) {
      console.log('\nDeploying Firestore, Storage, and Hosting.');
      result.status = await deploy('firestore,storage,hosting');
      if (result.status) console.error(`Retry only the app resources: firebase deploy --project ${project} --only firestore,storage,hosting`);
    }
  }
  process.exitCode = result.status;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
