const assert = require('node:assert/strict');
const { test } = require('node:test');
const { boardVideoImageSources, fetchVideoImage, publicVideoImageAddress, videoImageUrl } = require('../lib/board-video-image.js');

test('only saved board photo sources are eligible for server preparation', () => {
  assert.deepEqual([...boardVideoImageSources({
    imageUrl: ' cover ', logoUrl: 'logo', socialVideoClosingCustomImageUrl: 'closing',
    cards: [{ imageUrl: 'one', imageUrls: ['one', 'two', 'three'] }, { imageUrls: ['four'] }, null],
    arbitraryUrl: 'not-a-board-photo',
  })], ['cover', 'logo', 'closing', 'one', 'two', 'three', 'four']);
});

test('rejects local addresses, mapped IPv6, credentials, HTTP and unexpected ports', () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '172.16.0.1', '192.168.0.1', '100.64.0.1', '::1', '::ffff:127.0.0.1']) {
    assert.equal(publicVideoImageAddress(address), false, address);
  }
  assert.equal(publicVideoImageAddress('8.8.8.8'), true);
  for (const url of ['http://example.com/a', 'https://user:password@example.com/a', 'https://example.com:444/a']) {
    assert.throws(() => videoImageUrl(url));
  }
});

test('downloads public photos using a validated pinned address and follows public redirects', async () => {
  const calls = [];
  const buffer = await fetchVideoImage('https://m1.cbhomes.com/photo.webp', async () => ['8.8.8.8'], async (url, address) => {
    calls.push([url.toString(), address]);
    return calls.length === 1
      ? { status: 302, location: 'https://m.cbhomes.com/actual.webp', buffer: Buffer.alloc(0), contentType: '' }
      : { status: 200, contentType: 'image/webp', buffer: Buffer.from('photo') };
  });
  assert.equal(buffer.toString(), 'photo');
  assert.deepEqual(calls, [['https://m1.cbhomes.com/photo.webp', '8.8.8.8'], ['https://m.cbhomes.com/actual.webp', '8.8.8.8']]);
});

test('blocks redirects and mixed DNS answers that target private hosts', async () => {
  let downloads = 0;
  await assert.rejects(fetchVideoImage('https://public.example/photo', async (host) =>
    host === 'public.example' ? ['8.8.8.8'] : ['127.0.0.1'], async () => {
      downloads += 1;
      return { status: 302, location: 'https://internal.example/secret', buffer: Buffer.alloc(0), contentType: '' };
    }), /Private photo hosts/);
  assert.equal(downloads, 1);
  await assert.rejects(fetchVideoImage('https://public.example/photo', async () => ['8.8.8.8', '10.0.0.1']), /Private photo hosts/);
});

test('rejects non-images and oversized image bodies', async () => {
  for (const response of [
    { status: 200, contentType: 'text/html', buffer: Buffer.from('html') },
    { status: 200, contentType: 'image/webp', buffer: Buffer.alloc(20 * 1024 * 1024 + 1) },
  ]) {
    await assert.rejects(fetchVideoImage('https://public.example/photo', async () => ['8.8.8.8'], async () => response), /could not be downloaded/);
  }
});

test('the callable requires an authenticated owner and a photo on that board', async (t) => {
  process.env.GCLOUD_PROJECT = 'demo-living-wiki';
  process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'demo-living-wiki', storageBucket: 'demo-living-wiki.appspot.com' });
  const firebase = require('../lib/firebase');
  const images = require('../lib/board-video-image');
  const { prepareBoardVideoImage } = require('../lib/index');
  const originalCollection = firebase.db.collection;
  const originalPrepare = images.prepareVideoImageDataUrl;
  t.after(() => { firebase.db.collection = originalCollection; images.prepareVideoImageDataUrl = originalPrepare; });
  const photo = 'https://m1.cbhomes.com/photo.webp';
  firebase.db.collection = (collection) => ({ doc: () => ({ get: async () => ({
    exists: collection === 'boards',
    data: () => collection === 'boards' ? { owner_user_id: 'owner', cards: [{ imageUrl: photo }] } : undefined,
  }) }) });
  let downloaded = 0;
  images.prepareVideoImageDataUrl = async () => { downloaded++; return 'data:image/webp;base64,cGhvdG8='; };
  const data = { boardId: 'board-test', imageUrl: photo };
  await assert.rejects(prepareBoardVideoImage.run({ data }), { code: 'unauthenticated' });
  await assert.rejects(prepareBoardVideoImage.run({ auth: { uid: 'other' }, data }), { code: 'permission-denied' });
  await assert.rejects(prepareBoardVideoImage.run({ auth: { uid: 'owner' }, data: { ...data, imageUrl: 'https://elsewhere.example/private' } }), { code: 'permission-denied' });
  assert.equal(downloaded, 0);
  assert.deepEqual(await prepareBoardVideoImage.run({ auth: { uid: 'owner' }, data }), { imageDataUrl: 'data:image/webp;base64,cGhvdG8=' });
  assert.equal(downloaded, 1);
});
