const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeTalkThruInterest } = require('../lib/talkthru-interest');
const {
  buildTalkThruApplicantEmail,
  buildTalkThruAdminEmail,
  parseTalkThruAdminEmails,
} = require('../lib/talkthru-interest-email');

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

test('builds distinct applicant and admin emails without injecting signup HTML', () => {
  const interest = {
    ...normalizeTalkThruInterest(valid),
    name: 'Sam <script>alert(1)</script>',
    agency: 'Example & Co',
  };
  const applicant = buildTalkThruApplicantEmail(interest);
  const admin = buildTalkThruAdminEmail(interest);
  assert.match(applicant.text, /We received your request/);
  assert.doesNotMatch(applicant.text, /Review the request/);
  assert.match(admin.text, /Review the request: https:\/\/www\.livingwiki\.com\/admin\/users/);
  assert.match(admin.html, /&lt;script&gt;/);
  assert.doesNotMatch(admin.html, /<script>/);
  assert.match(applicant.html, /Example &amp; Co/);
});

test('requires two distinct admin alert addresses', () => {
  assert.deepEqual(parseTalkThruAdminEmails('{"jim":"JIM@EXAMPLE.COM","edmond":"edmond@example.com"}'), {
    jim: 'jim@example.com', edmond: 'edmond@example.com',
  });
  for (const value of ['{}', 'not-json', '{"jim":"jim@example.com","edmond":"jim@example.com"}']) {
    assert.throws(() => parseTalkThruAdminEmails(value));
  }
});

test('preserves service and city context for new TalkThru offers', () => {
  for (const requestType of ['free', 'done_for_you', 'general']) {
    assert.equal(normalizeTalkThruInterest({ ...valid, requestType }).requestType, requestType);
  }
  for (const requestType of ['founding', 'waitlist']) {
    const result = normalizeTalkThruInterest({ ...valid, requestType, city: ' Miami ' });
    assert.equal(result.city, 'Miami');
    assert.equal(result.requestType, requestType);
    assert.throws(() => normalizeTalkThruInterest({ ...valid, requestType }), error => error.code === 'invalid-argument');
  }
  for (const patch of [{ requestType: 'other' }, { requestType: '' }, { requestType: 1 }, { city: 'x'.repeat(121) }, { city: {} }]) {
    assert.throws(() => normalizeTalkThruInterest({ ...valid, ...patch }), error => error.code === 'invalid-argument');
  }
});

test('includes service and city in applicant and admin email with HTML escaping', () => {
  const interest = normalizeTalkThruInterest({ ...valid, requestType: 'founding', city: 'Miami <test>' });
  for (const build of [buildTalkThruApplicantEmail, buildTalkThruAdminEmail]) {
    const content = build(interest);
    assert.match(content.text, /Founding-agent seat/);
    assert.match(content.text, /City \/ market: Miami <test>/);
    assert.match(content.html, /Miami &lt;test&gt;/);
    assert.doesNotMatch(content.html, /Miami <test>/);
  }
  assert.match(buildTalkThruAdminEmail({ ...valid, requestType: 'done_for_you' }).text, /Done For You \(\$199\/listing\)/);
});
