const assert = require('node:assert/strict');
const { selectAtlasRealtimeVoice } = require('../lib/atlas-realtime-voice.js');
const { tryNativeVoice } = require('../lib/native-voice.js');

const clearDefault = {
  voiceId: 'clear-default',
  name: 'Warm Storyteller',
  available: true,
};

// Regression: French event guides used to resolve Camille, then replace her
// with the avatar's available English voice (Jessa).
const frenchVoice = {
  voiceId: 'camille-french', name: 'Camille Martin', accent: null, score: 100,
};
assert.deepEqual(
  selectAtlasRealtimeVoice({
    overridesEnabled: true,
    accent: null,
    nativeVoice: frenchVoice,
    wikiVoice: { voiceId: 'jessa-english', name: 'Jessa', available: true },
    globalDefaultVoice: clearDefault,
  }),
  { ...frenchVoice, source: 'native-language' },
);

assert.equal(
  selectAtlasRealtimeVoice({
    overridesEnabled: false,
    accent: null,
    nativeVoice: frenchVoice,
    wikiVoice: { voiceId: 'jessa-english', name: 'Jessa', available: true },
    globalDefaultVoice: clearDefault,
  }),
  null,
);

assert.deepEqual(
  selectAtlasRealtimeVoice({
    overridesEnabled: true,
    accent: 'American',
    wikiVoice: { voiceId: 'george', name: 'George Washington', available: true },
    globalDefaultVoice: clearDefault,
  }),
  {
    voiceId: 'george',
    name: 'George Washington',
    accent: 'American',
    score: Number.MAX_SAFE_INTEGER,
    source: 'wiki',
  },
);

assert.deepEqual(
  selectAtlasRealtimeVoice({
    overridesEnabled: true,
    accent: 'American',
    wikiVoice: { voiceId: null, name: null, available: false },
    globalDefaultVoice: clearDefault,
  }),
  {
    voiceId: 'clear-default',
    name: 'Warm Storyteller',
    accent: 'American',
    score: Number.MAX_SAFE_INTEGER,
    source: 'global-default',
  },
);

assert.equal(
  selectAtlasRealtimeVoice({
    overridesEnabled: false,
    accent: null,
    wikiVoice: { voiceId: 'george', name: 'George Washington', available: true },
    globalDefaultVoice: clearDefault,
  }),
  null,
);

assert.equal(
  selectAtlasRealtimeVoice({
    overridesEnabled: true,
    accent: null,
    wikiVoice: { voiceId: 'unavailable-custom', name: 'Unavailable', available: false },
    globalDefaultVoice: { ...clearDefault, available: false },
  }),
  null,
);

console.log('Atlas realtime voice isolation checks passed.');

async function testOptionalNativeVoices() {
  const errors = [];
  const reportError = (error) => errors.push(error);
  assert.equal(await tryNativeVoice(async () => frenchVoice, reportError), frenchVoice);
  assert.equal(errors.length, 0);

  for (const original of [
    { voiceId: 'jessa-english', name: 'Jessa', available: true },
    { voiceId: 'mark-english', name: 'Mark', available: true },
    { voiceId: 'personal-voice-id', name: 'My chosen voice', available: true },
  ]) {
    for (const lookup of [
      async () => null, // Missing native language/gender match or metadata.
      async () => { throw new Error('Voice inventory temporarily unavailable'); },
    ]) {
      const nativeVoice = await tryNativeVoice(lookup, reportError);
      const selected = selectAtlasRealtimeVoice({
        overridesEnabled: true, accent: null, nativeVoice,
        wikiVoice: original, globalDefaultVoice: clearDefault,
      });
      assert.equal(selected.voiceId, original.voiceId);
      assert.equal(selected.source, 'wiki');
    }
  }
  assert.equal(errors.length, 3);
  const nativeVoice = await tryNativeVoice(async () => null, reportError);
  assert.equal(selectAtlasRealtimeVoice({
    overridesEnabled: true, accent: null, nativeVoice,
    wikiVoice: { voiceId: null, name: null, available: false }, globalDefaultVoice: clearDefault,
  }).voiceId, clearDefault.voiceId);
  console.log('Optional native voice fallback checks passed.');
}

testOptionalNativeVoices().catch((error) => { console.error(error); process.exitCode = 1; });
