import { isLinkReadableVisibility, type BoardVisibility } from '../board-visibility';
import { publicBoardQrUrl } from '../board-qr-code';
import { canonicalCardNarration } from '../../../functions/src/card-narration';

export type ShareableCard = {
  id: string;
  title?: string;
  subtitle?: string;
  notes?: string;
  shortSummary?: string;
  tour?: { guideScript?: string } | null;
  conversation?: { atlasId?: string | null } | null;
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

export function publicCardUrl(boardId: string, cardId: string, contentLanguage?: 'en' | 'fr' | 'ja' | 'pt' | null): string {
  const baseUrl = publicBoardQrUrl(boardId);
  const localizedUrl = contentLanguage && contentLanguage !== 'en'
    ? baseUrl.replace('https://www.livingwiki.com/', `https://www.livingwiki.com/${contentLanguage}/`)
    : baseUrl;
  return `${localizedUrl}?card=${encodeURIComponent(cardId)}`
    + (contentLanguage ? `&contentLang=${contentLanguage}` : '');
}

/** Only top-level cards with narration or a conversation can open directly in Live view. */
export function directLiveCard<T extends ShareableCard>(cards: readonly T[], cardId: string): T | null {
  const card = cards.find((candidate) => candidate.id === cardId);
  return card && !card.authorOnly && (card.conversation?.atlasId || canonicalCardNarration(card).trim())
    ? card
    : null;
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
