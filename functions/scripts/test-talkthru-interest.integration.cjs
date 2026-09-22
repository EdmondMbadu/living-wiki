const { test } = require('node:test');
const assert = require('node:assert/strict');
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Firestore emulator required.');
process.env.GCLOUD_PROJECT = 'demo-living-wiki';
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'demo-living-wiki' });

const { db } = require('../lib/firebase');
const { submitTalkThruInterest } = require('../lib/talkthru-interest');
const payload = {
  role: 'agency', name: 'Example Agent', email: 'agent@example.test',
  agency: 'Example Realty', listing: 'https://example.test/home', consent: true,
};
const send = (data, ip = '192.0.2.42') => submitTalkThruInterest.run({ data, rawRequest: { ip } });

test('saves a consented inquiry but silently discards honeypots', async () => {
  assert.deepEqual(await send({ ...payload, website: 'spam.test' }), { received: true });
  assert.equal((await db.collection('talkthru_interests').get()).size, 0);
  assert.deepEqual(await send(payload), { received: true });
  const entries = await db.collection('talkthru_interests').get();
  assert.equal(entries.size, 1);
  assert.equal(entries.docs[0].data().email, 'agent@example.test');
  assert.equal(entries.docs[0].data().source, '/talkthrus');
});

test('rate limits repeat anonymous submissions', async () => {
  await send(payload);
  await send(payload);
  await assert.rejects(send(payload), error => error.code === 'resource-exhausted');
  assert.equal((await db.collection('talkthru_interests').get()).size, 3);
});
