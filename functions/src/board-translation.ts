import { isContentLanguage, type ContentLanguage } from './content-language';
import { createHash } from 'node:crypto';
import { collectBoardTranslationSegments, detectBoardSourceLanguage, type BoardTranslationSegment } from './board-translation-source';
export { collectBoardTranslationSegments, detectBoardSourceLanguage, isOriginalEnglish, type BoardTranslationSegment } from './board-translation-source';

export type BoardTranslationLanguage = ContentLanguage;
export interface BoardTranslationSource {
  segments: BoardTranslationSegment[];
  fingerprint: string;
  sourceLanguage: BoardTranslationLanguage;
  sourceCharacters: number;
}
const maximumFieldCharacters = 8_000;
export const BOARD_TRANSLATION_SCHEMA_VERSION = 3;
export const isBoardTranslationLanguage = isContentLanguage;

export function extractBoardTranslationSource(value: unknown): BoardTranslationSource {
  const segments = collectBoardTranslationSegments(value);
  const fingerprint = createHash('sha256')
    .update(`${BOARD_TRANSLATION_SCHEMA_VERSION}:${JSON.stringify(segments)}`)
    .digest('hex');
  return {
    segments, fingerprint,
    sourceLanguage: detectBoardSourceLanguage(segments.map((segment) => segment.text).join('\n')),
    sourceCharacters: segments.reduce((total, segment) => total + segment.text.length, 0),
  };
}

export function normalizeTranslatedBoardSegments(
  source: readonly BoardTranslationSegment[],
  translated: readonly BoardTranslationSegment[],
): BoardTranslationSegment[] {
  const sourceKeys = new Set(source.map((segment) => segment.key));
  const translations = new Map<string, string>();
  for (const segment of translated) {
    const key = typeof segment?.key === 'string' ? segment.key : '';
    const text = typeof segment?.text === 'string' ? segment.text.trim() : '';
    if (sourceKeys.has(key) && text) {
      translations.set(key, text.slice(0, maximumFieldCharacters * 2));
    }
  }
  const missing = source.filter((segment) => !translations.has(segment.key));
  if (missing.length) {
    throw new Error(`Translation omitted ${missing.length} of ${source.length} text fields.`);
  }
  return source.map((segment) => ({ key: segment.key, text: translations.get(segment.key)! }));
}

export function missingBoardTranslationSegments(
  source: readonly BoardTranslationSegment[],
  translated: readonly BoardTranslationSegment[],
): BoardTranslationSegment[] {
  const present = new Set(translated.filter((segment) => typeof segment.text === 'string' && segment.text.trim())
    .map((segment) => segment.key));
  return source.filter((segment) => !present.has(segment.key));
}

export function boardTranslationSegmentsComplete(
  source: readonly BoardTranslationSegment[],
  value: unknown,
): value is BoardTranslationSegment[] {
  if (!Array.isArray(value) || value.length !== source.length) return false;
  const expected = new Set(source.map((segment) => segment.key));
  const seen = new Set<string>();
  for (const segment of value) {
    if (!segment || typeof segment !== 'object') return false;
    const key = (segment as BoardTranslationSegment).key;
    const text = (segment as BoardTranslationSegment).text;
    if (typeof key !== 'string' || typeof text !== 'string' || !text.trim()
      || !expected.has(key) || seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}
