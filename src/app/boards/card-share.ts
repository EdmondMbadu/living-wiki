import { isLinkReadableVisibility, type BoardVisibility } from '../board-visibility';
import { publicBoardQrUrl } from '../board-qr-code';

export type ShareableCard = {
  id: string;
  title?: string;
  subtitle?: string;
  notes?: string;
  imageUrl?: string;
  imageUrls?: string[];
  authorOnly?: boolean;
  relatedCards?: ShareableCard[];
};

export type ShareableBoard = {
  id: string;
  visibility: BoardVisibility;
  teamDraft?: boolean;
  cards: ShareableCard[];
};

export function publicCardUrl(boardId: string, cardId: string): string {
  return `${publicBoardQrUrl(boardId)}?card=${encodeURIComponent(cardId)}`;
}

/** A hidden parent also makes its nested cards unsuitable for a public link. */
export function findCardPath<T extends ShareableCard>(
  cards: readonly T[],
  cardId: string,
): { card: T; authorOnly: boolean; parentId: string | null } | null {
  for (const card of cards) {
    if (card.id === cardId) return { card, authorOnly: card.authorOnly === true, parentId: null };
    const nested = findCardPath(card.relatedCards as T[] ?? [], cardId);
    if (nested) return { card: nested.card, authorOnly: card.authorOnly === true || nested.authorOnly, parentId: nested.parentId ?? card.id };
  }
  return null;
}

export function canShareCardPublicly(
  visibility: BoardVisibility,
  teamDraft: boolean | undefined,
  authorOnly: boolean,
): boolean {
  return isLinkReadableVisibility(visibility) && !teamDraft && !authorOnly;
}
