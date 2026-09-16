const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createServer } = require('node:http');
const sharp = require('sharp');
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_STORAGE_EMULATOR_HOST)
  throw new Error('Run only against Firestore and Storage emulators.');
process.env.GCLOUD_PROJECT = 'demo-living-wiki';
process.env.FIREBASE_CONFIG = JSON.stringify({
  projectId: 'demo-living-wiki',
  storageBucket: 'demo-living-wiki.firebasestorage.app',
});
const { db, storage } = require('../lib/firebase');
const { run, processUpload } = require('../lib/off-grids/media');
const { offGridCommand, offGridDirectory, offGridMedia, offGridShare } = require('../lib/off-grids');
const ffmpeg = require('ffmpeg-static'),
  ffprobe = require('ffprobe-static').path;
let dir, server, base;
const call = (uid, action, values = {}) =>
  offGridCommand.run({
    data: { action, spotId: 'media-gem', ...values },
    auth: uid ? { uid, token: { name: uid } } : undefined,
    rawRequest: { headers: {} },
  });
async function job(id, kind, bytes, extra = {}) {
  const path = `off-grid-originals/owner/media-gem/${id}`;
  await storage
    .bucket()
    .file(path)
    .save(bytes, { metadata: { contentType: kind === 'cover' ? 'image/png' : 'video/mp4' } });
  await db
    .doc('off_grid_uploads/' + id)
    .set({
      uid: 'owner',
      spotId: 'media-gem',
      kind,
      path,
      status: 'uploading',
      trimStart: 0,
      trimEnd: null,
      ...extra,
    });
}
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'off-grid-tests-'));
  await call('owner', 'draft');
  const app = require('../../node_modules/express')();
  app.use('/share', offGridShare);
  app.use('/directory', offGridDirectory);
  app.use('/', offGridMedia);
  server = createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
