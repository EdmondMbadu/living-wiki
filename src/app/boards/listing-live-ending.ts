import { isListingContactCard, listingContactCardDetails, type ListingContactCardLike } from './listing-contact-card';
import { isRealEstateTalkThru, type ListingTalkingBoardLike } from './listing-talking-card';

export function realEstateLiveContactCard<T extends ListingContactCardLike & { authorOnly?: boolean }>(
  board: ListingTalkingBoardLike | null | undefined,
  cards: readonly T[],
  liveView: boolean,
): T | null {
  if (!liveView || !isRealEstateTalkThru(board)) return null;
  // Prefer the last published contact card when a legacy board has several.
  return [...cards].reverse().find((card) => {
    if (card.authorOnly || !isListingContactCard(card)) return false;
    const contact = listingContactCardDetails(card);
    return !!(contact.phoneHref || contact.emailHref);
  }) ?? null;
}
