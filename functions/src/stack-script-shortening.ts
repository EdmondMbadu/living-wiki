import type { NarrationAdjustmentCard, NarrationAdjustment } from './narration-text';
export type StackScriptShorteningCard = NarrationAdjustmentCard & { title: string };
export type StackScriptShorteningResult = NarrationAdjustment;
export {
  adjustNarrationSentences as deterministicStackScriptAdjustment,
  shortenNarrationSentences as deterministicStackScriptShortening,
  normalizeNarrationAdjustments as normalizeStackScriptShortening,
} from './narration-text';
import { narrationSentences } from './narration-text';
export function stackScriptSentenceCount(value: string): number {
  return narrationSentences(value).length;
}
