import type { BoardTranslationLanguage } from './board-translation';

export function browserNarrationVoice<T extends { lang: string }>(
  voices: readonly T[], language: BoardTranslationLanguage,
): T | null {
  const locale = ({ en: 'en-US', fr: 'fr-FR', ja: 'ja-JP', pt: 'pt-BR' } as const)[language];
  const normalize = (value: string) => value.toLowerCase().replace('_', '-');
  return voices.find((voice) => normalize(voice.lang) === locale.toLowerCase())
    ?? voices.find((voice) => normalize(voice.lang).startsWith(`${language}-`))
    ?? null;
}

export function narrationUnavailableNotice(language: BoardTranslationLanguage): string {
  return ({
    en: 'Narration is unavailable for this card.',
    fr: 'La narration dans cette langue est indisponible. Vous pouvez toujours lire la fiche traduite.',
    ja: 'この言語の音声ガイドは利用できません。翻訳されたカードは引き続き読めます。',
    pt: 'A narração neste idioma não está disponível. Você ainda pode ler o cartão traduzido.',
  } as const)[language];
}
