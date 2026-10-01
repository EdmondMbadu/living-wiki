const assert = require('node:assert/strict');
const { voiceMatchesNativeLocale } = require('../lib/native-voice.js');

assert.equal(voiceMatchesNativeLocale({ verified_languages: [{ language: 'pt', locale: 'pt-BR' }] }, 'pt'), true);
assert.equal(voiceMatchesNativeLocale({ verified_languages: [{ language: 'Portuguese', accent: 'Brazilian' }] }, 'pt'), true);
assert.equal(voiceMatchesNativeLocale({ verified_languages: [{ language: 'pt', locale: 'pt-PT', accent: 'European Portuguese' }] }, 'pt'), false);
assert.equal(voiceMatchesNativeLocale({ verified_languages: [{ language: 'fr', locale: 'fr-FR' }] }, 'fr'), true);
assert.equal(voiceMatchesNativeLocale({ verified_languages: [{ language: 'ja', locale: 'ja-JP' }] }, 'ja'), true);
assert.equal(voiceMatchesNativeLocale({ verified_languages: [{ language: 'en', locale: 'en-US', accent: 'American' }] }, 'ja'), false);
assert.equal(voiceMatchesNativeLocale({ name: 'French storyteller' }, 'fr'), false);
console.log('Native voice locale checks passed.');
