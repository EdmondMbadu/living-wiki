import type { BoardTranslationLanguage } from './board-translation';

type VerifiedLanguage = { language?: unknown; locale?: unknown; accent?: unknown };

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
export function voiceMatchesNativeLocale(voice: { verified_languages?: unknown }, language: BoardTranslationLanguage): boolean {
  if (language === 'en') return true;
  if (!Array.isArray(voice.verified_languages)) return false;
  const target = nativeLocale[language];
  return (voice.verified_languages as VerifiedLanguage[]).some((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const locale = String(entry.locale ?? '').trim().toLowerCase().replace('_', '-');
    const spokenLanguage = String(entry.language ?? '').trim().toLowerCase();
    const sameLanguage = locale === target.locale
      || locale.startsWith(`${language}-`)
      || spokenLanguage === language
      || spokenLanguage === target.language;
    return sameLanguage && (locale === target.locale || target.accent.test(String(entry.accent ?? '')));
  });
}
