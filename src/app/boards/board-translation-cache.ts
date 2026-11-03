import { collectBoardTranslationSegments } from '../../../functions/src/board-translation-source';
import { normalizeBoardTranslationResult, type BoardTranslationResult } from './board-translation';

const storageKey = 'livingwiki.boardTranslations.v1';
const maximumCharacters = 750_000;
type Entry = {key: string; source: string; result: BoardTranslationResult};

export function boardTranslationSourceSignature(board: unknown): string {
  try { return JSON.stringify(collectBoardTranslationSegments(board, Infinity)); }
  catch { return ''; }
}

/** Session storage survives the full page navigation between compiled locales.
 * Content is used only after the original board has passed its normal access/load checks.
 */
export class BoardTranslationCache {
  private entries: Entry[] = [];
  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null = sessionStorageOrNull()) {
    try {
      const text = storage?.getItem(storageKey);
      if (!text || text.length > maximumCharacters) return;
      const values: unknown = JSON.parse(text);
      if (Array.isArray(values)) this.entries = values.slice(-12).flatMap((value) => {
        const result = normalizeBoardTranslationResult(value?.result);
        return result && typeof value?.key === 'string' && typeof value?.source === 'string'
          ? [{key: value.key, source: value.source, result}] : [];
      });
    } catch { /* Storage is optional; the server cache still works. */ }
  }
  get(key: string, source: string): BoardTranslationResult | null {
    if (!source) return null;
    const entry = this.entries.find((item) => item.key === key && item.source === source);
    return entry ? {...entry.result, cached: true} : null;
  }
  put(key: string, source: string, result: BoardTranslationResult): void {
    if (!source) return;
    this.entries = [...this.entries.filter((item) => item.key !== key), {key, source, result}].slice(-12);
    let text = JSON.stringify(this.entries);
    while (text.length > maximumCharacters && this.entries.length) {
      this.entries.shift(); text = JSON.stringify(this.entries);
    }
    try { this.storage?.setItem(storageKey, text); } catch { /* Keep the memory cache when storage is blocked/full. */ }
  }
}

function sessionStorageOrNull(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.sessionStorage; } catch { return null; }
}

export function mergeBoardTranslationProgress(previous: BoardTranslationResult | null, incoming: BoardTranslationResult): BoardTranslationResult {
  if (!previous) return incoming;
  if (previous.boardId !== incoming.boardId || previous.targetLanguage !== incoming.targetLanguage
    || previous.fingerprint !== incoming.fingerprint) throw new Error('Translation source changed during streaming.');
  const byKey = new Map(previous.segments.map((segment) => [segment.key, segment]));
  for (const segment of incoming.segments) byKey.set(segment.key, segment);
  const segments = [...byKey.values()];
  return {...incoming, segments, expectedSegmentCount: segments.length, changed: previous.changed || incoming.changed};
}
