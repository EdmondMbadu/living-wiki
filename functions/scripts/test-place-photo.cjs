const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PLACE_PHOTO_ENDPOINT: endpoint, stablePlacePhotoUrl, boardCoverPhotoUrl, placePhotoUrl } = require('../lib/place-photo');
const { resolvePlacePhoto } = require('../lib/place-photo-response');
const id = 'ChIJd8kca4PIxokRqW59OWceihQ';
const old = endpoint + '?ref=expired';
const stable = endpoint + '?placeId=' + id;
const board = { visibility: 'public', imageUrl: old, cards: [{ imageUrl: old, placeId: id }] };
const image = () => new Response(Buffer.from([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } });
const details = (reference = 'fresh') => new Response(JSON.stringify({ status: 'OK', result: { photos: [{ photo_reference: reference, html_attributions: ['<a href="https://example.com">Photographer</a>'] }] } }));
function dependencies(responses = [details(), image()], value = board) {
  const urls = [];
  return { urls, apiKey: 'fake-key', getBoard: async () => value,
    fetch: async (url) => { urls.push(new URL(url)); assert.ok(responses.length, 'Unexpected provider request'); return responses.shift(); } };
}

test('legacy URLs resolve using stable place identity without retaining references', () => {
  assert.equal(stablePlacePhotoUrl(old, id), stable);
  assert.equal(stablePlacePhotoUrl(endpoint + '?name=places/' + id + '/photos/expired'), stable);
  assert.equal(stablePlacePhotoUrl(old, undefined, 'board_1'), endpoint + '?boardId=board_1');
  assert.equal(stablePlacePhotoUrl(stable, undefined, 'board_1'), stable);
});
test('custom images and lookalike domains are never replaced', () => {
  for (const url of ['https://example.com/photo.jpg', 'https://example.com/boardPlacePhoto?ref=x', endpoint.replace('.net/', '.net.evil/') + '?ref=x']) {
    assert.equal(stablePlacePhotoUrl(url, id, 'board_1'), url);
    assert.equal(placePhotoUrl(url), null);
  }
});
test('board cover uses its matching card, not a random first card', () => {
  assert.equal(boardCoverPhotoUrl('board_1', { ...board, cards: [{ imageUrl: 'other', placeId: 'ChIJwrong000000' }, ...board.cards] }), stable);
  assert.equal(boardCoverPhotoUrl('board_1', { ...board, imageUrl: 'https://example.com/upload.jpg' }), 'https://example.com/upload.jpg');
});
test('author-only card identity is excluded from cover recovery', () => {
  assert.equal(boardCoverPhotoUrl('board_1', { ...board, cards: [{ ...board.cards[0], authorOnly: true }] }), endpoint + '?boardId=board_1');
});
test('fresh lookup returns image and corresponding current author credit', async () => {
  const deps = dependencies();
  const result = await resolvePlacePhoto({ placeId: id }, deps);
  assert.equal(result.status, 200);
  assert.equal(result.contentType, 'image/jpeg');
  assert.equal(result.attributions[0], '<a href="https://example.com">Photographer</a>');
  assert.equal(deps.urls[0].searchParams.get('place_id'), id);
  assert.equal(deps.urls[1].searchParams.get('photo_reference'), 'fresh');
});
test('each request fetches a fresh reference, not a cached one', async () => {
  const deps = dependencies([details('first'), image(), details('second'), image()]);
  await resolvePlacePhoto({ placeId: id }, deps);
  await resolvePlacePhoto({ placeId: id }, deps);
  assert.equal(deps.urls[3].searchParams.get('photo_reference'), 'second');
});
test('a reference that expires during lookup is refreshed once', async () => {
  const deps = dependencies([details('expired'), new Response('', { status: 400 }), details('new'), image()]);
  assert.equal((await resolvePlacePhoto({ placeId: id }, deps)).status, 200);
  assert.equal(deps.urls.length, 4);
  assert.equal(deps.urls[3].searchParams.get('photo_reference'), 'new');
});
test('repeated expired references stop after bounded retry', async () => {
  const deps = dependencies([details(), new Response('', { status: 400 }), details(), new Response('', { status: 400 })]);
  assert.equal((await resolvePlacePhoto({ placeId: id }, deps)).status, 404);
  assert.equal(deps.urls.length, 4);
});
test('existing public board covers recover without rewriting the board', async () => {
  const deps = dependencies();
  assert.equal((await resolvePlacePhoto({ boardId: 'board_1' }, deps)).status, 200);
  assert.equal(board.imageUrl, old);
});
test('private, deleted, nonexistent and author-only boards do not expose photos', async () => {
  for (const value of [null, { ...board, visibility: 'private' }, { ...board, deleted_at: 'now' }, { ...board, cards: [{ ...board.cards[0], authorOnly: true }] }]) {
    const deps = dependencies([], value);
    assert.equal((await resolvePlacePhoto({ boardId: 'board_1' }, deps)).status, 404);
    assert.equal(deps.urls.length, 0);
  }
});
test('invalid identifiers do not call Google', async () => {
  for (const query of [{}, { placeId: '../bad' }, { placeId: [id] }, { boardId: '../bad' }, { name: 'https://evil.com' }, { ref: ['x'] }]) {
    const deps = dependencies([]);
    assert.equal((await resolvePlacePhoto(query, deps)).status, 400);
  }
});
test('missing key returns service unavailable', async () => {
  assert.equal((await resolvePlacePhoto({ placeId: id }, { ...dependencies([]), apiKey: '' })).status, 503);
});
test('missing places and places without photos return a clear unavailable result', async () => {
  for (const data of [{ status: 'NOT_FOUND' }, { status: 'OK', result: {} }]) {
    assert.equal((await resolvePlacePhoto({ placeId: id }, dependencies([new Response(JSON.stringify(data))]))).status, 404);
  }
});
test('provider denial and failures never leak credentials or upstream errors', async () => {
  assert.equal((await resolvePlacePhoto({ placeId: id }, dependencies([new Response('{"status":"REQUEST_DENIED"}')]))).status, 503);
  const result = await resolvePlacePhoto({ placeId: id }, { ...dependencies([]), fetch: async () => { throw new Error('secret-key'); } });
  assert.deepEqual(result, { status: 502 });
});
test('non-image and oversized responses are rejected', async () => {
  for (const response of [new Response('<html>Error</html>'), new Response(new Uint8Array(8 * 1024 * 1024 + 1), { headers: { 'content-type': 'image/jpeg' } })]) {
    assert.equal((await resolvePlacePhoto({ placeId: id }, dependencies([details(), response]))).status, 502);
  }
});
test('legacy ref and new API name remain backward-compatible', async () => {
  for (const query of [{ ref: 'fresh' }, { name: 'places/' + id + '/photos/fresh' }]) {
    assert.equal((await resolvePlacePhoto(query, dependencies([image()]))).status, 200);
  }
});
