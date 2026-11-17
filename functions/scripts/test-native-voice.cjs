const assert = require('node:assert/strict');
const { voiceMatchesNativeLocale, selectNativeVoice, voiceGender } = require('../lib/native-voice.js');

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

for (const [language, locale] of [['it','it-IT'],['ko','ko-KR'],['ar','ar-SA'],['hi','hi-IN'],['ru','ru-RU']]) {
  const voice = { voice_id: language, ...native(language, locale) };
  assert.equal(voiceMatchesNativeLocale(voice, language, 'eleven_multilingual_v2'), true);
  assert.equal(selectNativeVoice([...accountVoices, voice], language, 'eleven_multilingual_v2')?.voice_id, language);
  assert.equal(selectNativeVoice(accountVoices, language, 'eleven_multilingual_v2'), null);
  assert.equal(voiceMatchesNativeLocale(native(language,locale,'','wrong-model'), language, 'eleven_multilingual_v2'), false);
  assert.equal(voiceMatchesNativeLocale(native('en','en-US'), language), false);
  assert.equal(voiceMatchesNativeLocale({labels:{language}}, language), false);
}

assert.equal(voiceGender({ labels: { gender: ' Feminine ' } }), 'female');
assert.equal(voiceGender({ labels: { gender: 'MASCULINE' } }), 'male');
assert.equal(voiceGender({ labels: { gender: 'non_binary' } }), 'non-binary');
assert.equal(voiceGender({ labels: { gender: 'gender neutral' } }), 'neutral');
assert.equal(voiceGender({ labels: { gender: 'unknown' } }), null);
assert.equal(voiceGender({ name: 'Amy' }), null);

// Keep voice gender across every supported translated language. The female
// candidate deliberately scores higher; gender is a requirement, not a bonus.
for (const [language, locale] of [
  ['fr', 'fr-FR'], ['es', 'es-MX'], ['pt', 'pt-BR'], ['ja', 'ja-JP'],
  ['de', 'de-DE'], ['zh', 'zh-CN'], ['it', 'it-IT'], ['ko', 'ko-KR'],
  ['ar', 'ar-SA'], ['hi', 'hi-IN'], ['ru', 'ru-RU'],
]) {
  const female = { voice_id: 'female-native', ...native(language, locale),
    labels: { gender: 'female', language, use_case: 'narrative_story', descriptive: 'warm' }, category: 'professional' };
  const male = { voice_id: 'male-native', ...native(language, locale), labels: { gender: 'male', language } };
  const unknown = { voice_id: 'unknown-gender', ...native(language, locale) };
  const voices = [female, male, unknown];
  assert.equal(selectNativeVoice(voices, language, 'eleven_multilingual_v2', undefined, 'male')?.voice_id, male.voice_id);
  assert.equal(selectNativeVoice(voices, language, 'eleven_multilingual_v2', undefined, 'female')?.voice_id, female.voice_id);
  assert.equal(selectNativeVoice(voices, language, 'eleven_multilingual_v2', female.voice_id, 'male')?.voice_id, male.voice_id);
  assert.equal(selectNativeVoice([female, unknown], language, undefined, undefined, 'male'), null);
  assert.equal(selectNativeVoice([male, unknown], language, undefined, undefined, 'female'), null);
  assert.equal(selectNativeVoice(voices, language, 'unsupported-model', undefined, 'female'), null);
  const neutral = { voice_id: 'neutral-native', ...native(language, locale), labels: { gender: 'neutral', language } };
  assert.equal(selectNativeVoice([...voices, neutral], language, undefined, undefined, 'neutral')?.voice_id, neutral.voice_id);
}

console.log('Native voice gender preservation checks passed.');

// The original English voice can have verified French samples. Keep its gender
// without keeping an English-trained voice when a native French one exists.
const englishMale = { voice_id: 'english-male', ...native('fr', 'fr-FR', 'French'),
  labels: { language: 'en', gender: 'male' } };
const frenchMale = { voice_id: 'french-male', ...native('fr', 'fr-FR'),
  labels: { language: 'fr', gender: 'male' } };
const frenchFemale = { voice_id: 'french-female', ...native('fr', 'fr-FR'),
  labels: { language: 'fr', gender: 'female' } };
assert.equal(selectNativeVoice([englishMale, frenchMale, frenchFemale], 'fr', undefined, englishMale.voice_id, 'male')?.voice_id, frenchMale.voice_id);
assert.equal(selectNativeVoice([frenchMale, frenchFemale], 'fr', undefined, frenchMale.voice_id, 'female')?.voice_id, frenchFemale.voice_id);
// No native match: return control to the caller so it keeps the exact chosen
// voice, rather than substituting another English voice or changing gender.
assert.equal(selectNativeVoice([englishMale, frenchFemale], 'fr', undefined, englishMale.voice_id, 'male'), null);
