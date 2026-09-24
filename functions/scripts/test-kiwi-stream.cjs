const assert = require('node:assert/strict');
const { streamedBoardPreview } = require('../lib/kiwi');

const response = JSON.stringify({
  action: { kind: 'create_board', title: 'Dinner Menu', description: 'Tonight', tone: 'coral',
    visibility: 'unlisted', cards: [
      { title: 'Soup', subtitle: 'Warm', notes: 'With herbs', type: 'food' },
      { title: 'Salad', subtitle: 'Fresh', notes: 'With greens', type: 'food' },
    ] },
  reply: 'The draft is ready.',
});

assert.equal(streamedBoardPreview(response.slice(0, 15)), null);
const firstCardEnd = response.indexOf('},{') + 1;
const partial = streamedBoardPreview(response.slice(0, firstCardEnd));
assert.equal(partial.title, 'Dinner Menu');
assert.equal(partial.visibility, 'unlisted');
assert.deepEqual(partial.cards.map((card) => card.title), ['Soup']);
const complete = streamedBoardPreview(response);
assert.deepEqual(complete.cards.map((card) => card.title), ['Soup', 'Salad']);
assert.equal(complete.cards[0].notes, 'With herbs');
assert.equal(streamedBoardPreview('{"action":{"kind":"update_board","cards":[]}'), null);
console.log('Kiwi progressive board parsing passed.');
