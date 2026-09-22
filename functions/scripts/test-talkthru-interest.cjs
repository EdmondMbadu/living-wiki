const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeTalkThruInterest } = require('../lib/talkthru-interest');

const valid = {
  role: 'agent', name: 'Edmond Badu', email: 'Edmond@Example.com',
  agency: 'LivingWiki Realty', listing: 'https://example.com/listing/1', consent: true,
};

test('normalizes a consented TalkThru inquiry', () => {
  assert.deepEqual(normalizeTalkThruInterest(valid), {
    role: 'agent', name: 'Edmond Badu', email: 'edmond@example.com',
    agency: 'LivingWiki Realty', listing: 'https://example.com/listing/1', consent: true,
  });
});

test('rejects invalid consent, contact details, and listing links', () => {
  for (const value of [
    { consent: false }, { email: 'invalid' }, { name: 'x' }, { agency: '' },
    { role: 'visitor' }, { listing: 'http://example.com/listing' },
  ]) {
    assert.throws(() => normalizeTalkThruInterest({ ...valid, ...value }), error => error.code === 'invalid-argument');
  }
});
