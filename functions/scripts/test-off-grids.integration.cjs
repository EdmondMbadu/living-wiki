const { test, before } = require('node:test');
const assert = require('node:assert/strict');
if (!process.env.FIRESTORE_EMULATOR_HOST)
  throw new Error('Run only against the Firestore emulator.');
process.env.GCLOUD_PROJECT = 'demo-living-wiki';
process.env.FIREBASE_CONFIG = JSON.stringify({
  projectId: 'demo-living-wiki',
  storageBucket: 'demo-living-wiki.firebasestorage.app',
});
const { db } = require('../lib/firebase');
const { offGridCommand, effectivePublic } = require('../lib/off-grids');
const { syncOffGridBoard } = require('../lib/off-grids/source');
const { sourceSpotId } = require('../lib/off-grids/model');
const call = (uid, action, spotId, values = {}) =>
  offGridCommand.run({
    data: { action, spotId, ...values },
    auth: uid ? { uid, token: { name: uid } } : undefined,
    rawRequest: { headers: {} },
  });
const location = { lat: 0, lng: -75, source: 'coordinates', confirmedAt: new Date().toISOString() };
before(async () => {
  await db.recursiveDelete(db.collection('off_grid_spots'));
  await db.recursiveDelete(db.collection('public_off_grid_spots'));
});
test('draft is idempotent, private, inaccessible anonymously and cannot be hijacked', async () => {
  await call('owner', 'draft', 'draft');
  await call('owner', 'draft', 'draft');
  const s = (await db.doc('off_grid_spots/draft').get()).data();
  assert.equal(s.visibility, 'private');
  assert.equal(s.status, 'draft');
  await assert.rejects(call('other', 'draft', 'draft'));
  await assert.rejects(call('', 'detail', 'draft'));
  assert.equal((await call('owner', 'detail', 'draft')).ownerUid, 'owner');
});
test('publishing requires confirmed coordinates and a validated cover; unpublish removes preview atomically', async () => {
  await call('owner', 'draft', 'published');
  await assert.rejects(
    call('owner', 'save', 'published', { title: 'Gem', location, visibility: 'public' }),
  );
  await db.doc('off_grid_uploads/cover').set({
    uid: 'owner',
    spotId: 'published',
    kind: 'cover',
    status: 'ready',
    result: { coverPath: 'validated.webp', coverLargePath: 'validated-large.webp' },
  });
  await call('owner', 'save', 'published', {
    title: 'Gem',
    location,
    visibility: 'public',
    coverTicketId: 'cover',
  });
  assert.equal((await db.doc('public_off_grid_spots/published').get()).exists, true);
  assert.equal((await call('', 'detail', 'published')).title, 'Gem');
  const list = await call('', 'list', 'directory', { scope: 'explore' });
  assert.ok(list.items.some((s) => s.id === 'published'));
  await call('owner', 'save', 'published', { title: 'Gem', location, visibility: 'private' });
  assert.equal((await db.doc('public_off_grid_spots/published').get()).exists, false);
  await assert.rejects(call('', 'detail', 'published'));
  await assert.rejects(
    call('other', 'save', 'published', { title: 'Hijacked', location, visibility: 'public' }),
  );
});
test('private pending clips are excluded from public detail; approval/features/removal preserve counts', async () => {
  await call('owner', 'save', 'published', { title: 'Gem', location, visibility: 'public' });
  await db.doc('off_grid_spots/published/pin_talks/clip').set({
    contributorUid: 'friend',
    contributorName: 'Friend',
    approval: 'pending',
    featured: false,
    createdAt: '2026-01-01',
    playbackPath: 'video.mp4',
  });
  assert.equal((await call('', 'detail', 'published')).clips.length, 0);
  assert.equal((await call('owner', 'detail', 'published')).clips.length, 1);
  await assert.rejects(call('friend', 'approveClip', 'published', { clipId: 'clip' }));
  await call('owner', 'approveClip', 'published', { clipId: 'clip' });
  await call('owner', 'featureClip', 'published', { clipId: 'clip' });
  assert.equal((await call('', 'detail', 'published')).clips[0].featured, true);
  assert.equal((await db.doc('public_off_grid_spots/published').get()).data().clipCount, 1);
  await call('owner', 'removeClip', 'published', { clipId: 'clip' });
  assert.equal((await call('', 'detail', 'published')).clips.length, 0);
  assert.equal((await db.doc('public_off_grid_spots/published').get()).data().clipCount, 0);
});
test('migration is deterministic, includes tagged cards, respects author-only and source visibility immediately', async () => {
  const ref = db.doc('boards/source');
  await ref.set({
    owner_user_id: 'owner',
    visibility: 'public',
    kind: 'standard',
    created_at_iso: '2025-01-01',
    cards: [
      { id: 'a', tags: ['off-grid'], title: 'Tagged gem', locationLat: 0, locationLng: 0 },
      {
        id: 'b',
        tags: ['off-grid'],
        title: 'Secret gem',
        locationLat: 1,
        locationLng: 1,
        authorOnly: true,
      },
      { id: 'c', title: 'Ordinary place', locationLat: 1, locationLng: 1 },
    ],
  });
  await syncOffGridBoard('source');
  await syncOffGridBoard('source');
  const spots = await db
    .collection('off_grid_spots')
    .where('sourceRef.boardId', '==', 'source')
    .get();
  assert.equal(spots.size, 2);
  const id = sourceSpotId('source', 'a');
  assert.equal((await db.doc('public_off_grid_spots/' + id).get()).exists, true);
  assert.equal(
    (await db.doc('public_off_grid_spots/' + sourceSpotId('source', 'b')).get()).exists,
    false,
  );
  await ref.update({ visibility: 'private' });
  await assert.rejects(call('', 'detail', id));
  assert.equal(await effectivePublic((await db.doc('off_grid_spots/' + id).get()).data()), false);
  const list = await call('', 'list', 'directory', { scope: 'explore' });
  assert.equal(
    list.items.some((s) => s.id === id),
    false,
  );
  await syncOffGridBoard('source');
  assert.equal((await db.doc('public_off_grid_spots/' + id).get()).exists, false);
  await ref.update({ cards: [] });
  await syncOffGridBoard('source');
  assert.equal((await db.doc('off_grid_spots/' + id).get()).data().status, 'deleted');
});
test('source edits update the original card without making a private source public', async () => {
  const ref = db.doc('boards/edit-source');
  await ref.set({
    owner_user_id: 'owner',
    visibility: 'private',
    kind: 'off-grid',
    created_at_iso: '2025-01-01',
    cards: [{ id: 'c', title: 'Original', locationLat: 1, locationLng: 1 }],
  });
  await syncOffGridBoard('edit-source');
  const id = sourceSpotId('edit-source', 'c');
  await call('owner', 'save', id, {
    title: 'Updated',
    tip: 'New tip',
    location,
    visibility: 'private',
  });
  const card = (await ref.get()).data().cards[0];
  assert.equal(card.title, 'Updated');
  assert.equal(card.locationLat, 0);
  assert.equal(card.authorOnly, true);
  await assert.rejects(
    call('owner', 'save', id, { title: 'Updated', location, visibility: 'public' }),
  );
});
test('saved pins paginate in bounded pages and include owner drafts without exposing private pins of others', async () => {
  const batch = db.batch();
  for (let i = 0; i < 15; i++) {
    const id = `saved-${String(i).padStart(2, '0')}`;
    batch.set(db.doc(`off_grid_spots/${id}`), { ownerUid: 'saved-owner', title: `Saved gem ${i}`, tip: '', visibility: 'private', status: 'draft', location: null, createdAt: '2026-01-01' });
    batch.set(db.doc(`users/saved-owner/saved_off_grid_spots/${id}`), { createdAt: '2026-01-01' });
  }
  batch.set(db.doc('users/saved-owner/saved_off_grid_spots/draft'), { createdAt: '2025-01-01' });
  await batch.commit();
  const first = await call('saved-owner', 'list', 'directory', { scope: 'saved' });
  assert.equal(first.items.length, 12);
  assert.ok(first.cursor);
  const second = await call('saved-owner', 'list', 'directory', { scope: 'saved', cursor: first.cursor });
  assert.equal(second.items.length, 3);
  assert.equal(second.cursor, null);
  assert.equal(new Set([...first.items, ...second.items].map(s => s.id)).size, 15);
  await assert.rejects(call('', 'list', 'directory', { scope: 'saved' }));
});
test('world map bounds include distant longitudes and bounded map results respect current visibility', async () => {
  await call('world-owner', 'draft', 'world-gem');
  await db.doc('off_grid_spots/world-gem').update({ coverPath: 'validated.webp' });
  await call('world-owner', 'save', 'world-gem', {
    title: 'Distant gem', location: { lat: 0, lng: 160, source: 'map', confirmedAt: 'now' }, visibility: 'public',
  });
  const world = await call('', 'map', 'directory', { bounds: { north: 85, south: -85, east: 180, west: -180 } });
  assert.ok(world.items.some(s => s.id === 'world-gem'));
  const nearby = await call('', 'map', 'directory', { bounds: { north: 10, south: -10, east: 20, west: -20 } });
  assert.equal(nearby.items.some(s => s.id === 'world-gem'), false);
  await call('world-owner', 'save', 'world-gem', {
    title: 'Distant gem', location: { lat: 0, lng: 175, source: 'map', confirmedAt: 'now' }, visibility: 'public',
  });
  assert.ok((await call('', 'map', 'directory', { bounds: { north: 10, south: -10, east: -170, west: 170 } })).items.some(s => s.id === 'world-gem'));
  await call('world-owner', 'save', 'world-gem', {
    title: 'Distant gem', location: { lat: 0, lng: 160, source: 'map', confirmedAt: 'now' }, visibility: 'private',
  });
  assert.equal((await call('', 'map', 'directory', { bounds: { north: 85, south: -85, east: 180, west: -180 } })).items.some(s => s.id === 'world-gem'), false);
});


