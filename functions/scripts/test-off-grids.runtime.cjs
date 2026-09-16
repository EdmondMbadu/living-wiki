const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { resolve } = require('node:path');
const cwd = resolve(__dirname, '..');
function run(target, code) {
  const child = spawnSync(process.execPath, ['-e', code], {cwd, encoding: 'utf8', env: {
    ...process.env, FUNCTION_TARGET: target, GCLOUD_PROJECT: 'demo-living-wiki',
    FIREBASE_CONFIG: JSON.stringify({projectId: 'demo-living-wiki', storageBucket: 'demo-living-wiki.firebasestorage.app'}),
  }});
  assert.equal(child.status, 0, child.stderr);
}
test('Off Grids workers load only their read/write module and defer native media processing', () => {
  for (const target of ['offGridDirectory', 'offGridMedia', 'offGridCommand', 'offGridShare', 'syncOffGridSpots']) {
    run(target, `
      const assert = require('node:assert/strict');
      const functions = require('./lib/runtime');
      assert.equal(typeof functions[process.env.FUNCTION_TARGET], 'function');
      assert.equal(require.cache[require.resolve('./lib/index')], undefined);
      assert.equal(require.cache[require.resolve('./lib/off-grids/media')], undefined);
      assert.equal(require.cache[require.resolve('./lib/off-grids/source')], undefined);
    `);
  }
});
test('Firebase discovery and other workers retain the complete existing export set', () => {
  for (const target of ['', 'placePhoto']) run(target, `
    const assert = require('node:assert/strict');
    assert.equal(require('./lib/runtime'), require('./lib/index'));
    assert.equal(typeof require('./lib/runtime').offGridDirectory, 'function');
  `);
});
