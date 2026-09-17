import { createHash } from 'node:crypto';
import { canonicalCardNarration, invalidatedNarrationMedia, withSavedNarration } from './card-narration';
import { containsEditorCopy, hasDanglingNarration, isFinishedNarration, narrationSummary } from './narration-text';

type RecordValue = Record<string, any>;
export type BoardCopyReplacement = { cardId: string; narration: string };
export type BoardCopyRepairProposal = {
  version: 1; boardId: string; collection: 'boards' | 'team_boards'; fingerprint: string;
  revision: number | null; changes: Array<{ cardId: string; before: string; after: string }>;
  issues: Array<{ cardId: string; title: string; codes: string[] }>;
  before: RecordValue;
};

export function boardCopyFingerprint(board: RecordValue): string {
  // Firestore field order is not a revision signal.
  const stable = (value: any): any => Array.isArray(value) ? value.map(stable)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
  return createHash('sha256').update(JSON.stringify(stable(board))).digest('hex');
}

/** Exact incident signatures only: ordinary authored fragments are not migration targets. */
export function scanStoredBoardCopy(board: RecordValue): BoardCopyRepairProposal['issues'] {
  return (Array.isArray(board.cards) ? board.cards : []).flatMap((card: RecordValue) => {
    if (card.authorOnly || card.tags?.includes('source-item') || card.tags?.includes('agent-intro')) return [];
    const text = canonicalCardNarration(card);
    const codes = [];
    if ([card.title,card.subtitle,card.notes,card.shortSummary,card.tour?.guideScript].some(value => typeof value === 'string' && containsEditorCopy(value))) codes.push('editor-instruction');
    if (hasDanglingNarration(text) && /(?:from here, the tour|shown staged with|continue the property tour)/i.test(text)) codes.push('broken-listing-fallback');
    return codes.length ? [{cardId:card.id,title:card.title,codes}] : [];
  });
}

export function proposeBoardCopyRepair(
  boardId: string, collection: 'boards' | 'team_boards', board: RecordValue, replacements: BoardCopyReplacement[] = [],
): BoardCopyRepairProposal {
  const issues = scanStoredBoardCopy(board);
  const affected = new Set(issues.map(issue => issue.cardId));
  const seen = new Set<string>();
  const changes = replacements.map(replacement => {
    if (!affected.has(replacement.cardId) || seen.has(replacement.cardId)) throw new Error('Replacement must identify one defective card exactly once.');
    seen.add(replacement.cardId);
    if (!isFinishedNarration(replacement.narration) || replacement.narration.length > 3600) throw new Error('A replacement must contain complete, finished narration.');
    const card = board.cards.find((card: RecordValue) => card.id === replacement.cardId);
    return {cardId:card.id,before:canonicalCardNarration(card),after:replacement.narration.trim()};
  });
  return { version:1,boardId,collection,fingerprint:boardCopyFingerprint(board),revision:board.team_revision ?? null,
    issues,changes,before:structuredClone(board) };
}

export function reviewedBoardCopyPatch(proposal: BoardCopyRepairProposal, current: RecordValue): RecordValue {
  if (proposal.version !== 1 || !proposal.changes.length) throw new Error('This proposal has no reviewed replacements.');
  if (boardCopyFingerprint(current) !== proposal.fingerprint) throw new Error('The board changed after the scan. Rescan before applying.');
  // Revalidate even if an operator manually edited the review file.
  const checked = proposeBoardCopyRepair(proposal.boardId, proposal.collection, current,
    proposal.changes.map(change => ({cardId:change.cardId,narration:change.after})));
  const byId = new Map(checked.changes.map(change => [change.cardId,change.after]));
  const cards = current.cards.map((card: RecordValue) => {
      const narration = byId.get(card.id);
      if (!narration) return card;
      return {...withSavedNarration(card,narration,narration),shortSummary:narrationSummary(narration),
        ...(card.tour && containsEditorCopy(card.notes || '') ? {notes:narration} : {}),
        // Generated subtitle instructions must not survive beside corrected notes.
        subtitle:containsEditorCopy(card.subtitle || '') ? '' : card.subtitle};
    });
  if (scanStoredBoardCopy({...current,cards}).some(issue => byId.has(issue.cardId))) {
    throw new Error('A targeted card still contains defective copy. Review its title and other public fields.');
  }
  return { ...invalidatedNarrationMedia(), cards };
}