test('unlisted source Gems play through direct links and stay absent from directories, including during transitions', async () => {
  const ref = db.doc('boards/unlisted-source');
  await ref.set({ owner_user_id: 'owner', visibility: 'public', kind: 'off-grid', created_at_iso: '2025-01-01', cards: [{ id: 'c', title: 'Linked gem', locationLat: 1, locationLng: 1 }] });
  await syncOffGridBoard(ref.id);
  const id = sourceSpotId(ref.id, 'c');
  await ref.update({ visibility: 'unlisted' });
  // Direct access follows the canonical parent even before its projection updates.
  assert.equal((await call('', 'detail', id)).title, 'Linked gem');
  assert.equal((await call('', 'detail', id)).visibility, 'unlisted');
  assert.equal(await effectivePublic((await db.doc('off_grid_spots/' + id).get()).data()), false);
  await syncOffGridBoard(ref.id);
  assert.equal((await db.doc('off_grid_spots/' + id).get()).data().visibility, 'unlisted');
  assert.equal((await db.doc('public_off_grid_spots/' + id).get()).exists, false);
  assert.equal((await call('', 'detail', id)).visibility, 'unlisted');
  await ref.update({ visibility: 'private' });
  await assert.rejects(call('', 'detail', id), /private|unavailable/);
  await syncOffGridBoard(ref.id);
  assert.equal((await db.doc('off_grid_spots/' + id).get()).data().visibility, 'private');
});