after(async () => {
  server?.close();
  await rm(dir, { recursive: true, force: true });
});
test('photo decoding produces optimized renditions and no permanent download token', async () => {
  const png = await sharp({
    create: { width: 1600, height: 1000, channels: 3, background: '#245d46' },
  })
    .png()
    .toBuffer();
  await job('photo', 'cover', png);
  const result = await processUpload('owner', 'media-gem', 'photo');
  assert.ok(result.coverPath.endsWith('cover.webp'));
  const [meta] = await storage.bucket().file(result.coverPath).getMetadata();
  assert.equal(meta.contentType, 'image/webp');
  assert.equal(meta.metadata?.firebaseStorageDownloadTokens, undefined);
  const staged = await call('owner', 'stagedCover', {ticketId: 'photo'});
  const preview = new URL(staged.coverUrl);
  assert.equal((await fetch(base + '/?' + preview.searchParams)).status, 200);
  preview.searchParams.delete('grant');
  assert.equal((await fetch(base + '/?' + preview.searchParams)).status, 404);
  await assert.rejects(call('stranger', 'stagedCover', {ticketId: 'photo'}));
  await call('owner', 'save', {
    title: 'Media gem',
    location: { lat: 0, lng: 0, source: 'map', confirmedAt: 'now' },
    visibility: 'private',
    coverTicketId: 'photo',
  });
});
test('video pipeline applies trim and normalizes MP4/H264 with a poster, idempotently', async () => {
  const path = join(dir, 'input.mp4');
  await run(ffmpeg, [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=green:s=160x120:r=10',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440',
    '-t',
    '2',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-y',
    path,
  ]);
  const fs = require('node:fs/promises');
  await job('video', 'video', await fs.readFile(path), {
    trimStart: 0.5,
    trimEnd: 1.5,
    caption: 'A useful caption',
  });
  await call('owner', 'finishUpload', { ticketId: 'video' });
  const processed = (await db.doc('off_grid_uploads/video').get()).data().result;
  assert.ok(processed.posterPath.endsWith('poster.webp'));
  assert.equal(processed.duration, 1);
  const local = join(dir, 'normalized.mp4');
  await storage.bucket().file(processed.playbackPath).download({ destination: local });
  const probe = JSON.parse(
    await run(ffprobe, ['-v', 'error', '-show_streams', '-of', 'json', local]),
  );
  assert.equal(probe.streams.find((s) => s.codec_type === 'video').codec_name, 'h264');
  await call('owner', 'finishUpload', { ticketId: 'video' });
  assert.equal((await db.doc('off_grid_spots/media-gem').get()).data().clipCount, 1);
});
test('actual invalid and overlong media are rejected even when the declared type looks valid', async () => {
  await job('invalid', 'video', Buffer.from('not a real video'));
  await assert.rejects(processUpload('owner', 'media-gem', 'invalid'));
  const path = join(dir, 'long.mp4');
  await run(ffmpeg, [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=black:s=16x16:r=1',
    '-t',
    '181',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-y',
    path,
  ]);
  await job('long', 'video', await require('node:fs/promises').readFile(path));
  await assert.rejects(processUpload('owner', 'media-gem', 'long'), /3 minutes/);
  await assert.rejects(processUpload('stranger', 'media-gem', 'photo'));
});
test('private media denies anonymous access; authorized range playback works; unpublication blocks old public media URLs', async () => {
  const detail = await call('owner', 'detail');
  const cover = new URL(detail.coverUrl),
    video = new URL(detail.clips[0].playbackUrl);
  assert.equal((await fetch(base + '/?spot=media-gem&asset=cover')).status, 404);
  const authCover = await fetch(base + '/?' + cover.searchParams);
  assert.equal(authCover.status, 200);
  assert.equal(authCover.headers.get('cache-control'), 'private, no-store');
  assert.ok((await authCover.arrayBuffer()).byteLength > 0);
  const range = await fetch(base + '/?' + video.searchParams, { headers: { Range: 'bytes=0-1' } });
  assert.equal(range.status, 206);
  assert.equal((await range.arrayBuffer()).byteLength, 2);
  await call('owner', 'save', {
    title: 'Media gem',
    location: { lat: 0, lng: 0, source: 'map', confirmedAt: 'now' },
    visibility: 'public',
  });
  const publicCover = base + '/?spot=media-gem&asset=cover';
  assert.equal((await fetch(publicCover)).status, 200);
  assert.equal((await fetch(publicCover)).status, 200); // Warm server byte cache.
  const directory = await fetch(base + '/directory?scope=mine&uid=owner');
  assert.equal(directory.headers.get('cache-control'), 'private, no-store');
  assert.ok((await directory.json()).items.some(s => s.id === 'media-gem'));
  assert.equal(
    (
      await fetch(base + '/?spot=media-gem&asset=video&clip=video', {
        headers: { Range: 'bytes=0-1' },
      })
    ).status,
    206,
  );
  await call('owner', 'save', {
    title: 'Media gem',
    location: { lat: 0, lng: 0, source: 'map', confirmedAt: 'now' },
    visibility: 'private',
  });
  assert.equal((await fetch(base + '/?spot=media-gem&asset=video&clip=video')).status, 404);
  assert.equal((await fetch(publicCover)).status, 404);
  assert.ok(!(await (await fetch(base + '/directory?scope=mine&uid=owner')).json())
    .items.some(s => s.id === 'media-gem'));
});
test('a cached source cover is blocked immediately when its source card becomes author-only', async () => {
  await db.doc('boards/media-source').set({visibility: 'public', kind: 'off-grid', cards: [{id: 'source-card'}]});
  await db.doc('off_grid_spots/media-gem').update({visibility: 'public', sourceRef: {boardId: 'media-source', cardId: 'source-card'}});
  const url = base + '/?spot=media-gem&asset=cover';
  assert.equal((await fetch(url)).status, 200);
  await db.doc('boards/media-source').update({cards: [{id: 'source-card', authorOnly: true}]});
  assert.equal((await fetch(url)).status, 404);
  await db.doc('off_grid_spots/media-gem').update({visibility: 'private', sourceRef: null});
});
test('browser-style live WebM without container duration is accepted and normalized', async () => {
  const path = join(dir, 'browser-live.webm');
  await run(ffmpeg, [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=blue:s=160x120:r=10',
    '-t',
    '2',
    '-c:v',
    'libvpx',
    '-live',
    '1',
    '-y',
    path,
  ]);
  const probe = JSON.parse(
    await run(ffprobe, ['-v', 'error', '-show_format', '-of', 'json', path]),
  );
  assert.equal(probe.format.duration, undefined);
  await job('browser-recording', 'video', await require('node:fs/promises').readFile(path), {
    recorded: true,
  });
  const result = await processUpload('owner', 'media-gem', 'browser-recording');
  assert.ok(result.duration >= 1.8 && result.duration <= 2.1);
  assert.ok(result.playbackPath.endsWith('playback.mp4'));
});
test('cancelling during processing prevents publication and cancellation after finalization retracts the uploaded clip', async () => {
  await call('owner', 'cancelUpload', { ticketId: 'video' });
  assert.equal((await call('owner', 'detail')).clips.length, 0);
  assert.equal((await db.doc('off_grid_spots/media-gem').get()).data().clipCount, 0);
  const png = await sharp({create:{width:100,height:100,channels:3,background:'green'}}).png().toBuffer();
  await job('cancelled-photo', 'cover', png);
  const { File } = require('@google-cloud/storage');
  const originalDownload = File.prototype.download;
  File.prototype.download = async function(...args) {
    if (this.name.endsWith('/cancelled-photo')) await call('owner', 'cancelUpload', { ticketId: 'cancelled-photo' });
    return originalDownload.apply(this, args);
  };
  try {
    await assert.rejects(call('owner', 'finishUpload', {ticketId:'cancelled-photo'}), error => error.code === 'cancelled');
    assert.equal((await db.doc('off_grid_uploads/cancelled-photo').get()).data().status, 'cancelled');
    await assert.rejects(call('owner', 'stagedCover', {ticketId:'cancelled-photo'}));
  } finally { File.prototype.download = originalDownload; }
});
