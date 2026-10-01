import { createHash } from 'node:crypto';

export type BoardTranslationLanguage = 'en' | 'fr' | 'ja' | 'pt';

export interface BoardTranslationSegment {
  key: string;
  text: string;
}

export interface BoardTranslationSource {
  segments: BoardTranslationSegment[];
  fingerprint: string;
  sourceLanguage: BoardTranslationLanguage;
  sourceCharacters: number;
}

const maximumBoardTranslationCharacters = 100_000;
const maximumFieldCharacters = 8_000;
export const BOARD_TRANSLATION_SCHEMA_VERSION = 2;

export function isBoardTranslationLanguage(value: unknown): value is BoardTranslationLanguage {
  return value === 'en' || value === 'fr' || value === 'ja' || value === 'pt';
}

export function extractBoardTranslationSource(value: unknown): BoardTranslationSource {
  const board = recordOrEmpty(value);
  const segments: BoardTranslationSegment[] = [];

  addSegment(segments, 'board.title', board['title']);
  addSegment(segments, 'board.description', board['description']);
  addSegment(segments, 'board.backNote', board['backNote']);
  addSegment(segments, 'board.stackCtaLabel', board['stackCtaLabel']);

  const tourMeta = recordOrEmpty(board['tourMeta']);
  addSegment(segments, 'board.tourMeta.paceOrRouteStyle', tourMeta['paceOrRouteStyle']);
  arrayOrEmpty(tourMeta['extras']).forEach((extra, index) => {
    addSegment(segments, `board.tourMeta.extras.${index}`, extra);
  });

  const cardIds = new Set<string>();
  arrayOrEmpty(board['cards']).forEach((value) => {
    const card = recordOrEmpty(value);
    if (card['authorOnly'] === true) return;
    const cardId = typeof card['id'] === 'string' ? card['id'].trim() : '';
    if (!/^[A-Za-z0-9_-]{1,160}$/u.test(cardId) || cardIds.has(cardId)) {
      throw new Error('Every published card needs a unique ID before this board can be translated.');
    }
    cardIds.add(cardId);
    const prefix = `cardsById.${cardId}`;
    addSegment(segments, `${prefix}.title`, card['title']);
    addSegment(segments, `${prefix}.subtitle`, card['subtitle']);
    addSegment(segments, `${prefix}.notes`, card['notes']);
    addSegment(segments, `${prefix}.stackNarration`, card['stackNarration']);
    // The client materializes a missing shortSummary from subtitle. Translate
    // that displayed fallback too, or narration can read its English copy.
    addSegment(segments, `${prefix}.shortSummary`,
      typeof card['shortSummary'] === 'string' ? card['shortSummary'] : card['subtitle']);
    addSegment(segments, `${prefix}.availability`, card['availability']);
    addSegment(segments, `${prefix}.productCategory`, card['productCategory']);
    const conversation = recordOrEmpty(card['conversation']);
    addSegment(segments, `${prefix}.conversation.openingMessage`, conversation['openingMessage']);
    addSegment(segments, `${prefix}.conversation.ctaLabel`, conversation['ctaLabel']);
    arrayOrEmpty(conversation['starters']).forEach((starter, starterIndex) => {
      addSegment(segments, `${prefix}.conversation.starters.${starterIndex}`, starter);
    });
    arrayOrEmpty(conversation['actions']).forEach((actionValue, actionIndex) => {
      const action = recordOrEmpty(actionValue);
      addSegment(segments, `${prefix}.conversation.actions.${actionIndex}.label`, action['label']);
      addSegment(segments, `${prefix}.conversation.actions.${actionIndex}.description`, action['description']);
    });
    const tour = recordOrEmpty(card['tour']);
    addSegment(segments, `${prefix}.tour.guideScript`, tour['guideScript']);
    const leg = recordOrEmpty(tour['legToNext']);
    addSegment(segments, `${prefix}.tour.legToNext.instruction`, leg['instruction']);
    addSegment(segments, `${prefix}.tour.legToNext.navScript`, leg['navScript']);
  });

  const quiz = recordOrEmpty(board['learningQuiz']);
  addSegment(segments, 'board.learningQuiz.title', quiz['title']);
  addSegment(segments, 'board.learningQuiz.description', quiz['description']);
  arrayOrEmpty(quiz['questions']).forEach((value, questionIndex) => {
    const question = recordOrEmpty(value);
    const prefix = `board.learningQuiz.questions.${questionIndex}`;
    addSegment(segments, `${prefix}.sourceCardTitle`, question['sourceCardTitle']);
    addSegment(segments, `${prefix}.prompt`, question['prompt']);
    addSegment(segments, `${prefix}.explanation`, question['explanation']);
    arrayOrEmpty(question['options']).forEach((optionValue, optionIndex) => {
      addSegment(
        segments,
        `${prefix}.options.${optionIndex}.text`,
        recordOrEmpty(optionValue)['text'],
      );
    });
  });

  const sourceCharacters = segments.reduce((total, segment) => total + segment.text.length, 0);
  if (sourceCharacters > maximumBoardTranslationCharacters) {
    throw new Error('This board has too much text to translate in one request.');
  }

  const fingerprint = createHash('sha256')
    .update(`${BOARD_TRANSLATION_SCHEMA_VERSION}:${JSON.stringify(segments)}`)
    .digest('hex');

  return {
    segments,
    fingerprint,
    sourceLanguage: detectBoardSourceLanguage(segments.map((segment) => segment.text).join('\n')),
    sourceCharacters,
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

export function detectBoardSourceLanguage(text: string): BoardTranslationLanguage {
  if (/[\u3040-\u30ff\u3400-\u9fff]/u.test(text)) {
    return 'ja';
  }

  const normalized = ` ${text.toLocaleLowerCase()} `;
  const frenchSignals = normalized.match(
    /(?:[àâçéèêëîïôùûüÿœæ]|\b(?:le|la|les|des|une|avec|pour|dans|sur|est|sont|et|du|au|aux|ce|cette|ces|vous|nous)\b)/gu,
  )?.length ?? 0;
  const portugueseSignals = normalized.match(
    /(?:[ãõ]|\b(?:não|uma|você|vocês|com|para|pelo|pela|pelos|pelas|também|está|estão|sobre|seu|sua|seus|suas|os|as|dos|das)\b)/gu,
  )?.length ?? 0;
  const wordCount = Math.max(1, normalized.split(/\s+/u).filter(Boolean).length);
  if (portugueseSignals >= 3 && portugueseSignals / wordCount >= 0.025 && portugueseSignals > frenchSignals) {
    return 'pt';
  }
  return frenchSignals >= 3 && frenchSignals / wordCount >= 0.025 ? 'fr' : 'en';
}

function addSegment(segments: BoardTranslationSegment[], key: string, value: unknown): void {
  if (typeof value !== 'string') {
    return;
  }
  const text = value.trim();
  if (!text) {
    return;
  }
  segments.push({ key, text: text.slice(0, maximumFieldCharacters) });
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function arrayOrEmpty(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
