import type { GeneratedBoardWizardBatch, GeneratedBoardWizardCard } from './gemini';
import { containsEditorCopy, hasDanglingNarration, isFinishedNarration, introducesNarrationNumbers, preservesNarrationQualifications } from './narration-text';

export const BOARD_COPY_VERSION = 'finished-copy-v1';
export type BoardCopyIssue = { cardIndex: number; codes: string[] };
export type BoardCopyRepair = { cardIndex: number; title: string; subtitle: string; notes: string; short_summary: string };

function protectedCopy(card: GeneratedBoardWizardCard): boolean {
  return card.authorOnly === true || card.tags.includes('source-item') || card.tags.includes('agent-intro');
}

export function inspectBoardWizardCopy(batch: GeneratedBoardWizardBatch): BoardCopyIssue[] {
  const seen = new Set<string>();
  return batch.cards.flatMap((card, cardIndex) => {
    if (protectedCopy(card)) return [];
    const codes: string[] = [];
    const publicFields = [card.title, card.subtitle, card.notes, card.short_summary || '', card.tour?.guideScript || ''];
    if (publicFields.some(containsEditorCopy)) codes.push('editor-instruction');
    const narration = card.tour?.guideScript || card.notes;
    if (!narration.trim()) codes.push('missing-narration');
    else if (hasDanglingNarration(narration)) codes.push('fragment');
    else if (!isFinishedNarration(narration)) codes.push('unfinished-narration');
    const key = narration.replace(/\s+/gu, ' ').trim().toLowerCase();
    if (key && seen.has(key)) codes.push('duplicate-narration');
    if (key) seen.add(key);
    return codes.length ? [{ cardIndex, codes }] : [];
  });
}

export function applyBoardCopyRepairs(
  batch: GeneratedBoardWizardBatch, issues: BoardCopyIssue[], repairs: BoardCopyRepair[],
): GeneratedBoardWizardBatch {
  const affected = new Set(issues.map((issue) => issue.cardIndex));
  const counts = new Map<number, number>();
  repairs.forEach((repair) => counts.set(repair.cardIndex, (counts.get(repair.cardIndex) || 0) + 1));
  const byIndex = new Map(repairs.map((repair) => [repair.cardIndex, repair]));
  return { ...batch, cards: batch.cards.map((card, index) => {
    const repair = byIndex.get(index);
    if (!affected.has(index) || !repair || counts.get(index) !== 1 || protectedCopy(card)) return card;
    const evidence = [card.title, card.subtitle, card.notes, card.short_summary, card.price, card.tour?.guideScript].filter(Boolean).join(' ');
    const proposed = [repair.title, repair.subtitle, repair.notes, repair.short_summary].join(' ');
    if (!repair.title.trim() || repair.title.length > 80 || repair.subtitle.length > 120
      || repair.notes.length > 3600 || repair.short_summary.length > 160
      || containsEditorCopy(proposed) || !isFinishedNarration(repair.notes)
      || introducesNarrationNumbers(proposed, evidence)
      || !preservesNarrationQualifications(repair.notes, card.tour?.guideScript || card.notes)) return card;
    return { ...card, title: repair.title, subtitle: repair.subtitle, notes: repair.notes, short_summary: repair.short_summary,
      ...(card.tour ? { tour: { ...card.tour, guideScript: repair.notes } } : {}) };
  }) };
}

/** One bounded repair pass, followed by the same checks on the FINAL output. */
export async function finalizeBoardWizardCopy(
  batch: GeneratedBoardWizardBatch,
  repair: (batch: GeneratedBoardWizardBatch, issues: BoardCopyIssue[]) => Promise<BoardCopyRepair[]>,
): Promise<GeneratedBoardWizardBatch> {
  const issues = inspectBoardWizardCopy(batch);
  if (!issues.length) return batch;
  const fixed = applyBoardCopyRepairs(batch, issues, await repair(batch, issues));
  const remaining = inspectBoardWizardCopy(fixed);
  if (remaining.length) {
    const titles = remaining.slice(0, 4).map((issue) => batch.cards[issue.cardIndex].title).join(', ');
    throw new Error(`The narration could not be completed for ${titles}. Add more source detail or try generating again.`);
  }
  return fixed;
}
