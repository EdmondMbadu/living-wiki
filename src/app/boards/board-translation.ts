import { collectBoardTranslationSegments, isOriginalEnglish } from '../../../functions/src/board-translation-source';
import { CONTENT_LANGUAGES, contentLanguageForLocale, isContentLanguage, type ContentLanguage } from '../../../functions/src/content-language';

export type BoardTranslationLanguage = ContentLanguage;

export interface BoardTranslationSegment {
  key: string;
  text: string;
}

export interface BoardTranslationResult {
  boardId: string;
  targetLanguage: BoardTranslationLanguage;
  sourceLanguage: BoardTranslationLanguage;
  fingerprint: string;
  schemaVersion: number;
  expectedSegmentCount: number;
  segments: BoardTranslationSegment[];
  cached: boolean;
  changed: boolean;
}

export const BOARD_TRANSLATION_LANGUAGES = CONTENT_LANGUAGES;

export const BOARD_TRANSLATION_SCHEMA_VERSION = 3;

export const isBoardTranslationLanguage = isContentLanguage;

/** Localized board links translate their content unless the reader requests the original. */
export function boardTranslationLanguageForRoute(
  contentLanguage: string | null,
  localeId: string,
): BoardTranslationLanguage | null {
  if (contentLanguage === 'original') return null;
  if (isBoardTranslationLanguage(contentLanguage)) return contentLanguage;
  const language = contentLanguageForLocale(localeId) ?? 'en';
  return language === 'en' ? null : language;
}

/** Unknown/short foreign text still needs translation; only confirmed English is a no-op. */
export function boardAlreadyInEnglish(board: unknown): boolean {
  if (!board) return false;
  try {
    const segments = collectBoardTranslationSegments(board, Infinity);
    const record = objectRecord(board);
    for (const field of ['socialVideoClosingHeadline', 'socialVideoClosingMessage']) {
      const text = record[field];
      if (typeof text === 'string' && text.trim()) segments.push({key: `board.${field}`, text});
    }
    return isOriginalEnglish(segments);
  }
  catch { return false; }
}

export function normalizeBoardTranslationResult(value: unknown): BoardTranslationResult | null {
  const record = objectRecord(value);
  const boardId = stringValue(record['boardId']).slice(0, 128);
  const targetLanguage = record['targetLanguage'];
  const sourceLanguage = record['sourceLanguage'];
  const fingerprint = stringValue(record['fingerprint']).slice(0, 128);
  if (!boardId
    || !isBoardTranslationLanguage(targetLanguage)
    || !isBoardTranslationLanguage(sourceLanguage)
    || !fingerprint
    || record['schemaVersion'] !== BOARD_TRANSLATION_SCHEMA_VERSION
    || !Number.isInteger(record['expectedSegmentCount'])
    || (record['expectedSegmentCount'] as number) < 0) {
    return null;
  }

  const segments = Array.isArray(record['segments'])
    ? record['segments'].flatMap((value) => {
        const segment = objectRecord(value);
        const key = stringValue(segment['key']).slice(0, 256);
        const text = stringValue(segment['text']).slice(0, 16_000);
        return validTranslationPath(key) && text ? [{ key, text }] : [];
      })
    : [];

  if (segments.length !== record['expectedSegmentCount']
    || new Set(segments.map((segment) => segment.key)).size !== segments.length) {
    return null;
  }

  return {
    boardId,
    targetLanguage,
    sourceLanguage,
    fingerprint,
    schemaVersion: BOARD_TRANSLATION_SCHEMA_VERSION,
    expectedSegmentCount: segments.length,
    segments,
    cached: record['cached'] === true,
    changed: record['changed'] === true,
  };
}

export function applyBoardTranslation<T>(board: T, segments: readonly BoardTranslationSegment[]): T {
  const translated = cloneValue(board) as T;
  for (const segment of segments) {
    if (!validTranslationPath(segment.key) || !segment.text) {
      continue;
    }
    setExistingStringPath(translated, segment.key.split('.'), segment.text);
  }
  return translated;
}

export function boardTranslationLanguageName(language: BoardTranslationLanguage): string {
  return BOARD_TRANSLATION_LANGUAGES.find((option) => option.id === language)?.label ?? 'English';
}

function validTranslationPath(path: string): boolean {
  return /^(?:board\.(?:title|description|backNote|stackCtaLabel|socialVideoClosingHeadline|socialVideoClosingMessage|tourMeta\.(?:paceOrRouteStyle|extras\.\d+)|learningQuiz\.(?:title|description|questions\.\d+\.(?:sourceCardTitle|prompt|explanation|options\.\d+\.text)))|cardsById\.[A-Za-z0-9_-]{1,160}\.(?:title|subtitle|notes|stackNarration|shortSummary|liveDisplayText|availability|productCategory|conversation\.(?:openingMessage|ctaLabel|starters\.\d+|actions\.\d+\.(?:label|description))|tour\.(?:guideScript|legToNext\.(?:instruction|navScript))))$/u.test(path);
}

function setExistingStringPath(value: unknown, rawPath: string[], text: string): void {
  const path = rawPath[0] === 'board' ? rawPath.slice(1) : rawPath[0] === 'cardsById' ? rawPath.slice(2) : rawPath;
  let target: unknown = value;
  if (rawPath[0] === 'cardsById') {
    const cards = objectRecord(value)['cards'];
    if (!Array.isArray(cards)) return;
    target = cards.find((card) => objectRecord(card)['id'] === rawPath[1]);
    if (!target) return;
  }
  for (let index = 0; index < path.length - 1; index += 1) {
    const key = path[index];
    if (Array.isArray(target)) {
      const arrayIndex = Number(key);
      if (!Number.isInteger(arrayIndex) || arrayIndex < 0 || arrayIndex >= target.length) {
        return;
      }
      target = target[arrayIndex];
    } else if (target && typeof target === 'object' && Object.hasOwn(target, key)) {
      target = (target as Record<string, unknown>)[key];
    } else {
      return;
    }
  }

  const finalKey = path[path.length - 1];
  if (Array.isArray(target)) {
    const arrayIndex = Number(finalKey);
    if (Number.isInteger(arrayIndex)
      && arrayIndex >= 0
      && arrayIndex < target.length
      && typeof target[arrayIndex] === 'string') {
      target[arrayIndex] = text;
    }
  } else if (target && typeof target === 'object') {
    const record = target as Record<string, unknown>;
    if (typeof record[finalKey] === 'string') {
      record[finalKey] = text;
    }
  }
}

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item)) as T;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneValue(item)]),
    ) as T;
  }
  return value;
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
