/** Pure visitor-language metadata shared by the browser and server.
 * These are content languages, independent of the compiled application locales.
 */
export const CONTENT_LANGUAGES = [
  { id: 'en', label: 'English', shortLabel: 'EN', name: 'English', country: 'United States', locale: 'en-US', direction: 'ltr', flag: '🇺🇸' },
  { id: 'fr', label: 'Français', shortLabel: 'FR', name: 'French', country: 'France', locale: 'fr-FR', direction: 'ltr', flag: '🇫🇷' },
  { id: 'ja', label: '日本語', shortLabel: '日本語', name: 'Japanese', country: 'Japan', locale: 'ja-JP', direction: 'ltr', flag: '🇯🇵' },
  { id: 'pt', label: 'Português (Brasil)', shortLabel: 'PT', name: 'Brazilian Portuguese', country: 'Brazil', locale: 'pt-BR', direction: 'ltr', flag: '🇧🇷' },
  { id: 'es', label: 'Español', shortLabel: 'ES', name: 'Latin American Spanish', country: 'Mexico', locale: 'es-US', direction: 'ltr', flag: '🇪🇸' },
  { id: 'de', label: 'Deutsch', shortLabel: 'DE', name: 'German', country: 'Germany', locale: 'de-DE', direction: 'ltr', flag: '🇩🇪' },
  { id: 'zh', label: '简体中文', shortLabel: '中文', name: 'Simplified Chinese (Mandarin for speech)', country: 'China', locale: 'zh-CN', direction: 'ltr', flag: '🇨🇳' },
  { id: 'it', label: 'Italiano', shortLabel: 'IT', name: 'Italian', country: 'Italy', locale: 'it-IT', direction: 'ltr', flag: '🇮🇹' },
  { id: 'ko', label: '한국어', shortLabel: '한국어', name: 'Korean', country: 'South Korea', locale: 'ko-KR', direction: 'ltr', flag: '🇰🇷' },
  { id: 'ar', label: 'العربية', shortLabel: 'AR', name: 'Modern Standard Arabic', country: '', locale: 'ar-SA', direction: 'rtl', flag: '🌐' },
  { id: 'hi', label: 'हिन्दी', shortLabel: 'हिन्दी', name: 'Hindi', country: 'India', locale: 'hi-IN', direction: 'ltr', flag: '🇮🇳' },
  { id: 'ru', label: 'Русский', shortLabel: 'RU', name: 'Russian', country: 'Russia', locale: 'ru-RU', direction: 'ltr', flag: '🇷🇺' },
] as const;

export type ContentLanguage = typeof CONTENT_LANGUAGES[number]['id'];

export function isContentLanguage(value: unknown): value is ContentLanguage {
  return typeof value === 'string' && CONTENT_LANGUAGES.some((language) => language.id === value);
}

export function contentLanguageDetails(language: ContentLanguage) {
  return CONTENT_LANGUAGES.find((item) => item.id === language)!;
}

/** Match regional browser locale IDs; persisted API preferences remain strict. */
export function contentLanguageForLocale(locale: string | null | undefined): ContentLanguage | null {
  const language = (locale ?? '').trim().toLowerCase().replaceAll('_', '-').split('-')[0];
  return isContentLanguage(language) ? language : null;
}

export function contentLanguageVoicePreference(language: ContentLanguage) {
  const details = contentLanguageDetails(language);
  return {
    languageCode: language,
    language: language === 'zh' ? 'Chinese' : language === 'pt' ? 'Portuguese'
      : language === 'es' ? 'Spanish' : language === 'ar' ? 'Arabic' : details.name,
    country: details.country || null,
    accent: language === 'zh' ? 'Mandarin' : null,
  };
}
