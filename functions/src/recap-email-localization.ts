import type { BoardTranslationSegment } from './board-translation';
import type { ContentLanguage } from './content-language';

export type RecapEmailCopy = (source: string) => string;
type Translate = (
  source: readonly BoardTranslationSegment[], language: ContentLanguage,
) => Promise<BoardTranslationSegment[]>;

function placeholders(text: string): string {
  return (text.match(/\{[a-zA-Z]+\}/g) ?? []).sort().join(',');
}

/** Translate only plain copy. The renderer owns HTML, links, and template interpolation. */
export async function prepareRecapEmailCopy(
  language: ContentLanguage,
  render: (copy: RecapEmailCopy) => unknown,
  translate: Translate,
): Promise<RecapEmailCopy> {
  if (language === 'en') return source => source;

  const keys = new Map<string, string>();
  render(source => {
    if (source.trim() && !keys.has(source)) keys.set(source, `email.${keys.size}`);
    return source;
  });
  if (!keys.size) return source => source;

  const source = [...keys].map(([text, key]) => ({ key, text }));
  const translations = new Map((await translate(source, language)).map(segment => [segment.key, segment.text]));
  const localized = new Map<string, string>();
  for (const segment of source) {
    const text = translations.get(segment.key)?.trim();
    if (!text || placeholders(text) !== placeholders(segment.text)
      || (!/[\r\n]/.test(segment.text) && /[\r\n]/.test(text))) {
      throw new Error('Recap email translation omitted copy or changed a placeholder.');
    }
    localized.set(segment.text, text);
  }
  return text => {
    if (!text.trim()) return text;
    const translation = localized.get(text);
    if (!translation) throw new Error('Recap email copy was not translated.');
    return translation;
  };
}
