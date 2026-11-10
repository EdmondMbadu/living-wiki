import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, test } from 'node:test';

assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'Studio voice tests require the Firestore emulator.');
process.env.GCLOUD_PROJECT = 'demo-living-wiki';
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'demo-living-wiki', storageBucket: 'demo-living-wiki.appspot.com' });
process.env.ELEVENLABS_API_KEY = 'studio-voice-test';
const require = createRequire(new URL('../../functions/package.json', import.meta.url));
const { db } = require('./lib/firebase');
const { designStudioNarratorVoice, saveStudioNarratorVoice, getPersonalNarratorVoice } = require('./lib/index');

function request(uid, data) {
  return { auth: { uid, token: {} }, data };
}

after(async () => db.terminate());

test('Studio keeps previews private and saves one chosen voice through retries', async (context) => {
  const uid = `studio-creator-${Date.now()}`;
  let saves = 0;
  const fetchStub = context.mock.method(globalThis, 'fetch', async (url, options) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://api.elevenlabs.io');
    const body = JSON.parse(options.body);
    if (parsed.pathname === '/v1/text-to-voice/design') {
      assert.match(body.voice_description, /Clear, intelligible human speech in English. Flamingo/);
      assert.ok(body.text.length >= 100);
      return Response.json({
        text: body.text,
        previews: [0, 1, 2].map((index) => ({
          generated_voice_id: `provider-preview-${index}`, audio_base_64: 'AAAA', media_type: 'audio/mpeg',
        })),
      });
    }
    assert.equal(parsed.pathname, '/v1/text-to-voice');
    assert.equal(body.generated_voice_id, 'provider-preview-1');
    saves++;
    if (saves === 1) return new Response('Temporary provider error', { status: 503 });
    return Response.json({ voice_id: 'saved-provider-flamingo' });
  });

  const design = await designStudioNarratorVoice.run(request(uid, { description: 'Flamingo', language: 'en' }));
  assert.deepEqual(design.previews.map(({ index }) => index), [0, 1, 2]);
  assert.doesNotMatch(JSON.stringify(design), /provider-preview/);
  const selection = { sessionId: design.sessionId, index: 1, name: 'Flamingo' };

  await assert.rejects(saveStudioNarratorVoice.run(request('different-user', selection)), { code: 'failed-precondition' });
  await assert.rejects(saveStudioNarratorVoice.run(request(uid, selection)), { code: 'failed-precondition' });
  const saved = await saveStudioNarratorVoice.run(request(uid, selection));
  const repeated = await saveStudioNarratorVoice.run(request(uid, selection));
  assert.equal(saves, 2);
  assert.equal(repeated.voice.id, saved.voice.id);

  const library = await getPersonalNarratorVoice.run(request(uid, {}));
  assert.equal(library.voices.length, 1);
  assert.equal(library.voice.source, 'designed');
  assert.equal(library.voice.narratorVoiceId, `personal-voice:${design.sessionId}`);
  assert.equal(library.voice.designLanguage, 'en');
  assert.doesNotMatch(JSON.stringify(library), /saved-provider-flamingo/);
  await assert.rejects(designStudioNarratorVoice.run(request(uid, { description: 'Lion', language: 'en' })), { code: 'resource-exhausted' });
  assert.equal(fetchStub.mock.callCount(), 3);
});
