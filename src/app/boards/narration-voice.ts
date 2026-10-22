import type { BoardTranslationLanguage } from './board-translation';

export function browserNarrationVoice<T extends { lang: string }>(
  voices: readonly T[], language: BoardTranslationLanguage,
): T | null {
  const locale = ({ en: 'en-US', fr: 'fr-FR', ja: 'ja-JP', pt: 'pt-BR', es: 'es-US', de: 'de-DE', zh: 'zh-CN' } as const)[language];
  const normalize = (value: string) => value.toLowerCase().replace('_', '-');
  return voices.find((voice) => normalize(voice.lang) === locale.toLowerCase())
    ?? voices.find((voice) => language === 'zh'
      ? /^(?:zh-(?:cn|hans)(?:-|$)|cmn(?:-|$))/.test(normalize(voice.lang))
      : normalize(voice.lang) === language || normalize(voice.lang).startsWith(`${language}-`))
    ?? null;
}

export function narrationUnavailableNotice(language: BoardTranslationLanguage): string {
  return ({
    en: 'Narration is unavailable for this card.',
    de: 'Die Sprachausgabe ist in dieser Sprache nicht verfügbar. Sie können die übersetzte Karte weiterhin lesen.',
    zh: '此语言的语音讲解暂不可用。您仍然可以阅读翻译后的卡片。',
    fr: 'La narration dans cette langue est indisponible. Vous pouvez toujours lire la fiche traduite.',
    ja: 'この言語の音声ガイドは利用できません。翻訳されたカードは引き続き読めます。',
    pt: 'A narração neste idioma não está disponível. Você ainda pode ler o cartão traduzido.',
    es: 'La narración no está disponible en este idioma. Aún puedes leer la tarjeta traducida.',
  } as const)[language];
}
