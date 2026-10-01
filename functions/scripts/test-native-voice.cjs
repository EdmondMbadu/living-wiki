const assert = require('node:assert/strict');
const { voiceMatchesNativeLocale, selectNativeVoice } = require('../lib/native-voice.js');

assert.equal(voiceMatchesNativeLocale({ verified_languages: [{ language: 'pt', locale: 'pt-BR' }] }, 'pt'), true);
assert.equal(voiceMatchesNativeLocale({ verified_languages: [{ language: 'pt', locale: 'pt-BR', model_id: 'eleven_multilingual_v2' }] }, 'pt', 'eleven_multilingual_v2'), true);
assert.equal(voiceMatchesNativeLocale({ verified_languages: [{ language: 'pt', locale: 'pt-BR', model_id: 'eleven_turbo_v2_5' }] }, 'pt', 'eleven_multilingual_v2'), false);
assert.equal(voiceMatchesNativeLocale({ verified_languages: [{ language: 'Portuguese', accent: 'Brazilian' }] }, 'pt'), true);
assert.equal(voiceMatchesNativeLocale({ verified_languages: [{ language: 'pt', locale: 'pt-PT', accent: 'European Portuguese' }] }, 'pt'), false);
assert.equal(voiceMatchesNativeLocale({ verified_languages: [{ language: 'pt', locale: 'pt-BR', accent: 'pt-european' }] }, 'pt'), false);
assert.equal(voiceMatchesNativeLocale({ verified_languages: [{ language: 'fr', locale: 'fr-FR' }] }, 'fr'), true);
assert.equal(voiceMatchesNativeLocale({ verified_languages: [{ language: 'ja', locale: 'ja-JP' }] }, 'ja'), true);
assert.equal(voiceMatchesNativeLocale({ verified_languages: [{ language: 'en', locale: 'en-US', accent: 'American' }] }, 'ja'), false);
assert.equal(voiceMatchesNativeLocale({ name: 'French storyteller' }, 'fr'), false);
const accountVoices = [
  { voice_id: 'english', labels: { language: 'en' }, verified_languages: [{ language: 'en', locale: 'en-US', model_id: 'eleven_multilingual_v2' }] },
  { voice_id: 'portuguese', labels: { language: 'en', use_case: 'narrative_story' }, verified_languages: [{ language: 'pt', locale: 'pt-BR', accent: 'pt-brazilian', model_id: 'eleven_multilingual_v2' }] },
];
assert.equal(selectNativeVoice(accountVoices, 'pt', 'eleven_multilingual_v2')?.voice_id, 'portuguese');
assert.equal(selectNativeVoice(accountVoices, 'pt', 'eleven_multilingual_v2', 'portuguese')?.voice_id, 'portuguese');
assert.equal(selectNativeVoice(accountVoices, 'ja', 'eleven_multilingual_v2'), null);
console.log('Native voice locale checks passed.');
