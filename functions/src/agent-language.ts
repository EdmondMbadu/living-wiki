import type { BoardTranslationLanguage } from './board-translation';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

export function agentNativeLanguageReadiness(config: unknown, language: Exclude<BoardTranslationLanguage, 'en'>): {
  supported: boolean;
  languageOverride: boolean;
  voiceOverride: boolean;
} {
  const agent = record(config);
  const conversation = record(agent['conversation_config']);
  const defaultAgent = record(conversation['agent']);
  const presets = record(conversation['language_presets']);
  const overrides = record(record(record(agent['platform_settings'])['overrides'])['conversation_config_override']);
  return {
    supported: defaultAgent['language'] === language || Object.prototype.hasOwnProperty.call(presets, language),
    languageOverride: record(overrides['agent'])['language'] === true,
    voiceOverride: record(overrides['tts'])['voice_id'] === true,
  };
}
