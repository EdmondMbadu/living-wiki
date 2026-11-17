export type AtlasRealtimeVoiceSelection = {
  voiceId: string;
  name: string;
  accent: string | null;
  score: number;
  source: 'native-language' | 'wiki' | 'global-default';
};

type VoiceCandidate = {
  voiceId: string | null;
  name: string | null;
  available: boolean;
};

export function selectAtlasRealtimeVoice(options: {
  overridesEnabled: boolean;
  accent: string | null;
  nativeVoice?: Omit<AtlasRealtimeVoiceSelection, 'source'> | null;
  wikiVoice: VoiceCandidate;
  globalDefaultVoice: VoiceCandidate;
}): AtlasRealtimeVoiceSelection | null {
  if (!options.overridesEnabled) {
    return null;
  }

  // A saved avatar voice may speak the requested language with its original
  // accent. A resolved native voice takes priority for translated sessions.
  if (options.nativeVoice) {
    return { ...options.nativeVoice, source: 'native-language' };
  }

  if (options.wikiVoice.available && options.wikiVoice.voiceId) {
    return {
      voiceId: options.wikiVoice.voiceId,
      name: options.wikiVoice.name ?? 'LivingWiki voice',
      accent: options.accent,
      score: Number.MAX_SAFE_INTEGER,
      source: 'wiki',
    };
  }

  if (options.globalDefaultVoice.available && options.globalDefaultVoice.voiceId) {
    return {
      voiceId: options.globalDefaultVoice.voiceId,
      name: options.globalDefaultVoice.name ?? 'LivingWiki default voice',
      accent: options.accent,
      score: Number.MAX_SAFE_INTEGER,
      source: 'global-default',
    };
  }

  return null;
}
