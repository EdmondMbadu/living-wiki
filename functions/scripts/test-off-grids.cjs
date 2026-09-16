const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  validCoordinates,
  sourceSpotId,
  isOffGridCard,
  publicPreview,
  rangeFrom,
  bucketObject,
} = require('../lib/off-grids/model');
test('coordinates include zero and reject invalid bounds/types', () => {
  assert.equal(validCoordinates(0, 0), true);
  for (const pair of [
    [91, 0],
    [0, -181],
    [NaN, 0],
    ['0', 0],
  ])
    assert.equal(validCoordinates(...pair), false);
});
test('source ids are deterministic, distinct across boards and independent of array position', () => {
  assert.equal(sourceSpotId('a', 'b'), sourceSpotId('a', 'b'));
  assert.notEqual(sourceSpotId('a', 'b'), sourceSpotId('b', 'a'));
});
test('only explicit off-grid cards enter the directory', () => {
  assert.equal(isOffGridCard({ kind: 'off-grid' }, {}), true);
  assert.equal(isOffGridCard({ kind: 'standard' }, { tags: ['off-grid'] }), true);
  assert.equal(isOffGridCard({ kind: 'standard' }, { locationLat: 12, locationLng: 14 }), false);
  assert.equal(isOffGridCard({ kind: 'off-grid' }, { offGridSpotId: 'reference' }), false);
});
test('private, draft and unresolved records never form public previews', () => {
  const spot = {
    ownerUid: 'u',
    creatorUid: 'u',
    title: 'Gem',
    tip: 'tip',
    location: { lat: 0, lng: 0, source: 'map', confirmedAt: 'now' },
    createdAt: 'now',
    updatedAt: 'now',
    visibility: 'public',
    status: 'active',
  };
  assert.ok(publicPreview(spot, 'x'));
  for (const change of [
    { visibility: 'private' },
    { status: 'draft' },
    { location: null },
    { location: { lat: 0, lng: 0, source: 'map', confirmedAt: '' } },
  ])
    assert.equal(publicPreview({ ...spot, ...change }, 'x'), null);
});
test('byte ranges support Safari playback and reject invalid ranges', () => {
  assert.deepEqual(rangeFrom('bytes=0-1', 100), { start: 0, end: 1 });
  assert.deepEqual(rangeFrom('bytes=50-', 100), { start: 50, end: 99 });
  assert.deepEqual(rangeFrom('bytes=-10', 100), { start: 90, end: 99 });
  assert.throws(() => rangeFrom('bytes=100-', 100));
  assert.throws(() => rangeFrom('bytes=1-0', 100));
});
test('legacy imports only accept storage objects in the configured bucket', () => {
  assert.equal(
    bucketObject(
      'https://firebasestorage.googleapis.com/v0/b/test/o/users%2Fu%2Fboards%2Fv.mp4?alt=media',
      'test',
    ),
    'users/u/boards/v.mp4',
  );
  assert.equal(
    bucketObject('https://firebasestorage.googleapis.com/v0/b/other/o/private', 'test'),
    null,
  );
  assert.equal(bucketObject('https://evil.example/x', 'test'), null);
});
