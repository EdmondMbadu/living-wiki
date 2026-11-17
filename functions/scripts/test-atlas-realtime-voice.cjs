const assert = require('node:assert/strict');
const { selectAtlasRealtimeVoice } = require('../lib/atlas-realtime-voice.js');

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
