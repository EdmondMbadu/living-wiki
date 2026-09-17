const assert = require('node:assert/strict');
const { canonicalCardNarration, withSavedNarration, invalidatedNarrationMedia } = require('../lib/card-narration');
const { adjustNarrationSentences, shortenNarrationSentences } = require('../lib/narration-text');
const { listingContactCardDetails } = require('../lib/listing-contact-card');

const source = 'The kitchen opens to the dining room. Windows overlook the garden. A covered porch adjoins the kitchen.';
let card = { id:'room', title:'Kitchen', notes:source, videoNarrationRevision:2 };
for (const target of [1,3,2,1,3]) {
  const script = adjustNarrationSentences({cardId:card.id,narration:canonicalCardNarration(card),sourceNarration:card.stackNarrationSource || source}, target);
  card = JSON.parse(JSON.stringify(withSavedNarration(card, script, source)));
  assert.equal(canonicalCardNarration(card), script);
  assert.equal(card.stackNarrationSource, source);
}
assert.equal(card.notes, source);
assert.equal(card.videoNarrationRevision, 7);
assert.equal(withSavedNarration(card, source, source).videoNarrationRevision, 7, 'unchanged saves do not bump audio revision');
const longSource = 'The room has a window. '.repeat(170) + 'The terrace faces the garden.';
assert.ok(longSource.length > 3000);
assert.equal(withSavedNarration(card, shortenNarrationSentences(longSource, 1), longSource).stackNarrationSource, longSource);

const contact = { id:'contact', title:'Contact Alex', tags:['listing-contact'], notes:source,
  contactDetails:{name:'Alex', organization:'Example Realty', phone:'(212) 555-0100', email:'alex@example.com'} };
const savedContact = withSavedNarration(contact, 'Contact Alex to arrange a viewing.', source);
assert.equal(canonicalCardNarration(savedContact), 'Contact Alex to arrange a viewing.');
assert.deepEqual(savedContact.contactDetails, contact.contactDetails);
assert.equal(listingContactCardDetails(savedContact).phoneHref, 'tel:2125550100');
assert.equal(listingContactCardDetails(savedContact).emailHref, 'mailto:alex@example.com');
const tour = { ...card, notes:'Background notes.', tour:{guideScript:source,sequence:2} };
const savedTour = withSavedNarration(tour, 'The kitchen opens to the dining room.', source);
assert.equal(savedTour.notes, 'Background notes.');
assert.equal(savedTour.tour.sequence, 2);
assert.equal(canonicalCardNarration(savedTour), savedTour.tour.guideScript);
assert.deepEqual(Object.values(invalidatedNarrationMedia()), ['','','','','']);
console.log('Canonical narration, contact actions, full-source persistence, and media invalidation checks passed.');
