const assert = require('node:assert/strict');
const { agentNativeLanguageReadiness } = require('../lib/agent-language.js');

const configured = {
  conversation_config: { agent: { language: 'en' }, language_presets: { pt: {}, fr: {}, ja: {} } },
  platform_settings: { overrides: { conversation_config_override: { agent: { language: true }, tts: { voice_id: true } } } },
};
assert.deepEqual(agentNativeLanguageReadiness(configured, 'pt'), {
  supported: true, languageOverride: true, voiceOverride: true,
});
assert.deepEqual(agentNativeLanguageReadiness({ ...configured, conversation_config: { agent: { language: 'en' }, language_presets: {} } }, 'ja'), {
  supported: false, languageOverride: true, voiceOverride: true,
});
assert.deepEqual(agentNativeLanguageReadiness({ ...configured, platform_settings: {} }, 'fr'), {
  supported: true, languageOverride: false, voiceOverride: false,
});
console.log('ElevenLabs agent language readiness checks passed.');
