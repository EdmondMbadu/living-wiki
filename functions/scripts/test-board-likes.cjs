const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { normalizeBoardLikeTarget, normalizeBoardLikeTargets, boardLikeMetricDocumentId, boardLikeMarkerDocumentId } = require('../lib/board-likes');

const ordinary = { boardId: 'board-1', cardId: 'card-1' };
const legacy = { boardId: 'board-2', cardId: 'legacy-memory:parent-1:12' };
assert.deepEqual(normalizeBoardLikeTarget(legacy), legacy);
assert.deepEqual(normalizeBoardLikeTargets([ordinary, legacy, { boardId: 'bad/path' }, ordinary, { boardId: 'board-3' }]), [
  ordinary, legacy, { boardId: 'board-3', cardId: null },
]);
assert.deepEqual(normalizeBoardLikeTargets(null), []);
assert.deepEqual(normalizeBoardLikeTargets([null, {}]), []);
assert.equal(normalizeBoardLikeTargets(Array.from({ length: 110 }, (_, i) => ({ boardId: `board-${i}` }))).length, 100);
for (const invalid of [
  { boardId: 'nested/board' }, { boardId: 'ambiguous:board' }, { boardId: 'x'.repeat(129) },
  { boardId: 'board', cardId: '../card' }, { boardId: 'board', cardId: 'x'.repeat(129) },
]) {
  assert.throws(() => normalizeBoardLikeTarget(invalid), { code: 'invalid-argument' });
}
// Existing metric IDs must remain stable after accepting legacy card IDs.
assert.equal(boardLikeMetricDocumentId(ordinary), createHash('sha256').update('card:board-1:card-1').digest('hex'));
assert.equal(boardLikeMarkerDocumentId(legacy, 'visitor-1'), createHash('sha256').update('card:board-2:legacy-memory:parent-1:12:visitor-1').digest('hex'));
assert.notEqual(boardLikeMetricDocumentId(ordinary), boardLikeMetricDocumentId(legacy));
console.log('Board likes compatibility tests passed.');
