const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cachedImage } = require('../lib/off-grids/image-cache');
function file(name, size = 10) {
  let reads = 0, metadataReads = 0;
  return {
    bucket: {name: 'test'}, name,
    getMetadata: async () => { metadataReads++; return [{size: String(size), contentType: 'image/webp'}]; },
    download: async () => { reads++; return [Buffer.alloc(size)]; },
    counts: () => ({reads, metadataReads}),
  };
}
test('coalesces simultaneous image downloads and reuses bytes', async () => {
  const f = file('coalesce');
  const [a, b] = await Promise.all([cachedImage(f), cachedImage(f)]);
  assert.equal(a, b);
  assert.equal(await cachedImage(f), a);
  assert.deepEqual(f.counts(), {reads: 1, metadataReads: 1});
});
test('does not buffer oversized legacy images', async () => {
  const f = file('large', 3 * 1024 * 1024);
  assert.equal((await cachedImage(f)).bytes, null);
  assert.equal(f.counts().reads, 0);
});
test('bounds total cached bytes and evicts the least recently used image', async () => {
  const first = file('evict-first', 2 * 1024 * 1024);
  await cachedImage(first);
  for (let i = 0; i < 8; i++) await cachedImage(file('evict-' + i, 2 * 1024 * 1024));
  await cachedImage(first);
  assert.equal(first.counts().reads, 2);
});
test('failed downloads can be retried', async () => {
  const f = file('retry');
  const download = f.download;
  f.download = async () => { throw new Error('temporary'); };
  await assert.rejects(cachedImage(f), /temporary/);
  f.download = download;
  assert.equal((await cachedImage(f)).bytes.length, 10);
});
