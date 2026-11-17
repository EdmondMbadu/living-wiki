import type { BoardTranslationLanguage } from './board-translation';

type VerifiedLanguage = { language?: unknown; locale?: unknown; accent?: unknown; model_id?: unknown };

// Finding a better accent is optional; provider/metadata failures must not
// prevent the originally selected voice from speaking the requested language.
export async function tryNativeVoice<T>(lookup: () => Promise<T | null>, onError: (error: unknown) => void): Promise<T | null> {
  try {
    return await lookup();
  } catch (error) {
    onError(error);
    return null;
  }
}

// Use voice metadata, never an avatar's name or appearance, for this match.
export function voiceGender(voice: { labels?: unknown }): string | null {
  const labels = voice.labels && typeof voice.labels === 'object' && !Array.isArray(voice.labels)
    ? voice.labels as Record<string, unknown> : {};
  if (typeof labels['gender'] !== 'string') return null;
  const gender = labels['gender'].trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  if (!gender || ['unknown', 'unspecified', 'other'].includes(gender)) return null;
  if (gender === 'feminine') return 'female';
  if (gender === 'masculine') return 'male';
  if (gender === 'nonbinary' || gender === 'non binary') return 'non-binary';
  if (gender === 'gender neutral') return 'neutral';
  return gender;
}

const nativeLocale: Record<Exclude<BoardTranslationLanguage, 'en'>, {
  locale: string;
  language: string;
  accent: RegExp;
}> = {
  it: { locale: 'it-it', language: 'italian', accent: /italian|italiano|italy/i },
  ko: { locale: 'ko-kr', language: 'korean', accent: /korean|seoul|south korea/i },
  ar: { locale: 'ar-sa', language: 'arabic', accent: /modern standard|standard arabic|fusha|فصحى/i },
  hi: { locale: 'hi-in', language: 'hindi', accent: /hindi|हिन्दी|हिंदी/i },
  ru: { locale: 'ru-ru', language: 'russian', accent: /russian|русский/i },
  de: { locale: 'de-de', language: 'german', accent: /german|deutsch|germany/i },
  zh: { locale: 'zh-cn', language: 'chinese', accent: /mandarin|putonghua|mainland|standard chinese/i },
  fr: { locale: 'fr-fr', language: 'french', accent: /franc(e|ais|aise)|paris/i },
  ja: { locale: 'ja-jp', language: 'japanese', accent: /japan|tokyo/i },
  pt: { locale: 'pt-br', language: 'portuguese', accent: /brazil|brasil/i },
  // Latin American Spanish is preferred (scored higher), but any verified
  // Spanish voice qualifies so narration never disappears for want of one.
  es: { locale: 'es-mx', language: 'spanish', accent: /latin|mexic|colomb|argentin|chil|peru|venezuel|caribbean|cuba|puerto|neutral|american/i },
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
    if (language === 'zh') {
      const mandarinLanguage = spokenLanguage === 'mandarin' || /^cmn(?:-|$)/.test(locale);
      const differentDialect = /canton|yue|hokkien|taiwan|traditional/i.test(`${locale} ${accent}`)
        || /^(?:zh|cmn)-(?:hk|tw|mo)(?:-|$)/.test(locale);
      const verifiedMandarin = mandarinLanguage || locale === 'zh-cn' || locale === 'zh-hans'
        || target.accent.test(accent);
      return (sameLanguage || mandarinLanguage) && !differentDialect && verifiedMandarin;
    }
    return sameLanguage && !clearlyDifferentRegion
      && (language === 'es' || language === 'de' && locale.startsWith('de-')
        || locale === target.locale || target.accent.test(accent));
  });
}

export function selectNativeVoice<T extends {
  voice_id?: unknown;
  verified_languages?: unknown;
  labels?: unknown;
  category?: unknown;
}>(voices: readonly T[], language: Exclude<BoardTranslationLanguage, 'en'>, modelId?: string, preferredVoiceId?: string, requiredGender?: string | null): T | null {
  const gender = voiceGender({ labels: { gender: requiredGender } });
  const matches = voices.filter((voice) => voiceMatchesNativeLocale(voice, language, modelId)
    && (!gender || voiceGender(voice) === gender));
  // Prefer voices trained primarily in the target language over English voices
  // with multilingual verification, which may retain their English accent.
  const primaryNativeMatches = matches.filter((voice) => {
    const labels = voice.labels && typeof voice.labels === 'object' && !Array.isArray(voice.labels)
      ? voice.labels as Record<string, unknown> : {};
    const primaryLanguage = String(labels['language'] ?? '').trim().toLowerCase().replace('_', '-');
    return primaryLanguage.split('-')[0] === language || primaryLanguage === nativeLocale[language].language;
  });
  // With gender preservation, absence of a primary-native match means the
  // caller keeps the original voice, rather than choosing another English one.
  const eligible = gender || primaryNativeMatches.length ? primaryNativeMatches : matches;
  const preferred = eligible.find((voice) => voice.voice_id === preferredVoiceId);
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
  return eligible.sort((a, b) => score(b) - score(a))[0] ?? null;
}
