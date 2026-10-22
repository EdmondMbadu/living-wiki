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
// Spanish: any verified Spanish voice qualifies; Latin American voices are preferred.
assert.equal(voiceMatchesNativeLocale({ verified_languages: [{ language: 'es', locale: 'es-MX', accent: 'mexican' }] }, 'es'), true);
assert.equal(voiceMatchesNativeLocale({ verified_languages: [{ language: 'es', locale: 'es-ES', accent: 'castilian' }] }, 'es'), true);
assert.equal(voiceMatchesNativeLocale({ verified_languages: [{ language: 'pt', locale: 'pt-BR' }] }, 'es'), false);
const spanishVoices = [
  { voice_id: 'spain', labels: { language: 'es', use_case: 'narrative_story' }, verified_languages: [{ language: 'es', locale: 'es-ES', accent: 'castilian', model_id: 'eleven_multilingual_v2' }] },
  { voice_id: 'latam', labels: { language: 'es' }, verified_languages: [{ language: 'es', locale: 'es-MX', accent: 'latin american', model_id: 'eleven_multilingual_v2' }] },
];
assert.equal(selectNativeVoice(spanishVoices, 'es', 'eleven_multilingual_v2')?.voice_id, 'latam');
assert.equal(selectNativeVoice([spanishVoices[0]], 'es', 'eleven_multilingual_v2')?.voice_id, 'spain');
console.log('Native voice locale checks passed.');

const native = (language, locale, accent = '', model_id = 'eleven_multilingual_v2') => ({ verified_languages: [{ language, locale, accent, model_id }] });
assert.equal(voiceMatchesNativeLocale(native('de','de-DE'), 'de', 'eleven_multilingual_v2'), true);
assert.equal(voiceMatchesNativeLocale(native('de','de-AT'), 'de', 'eleven_multilingual_v2'), true);
assert.equal(voiceMatchesNativeLocale(native('zh','zh-CN','mandarin'), 'zh', 'eleven_multilingual_v2'), true);
assert.equal(voiceMatchesNativeLocale(native('Mandarin','cmn-CN'), 'zh', 'eleven_multilingual_v2'), true);
assert.equal(voiceMatchesNativeLocale(native('Mandarin',''), 'zh', 'eleven_multilingual_v2'), true);
assert.equal(voiceMatchesNativeLocale(native('zh','zh-Hans'), 'zh', 'eleven_multilingual_v2'), true);
assert.equal(voiceMatchesNativeLocale(native('zh','zh-HK','cantonese'), 'zh'), false);
assert.equal(voiceMatchesNativeLocale(native('zh','zh-TW','Mandarin'), 'zh'), false);
assert.equal(voiceMatchesNativeLocale(native('Mandarin','cmn-TW'), 'zh'), false);
assert.equal(voiceMatchesNativeLocale(native('ja','ja-JP'), 'zh'), false);
assert.equal(voiceMatchesNativeLocale(native('zh','zh-CN','mandarin','other-model'), 'zh','eleven_multilingual_v2'), false);
assert.equal(voiceMatchesNativeLocale(native('en','en-US'), 'de'), false);
for (const language of ['de','zh']) {
 const matching = { voice_id: language, ...native(language, language === 'de' ? 'de-DE' : 'zh-CN') };
 assert.equal(selectNativeVoice([...accountVoices,matching],language,'eleven_multilingual_v2')?.voice_id,language);
}
