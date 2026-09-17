const assert = require('node:assert/strict');
const {
  deterministicStackScriptAdjustment,
  deterministicStackScriptShortening,
  normalizeStackScriptShortening,
  stackScriptSentenceCount,
} = require('../lib/stack-script-shortening');

const source = 'The home is listed at $799,900. It has four bedrooms. The kitchen opens to the dining area.';
assert.equal(stackScriptSentenceCount(source), 3);
assert.equal(
  deterministicStackScriptShortening(source, 2),
  'The home is listed at $799,900. It has four bedrooms.',
);

assert.equal(
  deterministicStackScriptAdjustment({
    narration: 'The home is listed at $799,900.',
    sourceNarration: source,
  }, 3),
  source,
);

assert.deepEqual(normalizeStackScriptShortening(
  [{ cardId: 'one', title: 'Overview', narration: source }],
  [{ cardId: 'one', narration: 'This home costs $200. It has four bedrooms.' }],
  2,
), [{ cardId: 'one', narration: 'The home is listed at $799,900. It has four bedrooms.' }]);

assert.deepEqual(normalizeStackScriptShortening(
  [{
    cardId: 'one',
    title: 'Overview',
    narration: 'The home is listed at $799,900.',
    sourceNarration: source,
  }],
  [{ cardId: 'one', narration: 'Listed at $799,900, this home offers four bedrooms. The kitchen opens to the dining area.' }],
  3,
), [{ cardId: 'one', narration: 'Listed at $799,900, this home offers four bedrooms. The kitchen opens to the dining area.' }]);

console.log('stack-script-shortening tests passed');

const { fitNarrationToWords, preservesNarrationQualifications, introducesNarrationNumbers } = require('../lib/narration-text');
const qualified = 'The living room is shown staged. Furniture is not included. The sale is subject to approval. Square footage is estimated.';
for (const target of [1, 2, 3]) {
  const result = deterministicStackScriptShortening(qualified, target);
  assert.equal(stackScriptSentenceCount(result), target);
  assert.ok(preservesNarrationQualifications(result, qualified));
  assert.match(result, /Furniture is not included/);
  assert.match(result, /subject to approval/);
  assert.match(result, /Square footage is estimated/);
}
assert.match(fitNarrationToWords(qualified, 10), /Furniture is not included/);
assert.equal(preservesNarrationQualifications('Furniture is not included.', 'Furniture is not included. Appliances are not included.'), false);
assert.equal(preservesNarrationQualifications('The pool is heated.', 'The pool is not heated.'), false);
assert.equal(introducesNarrationNumbers('There are four bedrooms.', 'There are three bedrooms.'), true);
assert.equal(introducesNarrationNumbers('It offers three bathrooms.', 'It offers three bedrooms.'), true);
assert.equal(introducesNarrationNumbers('A 2.5-acre lot.', 'A 2-acre lot.'), true);
assert.equal(stackScriptSentenceCount('Dr. Smith describes the 2.5-acre lot. It has a pond.'), 2);
assert.equal(stackScriptSentenceCount('明るいリビングです。庭につながります。'), 2);
assert.equal(deterministicStackScriptShortening('明るいリビングです。庭につながります。', 1), '明るいリビングです。');
assert.equal(deterministicStackScriptShortening('Une pièce lumineuse. Une terrasse couverte.', 1), 'Une pièce lumineuse.');
assert.match(deterministicStackScriptShortening('Une pièce lumineuse. Les meubles ne sont pas inclus.', 1), /ne sont pas inclus/);
assert.match(deterministicStackScriptShortening('明るいリビングです。家具は含まれていません。', 1), /家具は含まれていません/);
assert.equal(stackScriptSentenceCount(deterministicStackScriptShortening('明るいリビングです。家具は含まれていません。', 1)), 1);
assert.equal(deterministicStackScriptShortening('An unfinished authored note', 1), 'An unfinished authored note', 'never discard authored text when safe shortening is impossible');
assert.equal(deterministicStackScriptShortening('The room is shown furnished. Furniture is not', 1), 'The room is shown furnished. Furniture is not', 'an incomplete exclusion must not be silently dropped');

const cards = [{ cardId: 'one', title: 'Home', narration: qualified }, { cardId: 'two', title: 'Kitchen', narration: 'The kitchen has an island. A window faces the garden.' }];
for (const results of [[], [null,{},'bad response',{cardId:'one',narration:42}], [{cardId:'one',narration:''}], [{cardId:'one',narration:'The living room comes furnished.'}],
  [{cardId:'one',narration:'The living room has four fireplaces.'}],
  [{cardId:'one',narration:'Shown staged with.'}],
  [{cardId:'one',narration:'A first response.'},{cardId:'one',narration:'A duplicate response.'}]]) {
  const normalized = normalizeStackScriptShortening(cards, results, 1);
  assert.equal(normalized.length, 2);
  assert.equal(normalized[0].narration, deterministicStackScriptShortening(qualified, 1));
  assert.equal(normalized[1].narration, 'The kitchen has an island.');
}
// Neither missing responses nor model limits may drop the tail of a large board.
const many = Array.from({length:75}, (_, i) => ({cardId:String(i),title:'Room',narration:'A bright room. A garden view.'}));
assert.equal(normalizeStackScriptShortening(many, [], 1).length, 75);
console.log('Qualification, multilingual, malformed-response, and large-board shortening checks passed.');
