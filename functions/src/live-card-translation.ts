import { createHash } from 'node:crypto';
import { boardTranslationSegmentsComplete, extractBoardTranslationSource, type BoardTranslationLanguage, type BoardTranslationSegment } from './board-translation';
import { orderedStoredTourHandoffCards } from './tour-handoff';

export const LIVE_TRANSLATION_VERSION = 1;

/** A cover or one published card, independent of the size/revision of other cards. */
export function liveCardTranslationSource(board: Record<string, unknown>, cardId: string) {
  const cards = Array.isArray(board['cards']) ? board['cards'] as Record<string, unknown>[] : [];
  const card = cardId ? cards.find((item) => item['id'] === cardId && item['authorOnly'] !== true) : null;
  if (cardId && !card) throw new Error('This card is not available in Live view.');
  const source = extractBoardTranslationSource({ ...board, cards: card ? [card] : [], learningQuiz: null });
  for (const field of cardId ? [] : ['socialVideoClosingHeadline', 'socialVideoClosingMessage']) {
    const text = board[field];
    if (typeof text === 'string' && text.trim()) source.segments.push({ key: `board.${field}`, text: text.trim().slice(0, 8000) });
  }
  return { ...source,
    sourceCharacters: source.segments.reduce((count, segment) => count + segment.text.length, 0),
    fingerprint: createHash('sha256').update(`live:${LIVE_TRANSLATION_VERSION}:${JSON.stringify(source.segments)}`).digest('hex'),
  };
}

export function liveCardTranslationCacheId(boardId: string, language: BoardTranslationLanguage, cardId: string) {
  return createHash('sha256').update(`${boardId}:${language}:${cardId || 'cover'}`).digest('hex');
}

export function readyLiveCardTranslation(value: Record<string, unknown> | undefined,
  source: ReturnType<typeof liveCardTranslationSource>): value is Record<string, unknown> & { segments: BoardTranslationSegment[] } {
  return value?.['status'] === 'ready' && value['fingerprint'] === source.fingerprint
    && boardTranslationSegmentsComplete(source.segments, value['segments']);
}

/** Apply only validated cache fields, preserving the authored board. */
export function applyLiveCardTranslation(board: Record<string, unknown>, segments: readonly BoardTranslationSegment[]) {
  const translated = structuredClone(board);
  for (const { key, text } of segments) {
    const parts = key.split('.');
    let target: unknown = parts[0] === 'board' ? translated
      : (translated['cards'] as Record<string, unknown>[]).find((card) => card['id'] === parts[1]);
    const path = parts.slice(parts[0] === 'board' ? 1 : 2);
    for (const part of path.slice(0, -1)) {
      target = target && typeof target === 'object' ? (target as Record<string, unknown>)[part] : undefined;
    }
    const field = path.at(-1)!;
    if (target && typeof target === 'object'
      && (typeof (target as Record<string, unknown>)[field] === 'string' || field === 'shortSummary')) {
      (target as Record<string, unknown>)[field] = text;
    }
  }
  return translated;
}

/** Rebuild the authorized card/next-stop text exclusively from current server caches. */
export async function liveNarrationBoard(board: Record<string, unknown>, cardId: string,
  readCache: (id: string) => Promise<Record<string, unknown> | undefined>): Promise<Record<string, unknown> | null> {
  const cards = Array.isArray(board['cards']) ? board['cards'] as Record<string, unknown>[] : [];
  if (!cards.some((card) => card['id'] === cardId && card['authorOnly'] !== true)) return null;
  const tourCards = orderedStoredTourHandoffCards(cards.filter((card) => card['authorOnly'] !== true));
  const index = tourCards.findIndex((card) => card.id === cardId);
  const ids = [cardId, ...(index >= 0 && tourCards[index + 1] ? [tourCards[index + 1].id] : [])];
  const caches = await Promise.all(ids.map(readCache));
  let translated = board;
  for (const [index, id] of ids.entries()) {
    const source = liveCardTranslationSource(board, id);
    const cached = caches[index];
    if (readyLiveCardTranslation(cached, source)) translated = applyLiveCardTranslation(translated, cached.segments);
    else if (index === 0) return null;
  }
  return translated;
}
