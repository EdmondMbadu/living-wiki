import { normalizeTranslatedBoardSegments, type BoardTranslationSegment } from './board-translation';

/** Short requests make visible text available without waiting for a whole board.
 * Repeated narration/summary text is translated once and expanded back to its keys.
 */
export function translationBatches(segments: readonly BoardTranslationSegment[], maxCharacters = 2_000) {
  const aliases = new Map<string, BoardTranslationSegment[]>();
  const unique: BoardTranslationSegment[] = [];
  for (const segment of segments) {
    const existing = aliases.get(segment.text);
    if (existing) existing.push(segment);
    else { aliases.set(segment.text, [segment]); unique.push(segment); }
  }
  const batches: BoardTranslationSegment[][] = [];
  let batch: BoardTranslationSegment[] = [];
  let characters = 0;
  for (const segment of unique) {
    // Send the heading immediately, then small groups in source/display order.
    if (batch.length && (batch[0].key === 'board.title' || batch.length >= 12 || characters + segment.text.length > maxCharacters)) {
      batches.push(batch); batch = []; characters = 0;
    }
    batch.push(segment); characters += segment.text.length;
  }
  if (batch.length) batches.push(batch);
  return { batches, aliases };
}

export async function translateInBatches(
  source: readonly BoardTranslationSegment[],
  translate: (group: BoardTranslationSegment[]) => Promise<BoardTranslationSegment[]>,
  onBatch?: (segments: BoardTranslationSegment[]) => Promise<void> | void,
  maxCharacters?: number,
): Promise<BoardTranslationSegment[]> {
  const { batches, aliases } = translationBatches(source, maxCharacters);
  const translated: BoardTranslationSegment[] = [];
  let next = 0;
  let failed = false;
  await Promise.all(Array.from({ length: Math.min(3, batches.length) }, async () => {
    while (!failed && next < batches.length) {
      const batch = batches[next++];
      let normalized: BoardTranslationSegment[];
      try { normalized = normalizeTranslatedBoardSegments(batch, await translate(batch)); }
      catch (error) { failed = true; throw error; }
      if (failed) return;
      const expanded = normalized.flatMap((segment) =>
        aliases.get(batch.find((item) => item.key === segment.key)!.text)!
          .map((original) => ({ key: original.key, text: segment.text })));
      translated.push(...expanded);
      await onBatch?.(expanded);
    }
  }));
  return normalizeTranslatedBoardSegments(source, translated);
}
