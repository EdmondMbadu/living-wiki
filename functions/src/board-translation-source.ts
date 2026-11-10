import type { ContentLanguage } from './content-language';

export interface BoardTranslationSegment { key: string; text: string; }
const maximumBoardTranslationCharacters = 100_000;
const maximumFieldCharacters = 8_000;

/** Browser-safe extraction: only public, translatable authored text. */
export function collectBoardTranslationSegments(value: unknown, maximumCharacters = maximumBoardTranslationCharacters): BoardTranslationSegment[] {
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
    addSegment(segments, `${prefix}.liveDisplayText`, card['liveDisplayText']);
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
  if (sourceCharacters > maximumCharacters) {
    throw new Error('This board has too much text to translate in one request.');
  }

  return segments;
}

export function detectBoardSourceLanguage(text: string): ContentLanguage {
  if (/[\u3040-\u30ff]/u.test(text)) {
    return 'ja';
  }

  if (/\p{Script=Hangul}/u.test(text)) return 'ko';
  if (/\p{Script=Arabic}/u.test(text)) return 'ar';
  if (/\p{Script=Devanagari}/u.test(text)) return 'hi';
  if (/\p{Script=Cyrillic}/u.test(text)) return 'ru';
  if (/\p{Script=Han}/u.test(text)) return 'zh';

  const normalized = ` ${text.toLocaleLowerCase()} `;
  const italianSignals = normalized.match(/(?<!\p{L})(?:il|gli|della|delle|degli|nella|nelle|nel|sono|questo|questa|questi|queste|perché|anche|puoi|sulla|sulle|un|una|che|per|con)(?!\p{L})/gu)?.length ?? 0;
  const italianDistinctive = /(?<!\p{L})(?:il|gli|della|delle|degli|nella|nelle|nel|sono|questo|questa|questi|queste|perché|puoi|sulla|sulle)(?!\p{L})/u.test(normalized);
  if (italianDistinctive && italianSignals >= 3 && italianSignals / Math.max(1, normalized.split(/\s+/u).filter(Boolean).length) >= 0.08) return 'it';
  const germanSignals = normalized.match(/(?<!\p{L})(?:der|die|das|den|dem|des|ein|eine|einen|einem|einer|und|ist|sind|mit|für|auf|im|zum|zur|hier|dieser|diese|dieses|sich|nicht|werden)(?!\p{L})/gu)?.length ?? 0;
  const words = Math.max(1, normalized.split(/\s+/u).filter(Boolean).length);
  if (germanSignals >= 3 && germanSignals / words >= 0.08) return 'de';
  const frenchSignals = normalized.match(
    /(?:[àâçéèêëîïôùûüÿœæ]|\b(?:le|la|les|des|une|avec|pour|dans|sur|est|sont|et|du|au|aux|ce|cette|ces|vous|nous)\b)/gu,
  )?.length ?? 0;
  const portugueseSignals = normalized.match(
    /(?:[ãõ]|\b(?:não|uma|você|vocês|com|para|pelo|pela|pelos|pelas|também|está|estão|sobre|seu|sua|seus|suas|os|as|dos|das)\b)/gu,
  )?.length ?? 0;
  // Words and marks that are Spanish but not Portuguese or French, so the
  // three Romance languages do not steal each other's boards.
  const spanishSignals = normalized.match(
    // Unicode-aware word edges: \b treats accented letters as non-word characters.
    /(?:[ñ¿¡]|(?<!\p{L})(?:el|los|las|del|una|unos|unas|usted|ustedes|también|pero|muy|está|están|este|esta|estos|estas|hay|y|que|por|con|para|su|sus|al)(?!\p{L}))/gu,
  )?.length ?? 0;
  const wordCount = Math.max(1, normalized.split(/\s+/u).filter(Boolean).length);
  if (spanishSignals >= 3 && spanishSignals / wordCount >= 0.04
    && spanishSignals > portugueseSignals && spanishSignals > frenchSignals) {
    return 'es';
  }
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

/** The detector's English fallback is not evidence that a short foreign text is English.
 * Require several distinct English words, and never skip mixed-language content.
 */
export function isOriginalEnglish(segments: readonly BoardTranslationSegment[]): boolean {
  if (!segments.length) return true;
  if (segments.some(({ text }) => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Arabic}\p{Script=Devanagari}\p{Script=Cyrillic}]/u.test(text)
    || detectBoardSourceLanguage(text) !== 'en')) return false;
  const text = segments.map((segment) => segment.text).join(' ').toLowerCase();
  const words = text.match(/\p{L}+/gu) ?? [];
  const english = words.filter((word) => /^(?:the|this|these|those|is|are|was|were|and|with|from|that|which|their|they|his|her|you|your|our|will|would|has|have|had|been|into|through|about|during|where|when|who|what|how|can|could|should|not|its|it|of|to|for|in|on|at|by|as|an|a)$/u.test(word));
  return new Set(english).size >= 5 && english.length / Math.max(1, words.length) >= 0.12;
}
