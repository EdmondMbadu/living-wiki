import type { BoardTranslationLanguage } from './board-translation';

type VerifiedLanguage = { language?: unknown; locale?: unknown; accent?: unknown; model_id?: unknown };

const nativeLocale: Record<Exclude<BoardTranslationLanguage, 'en'>, {
  locale: string;
  language: string;
  accent: RegExp;
}> = {
  fr: { locale: 'fr-fr', language: 'french', accent: /franc(e|ais|aise)|paris/i },
  ja: { locale: 'ja-jp', language: 'japanese', accent: /japan|tokyo/i },
  pt: { locale: 'pt-br', language: 'portuguese', accent: /brazil|brasil/i },
};

// A multilingual model can read translated text with the wrong accent. Only a
// verified locale or verified native accent qualifies for translated speech.
export function voiceMatchesNativeLocale(
  voice: { verified_languages?: unknown }, language: BoardTranslationLanguage, modelId?: string,
): boolean {
  if (language === 'en') return true;
  if (!Array.isArray(voice.verified_languages)) return false;
  const target = nativeLocale[language];
  return (voice.verified_languages as VerifiedLanguage[]).some((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    if (modelId && entry.model_id !== modelId) return false;
    const locale = String(entry.locale ?? '').trim().toLowerCase().replace('_', '-');
    const spokenLanguage = String(entry.language ?? '').trim().toLowerCase();
    const accent = String(entry.accent ?? '').trim().toLowerCase();
    const sameLanguage = locale === target.locale
      || locale.startsWith(`${language}-`)
      || spokenLanguage === language
      || spokenLanguage === target.language;
    const clearlyDifferentRegion = language === 'pt'
      ? /europe|portugal|african/.test(accent)
      : language === 'fr'
        ? /quebec|canad|acadian|belg|swiss|african/.test(accent)
        : false;
    return sameLanguage && !clearlyDifferentRegion && (locale === target.locale || target.accent.test(accent));
  });
}

export function selectNativeVoice<T extends {
  voice_id?: unknown;
  verified_languages?: unknown;
  labels?: unknown;
  category?: unknown;
}>(voices: readonly T[], language: Exclude<BoardTranslationLanguage, 'en'>, modelId?: string, preferredVoiceId?: string): T | null {
  const matches = voices.filter((voice) => voiceMatchesNativeLocale(voice, language, modelId));
  const preferred = matches.find((voice) => voice.voice_id === preferredVoiceId);
  if (preferred) return preferred;

  const score = (voice: T): number => {
    const labels = voice.labels && typeof voice.labels === 'object' && !Array.isArray(voice.labels)
      ? voice.labels as Record<string, unknown> : {};
    const target = nativeLocale[language];
    const verified = voice.verified_languages as VerifiedLanguage[];
    const nativeEntries = verified.filter((entry) => voiceMatchesNativeLocale({ verified_languages: [entry] }, language, modelId));
    const regionalAccent = nativeEntries.some((entry) => target.accent.test(String(entry.accent ?? '')));
    const exactLocale = nativeEntries.some((entry) => String(entry.locale ?? '').toLowerCase().replace('_', '-') === target.locale);
    const descriptive = String(labels['descriptive'] ?? '').toLowerCase();
    const storytellerStyle = /warm|pleasant|calm|soft|relaxed|professional/.test(descriptive);
    return (regionalAccent ? 20 : 0)
      + (exactLocale ? 10 : 0)
      + (String(labels['language'] ?? '').toLowerCase() === language ? 8 : 0)
      + (target.accent.test(String(labels['accent'] ?? '')) ? 8 : 0)
      + (labels['use_case'] === 'narrative_story' ? 4 : 0)
      + (voice.category === 'professional' ? 2 : 0)
      + (storytellerStyle ? 4 : 0);
  };
  return matches.sort((a, b) => score(b) - score(a))[0] ?? null;
}
