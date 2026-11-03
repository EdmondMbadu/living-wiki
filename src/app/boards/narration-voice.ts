import { contentLanguageDetails } from '../../../functions/src/content-language';
import type { BoardTranslationLanguage } from './board-translation';

export function browserNarrationVoice<T extends { lang: string }>(
  voices: readonly T[], language: BoardTranslationLanguage,
): T | null {
  const locale = contentLanguageDetails(language).locale;
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
    it: 'La narrazione in questa lingua non è disponibile. Puoi comunque leggere la scheda tradotta.',
    ko: '이 언어의 음성 안내를 사용할 수 없습니다. 번역된 카드는 계속 읽을 수 있습니다.',
    ar: 'السرد الصوتي غير متاح بهذه اللغة. لا يزال بإمكانك قراءة البطاقة المترجمة.',
    hi: 'इस भाषा में ऑडियो विवरण उपलब्ध नहीं है। आप अनुवादित कार्ड पढ़ सकते हैं।',
    ru: 'Озвучивание на этом языке недоступно. Вы можете прочитать перевод карточки.',
    de: 'Die Sprachausgabe ist in dieser Sprache nicht verfügbar. Sie können die übersetzte Karte weiterhin lesen.',
    zh: '此语言的语音讲解暂不可用。您仍然可以阅读翻译后的卡片。',
    fr: 'La narration dans cette langue est indisponible. Vous pouvez toujours lire la fiche traduite.',
    ja: 'この言語の音声ガイドは利用できません。翻訳されたカードは引き続き読めます。',
    pt: 'A narração neste idioma não está disponível. Você ainda pode ler o cartão traduzido.',
    es: 'La narración no está disponible en este idioma. Aún puedes leer la tarjeta traducida.',
  } as const)[language];
}
