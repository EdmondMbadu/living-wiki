const assert = require('node:assert/strict');
const { publicBoardSummaryFromBoard } = require('../lib/public-board-summary.js');

const board = {
  owner_user_id: 'owner-1',
  owner_public_slug: 'jim-walker',
  owner_display_name: 'Jim Walker',
  visibility: 'public',
  title: 'Fast boards',
  description: 'A compact public shelf.',
  imageUrl: 'https://images.example/original.jpg',
  cards: [
    { id: 'one', title: 'Keep', status: 'saved', notes: 'large private-to-the-detail payload' },
    { id: 'two', title: 'Skip', status: 'favorite', notes: 'another large payload' },
    { id: 'private-intro', title: 'Intro card', status: 'saved', authorOnly: true },
  ],
  created_at_iso: '2026-08-21T00:00:00.000Z',
  updated_at_iso: '2026-08-21T01:00:00.000Z',
};

const summary = publicBoardSummaryFromBoard('board-1', board, {
  sourceImageUrl: board.imageUrl,
  imageUrl: 'https://storage.example/cover.jpg',
  webpSrcset: 'https://storage.example/cover-320.webp 320w, https://storage.example/cover-640.webp 640w',
  width: 960,
  height: 540,
});

assert.equal(summary.id, 'board-1');
assert.equal(summary.visibility, 'public');
assert.equal(summary.is_root, true);
assert.equal(summary.card_count, 2);
assert.equal(summary.favorite_card_count, 1);
assert.equal(summary.search_text, 'Keep Skip');
assert.equal(summary.imageUrl, 'https://storage.example/cover.jpg');
assert.equal(summary.source_image_url, board.imageUrl);
assert.equal('cards' in summary, false);
assert.equal(JSON.stringify(summary).includes('large private-to-the-detail payload'), false);

const nested = publicBoardSummaryFromBoard('board-2', {
  ...board,
  parentCardId: 'parent-card',
  visibility: 'private',
}, null);
assert.equal(nested.is_root, false);
assert.equal(nested.visibility, 'private');
assert.equal(nested.imageUrl, board.imageUrl);

console.log('public board summary tests passed');

// Browser fallback and server classification must agree as formats evolve.
const fs = require('node:fs');
const path = require('node:path');
assert.equal(
  fs.readFileSync(path.join(__dirname, '../src/property-board.ts'), 'utf8'),
  fs.readFileSync(path.join(__dirname, '../../src/app/boards/property-board.ts'), 'utf8'),
);
const propertySummary = (value) => publicBoardSummaryFromBoard('property', { ...board, ...value });
for (const value of [
  { cards: [{ title: 'Kitchen', tags: ['listing', 'real-estate'] }] },
  { cards: [{ tags: ['listing-story'] }] },
  { cards: [{ tags: ['listing', 'rental'] }] },
  { title: 'Real Estate VirtualTalkThru', cards: [] },
  { title: 'Condo', cards: [{ tags: ['agent-intro', 'contact-card'] }] },
  { title: 'Home tour', cards: ['Bedroom', 'Kitchen', 'Bathroom', 'Living room'].map((title) => ({ title })) },
]) assert.equal(propertySummary(value).is_property, true, JSON.stringify(value));
for (const value of [
  { title: 'House music', cards: [{ title: 'Kitchen' }] },
  { title: 'City guide', cards: [] },
  { cards: [{ title: 'Secret address', tags: ['listing-story'], authorOnly: true }] },
  { cards: [null, 'broken', { tags: [null, 3] }] },
]) assert.equal(propertySummary(value).is_property, false, JSON.stringify(value));
const property = propertySummary({
  like_count: 12,
  logoUrl: 'https://example.com/logo.png',
  cards: [
    { title: 'Kitchen', subtitle: 'Philadelphia', shortSummary: 'Garden view', tags: ['listing-story'], tour: { address: '1428 Pine Street' } },
    { title: 'Secret address', subtitle: 'Secret city', shortSummary: 'Secret summary', tags: ['hidden'], authorOnly: true },
  ],
});
assert.equal(property.card_count, 1);
assert.equal(property.like_count, 12);
assert.equal(property.logoUrl, 'https://example.com/logo.png');
for (const term of ['Philadelphia', 'Garden view', '1428 Pine Street']) assert.ok(property.search_text.includes(term));
assert.equal(JSON.stringify(property).includes('Secret'), false);
assert.ok(propertySummary({ cards: Array.from({ length: 200 }, () => ({ title: 'X'.repeat(1000), subtitle: 'Y'.repeat(1000) })) }).search_text.length <= 8000);
console.log('property classification, search, and privacy tests passed');
