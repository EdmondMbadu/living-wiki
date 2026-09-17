// This dependency is pure TypeScript: no server SDKs or secrets enter the bundle.
import {
  adjustNarrationSentences,
  narrationSentences,
  NARRATION_WORDS_PER_SECOND,
  type NarrationAdjustmentCard,
  type NarrationAdjustment,
} from '../../../functions/src/narration-text';
export type StackScriptShortenCard = NarrationAdjustmentCard;
export type StackScriptShortenResult = NarrationAdjustment;
export {
  narrationSentences as stackScriptSentences,
  shortenNarrationSentences as shortenStackScriptNarration,
  adjustNarrationSentences as adjustStackScriptNarration,
  normalizeNarrationAdjustments as normalizeStackScriptShortenResults,
} from '../../../functions/src/narration-text';

export function stackScriptSentenceCount(value: string): number {
  return narrationSentences(value).length;
}

export function stackScriptShortenEstimateSeconds(cards: readonly StackScriptShortenCard[], target: number): number {
  const words = cards.reduce((sum, card) => sum + adjustNarrationSentences(card, target).split(/\s+/u).filter(Boolean).length, 0);
  return Math.ceil(words / NARRATION_WORDS_PER_SECOND);
}
