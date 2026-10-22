import { isBoardTranslationLanguage, type BoardTranslationLanguage } from './board-translation';

export const LIVE_LANGUAGE_STORAGE_KEY = 'livingwiki.liveLanguage';

export function savedLiveLanguage(value: string | null): BoardTranslationLanguage | null {
  return isBoardTranslationLanguage(value) ? value : null;
}

export function liveLanguageEntry(options: {
  saved: string | null; explicit: string | null; ask: boolean;
}): { language: BoardTranslationLanguage; prompt: boolean; translate: boolean } {
  const saved = savedLiveLanguage(options.saved);
  const explicit = savedLiveLanguage(options.explicit);
  const language = explicit ?? saved ?? 'en';
  return { language, prompt: options.ask && !saved,
    translate: options.explicit !== 'original' || !!(explicit || saved) };
}
