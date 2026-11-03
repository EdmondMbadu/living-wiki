import { contentLanguageDetails } from '../../../functions/src/content-language';

export interface SupportedLocale {
  readonly id: 'en-US' | 'fr' | 'ja' | 'pt-BR' | 'es-419' | 'de' | 'zh-Hans' | 'it' | 'ko' | 'ar' | 'hi' | 'ru';
  readonly language: 'en' | 'fr' | 'ja' | 'pt' | 'es' | 'de' | 'zh' | 'it' | 'ko' | 'ar' | 'hi' | 'ru';
  readonly subPath: '' | 'fr' | 'ja' | 'pt' | 'es' | 'de' | 'zh' | 'it' | 'ko' | 'ar' | 'hi' | 'ru';
  readonly label: string;
  readonly flag: string;
  readonly direction: 'ltr' | 'rtl';
}

export const SUPPORTED_LOCALES: readonly SupportedLocale[] = [
  { id: 'en-US', language: 'en', flag: contentLanguageDetails('en').flag, subPath: '', label: 'English', direction: 'ltr' },
  { id: 'fr', language: 'fr', flag: contentLanguageDetails('fr').flag, subPath: 'fr', label: 'Français', direction: 'ltr' },
  { id: 'ja', language: 'ja', flag: contentLanguageDetails('ja').flag, subPath: 'ja', label: '日本語', direction: 'ltr' },
  { id: 'pt-BR', language: 'pt', flag: contentLanguageDetails('pt').flag, subPath: 'pt', label: 'Português (Brasil)', direction: 'ltr' },
  { id: 'es-419', language: 'es', flag: contentLanguageDetails('es').flag, subPath: 'es', label: 'Español', direction: 'ltr' },
  { id: 'de', language: 'de', flag: contentLanguageDetails('de').flag, subPath: 'de', label: 'Deutsch', direction: 'ltr' },
  { id: 'zh-Hans', language: 'zh', flag: contentLanguageDetails('zh').flag, subPath: 'zh', label: '简体中文', direction: 'ltr' },
  { id: 'it', language: 'it', flag: contentLanguageDetails('it').flag, subPath: 'it', label: 'Italiano', direction: 'ltr' },
  { id: 'ko', language: 'ko', flag: contentLanguageDetails('ko').flag, subPath: 'ko', label: '한국어', direction: 'ltr' },
  { id: 'ar', language: 'ar', flag: contentLanguageDetails('ar').flag, subPath: 'ar', label: 'العربية', direction: 'rtl' },
  { id: 'hi', language: 'hi', flag: contentLanguageDetails('hi').flag, subPath: 'hi', label: 'हिन्दी', direction: 'ltr' },
  { id: 'ru', language: 'ru', flag: contentLanguageDetails('ru').flag, subPath: 'ru', label: 'Русский', direction: 'ltr' },
];

export const DEFAULT_LOCALE = SUPPORTED_LOCALES[0];
export const LOCALE_STORAGE_KEY = 'livingwiki.locale';

export function supportedLocale(localeId: string | null | undefined): SupportedLocale {
  const normalized = (localeId ?? '').toLowerCase().replaceAll('_', '-');
  return SUPPORTED_LOCALES.find((locale) => locale.id.toLowerCase() === normalized)
    ?? SUPPORTED_LOCALES.find((locale) => locale.language === normalized.split('-')[0])
    ?? DEFAULT_LOCALE;
}

export function localizedPath(pathname: string, target: SupportedLocale): string {
  let localeNeutralPath = pathname.startsWith('/') ? pathname : `/${pathname}`;

  for (const locale of SUPPORTED_LOCALES) {
    if (!locale.subPath) continue;
    const prefix = `/${locale.subPath}`;
    if (localeNeutralPath === prefix) {
      localeNeutralPath = '/';
      break;
    }
    if (localeNeutralPath.startsWith(`${prefix}/`)) {
      localeNeutralPath = localeNeutralPath.slice(prefix.length) || '/';
      break;
    }
  }

  if (!target.subPath) return localeNeutralPath;
  return localeNeutralPath === '/'
    ? `/${target.subPath}/`
    : `/${target.subPath}${localeNeutralPath}`;
}

/** Set the root language/direction in both browser rendering and prerendered pages. */
export function applyDocumentLocale(document: Pick<Document, 'documentElement'>, localeId: string): void {
  const locale = supportedLocale(localeId);
  document.documentElement.lang = locale.id;
  document.documentElement.dir = locale.direction;
}
