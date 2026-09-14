import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { prepareHostingRuntimeConfig } from './prepare-hosting-runtime-config.mjs';

const config = 'window.__LIVING_ATLAS_CONFIG__ = {firebase:{apiKey:"public-key",authDomain:"demo.test",projectId:"demo",appId:"public-app"}};';
const html = '<html><script src="/runtime-config.js"></script><script src="main-123.js" type="module"></script></html>';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'hosting-runtime-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const publicDirectory = join(root, 'browser');
  const configPath = join(root, 'runtime-config.js');
  await mkdir(join(publicDirectory, 'fr'), { recursive: true });
  await writeFile(join(publicDirectory, 'index.csr.html'), html);
  await writeFile(join(publicDirectory, 'fr/index.csr.html'), html);
  await writeFile(configPath, config);
  return { publicDirectory, configPath, expectedProjectId: 'demo' };
}

test('includes the missing config and gives every locale a cache-safe startup URL', async t => {
  const options = await fixture(t);
  const result = await prepareHostingRuntimeConfig(options);
  assert.equal(result.pages, 2);
  assert.match(result.configName, /^runtime-config-[a-f0-9]{12}\.js$/);
  assert.equal(await readFile(join(options.publicDirectory, result.configName), 'utf8'), config);
  assert.equal(await readFile(join(options.publicDirectory, 'runtime-config.js'), 'utf8'), config);
  for (const page of ['index.csr.html', 'fr/index.csr.html']) {
    assert.equal(await readFile(join(options.publicDirectory, page), 'utf8'), html.replace('/runtime-config.js', '/' + result.configName));
  }
});

test('is repeatable and changes the startup URL when configuration changes', async t => {
  const options = await fixture(t);
  const first = await prepareHostingRuntimeConfig(options);
  assert.deepEqual(await prepareHostingRuntimeConfig(options), first);
  await writeFile(options.configPath, config + '\n');
  const second = await prepareHostingRuntimeConfig(options);
  assert.notEqual(second.configName, first.configName);
  assert.ok((await readFile(join(options.publicDirectory, 'index.csr.html'), 'utf8')).includes('/' + second.configName));
});

test('blocks deployment when a checkout lacks its gitignored configuration', async t => {
  const options = await fixture(t);
  await rm(options.configPath);
  await assert.rejects(prepareHostingRuntimeConfig(options), { code: 'ENOENT' });
  assert.equal(await readFile(join(options.publicDirectory, 'index.csr.html'), 'utf8'), html);
});

test('rejects HTML fallback responses and incomplete configuration', async t => {
  const options = await fixture(t);
  for (const invalid of ['<!doctype html><html></html>', 'window.__LIVING_ATLAS_CONFIG__ = {};']) {
    await writeFile(options.configPath, invalid);
    await assert.rejects(prepareHostingRuntimeConfig(options));
  }
});

test('rejects configuration for another project and a missing SPA entry point', async t => {
  const options = await fixture(t);
  await assert.rejects(prepareHostingRuntimeConfig({ ...options, expectedProjectId: 'another-project' }), /does not match/);
  await rm(join(options.publicDirectory, 'index.csr.html'));
  await assert.rejects(prepareHostingRuntimeConfig(options), /SPA entry point/);
});
