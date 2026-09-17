import { isListingContactCard, listingContactScript } from './listing-contact-card';

export type NarratedCard = {
  title?: string; subtitle?: string; notes?: string; shortSummary?: string;
  tour?: { guideScript?: string } | null;
  stackNarration?: string; stackNarrationSource?: string; videoNarrationRevision?: number;
};

export function canonicalCardNarration(card: NarratedCard): string {
  if (card.tour?.guideScript?.trim()) return card.tour.guideScript.trim();
  if (isListingContactCard(card)) return listingContactScript(card);
  return (card.notes || card.shortSummary || card.subtitle || (card.title ? `${card.title}.` : '')).trim();
}

/** Preserve approved full text through repeated shorten/save/reload/expand cycles. */
export function withSavedNarration<T extends NarratedCard>(card: T, narration: string, source: string): T {
  const script = narration.trim();
  const changed = canonicalCardNarration(card) !== script;
  return {
    ...card,
    notes: card.tour ? card.notes : script,
    ...(card.tour ? { tour: { ...card.tour, guideScript: script } } : {}),
    ...(isListingContactCard(card) ? { stackNarration: script } : {}),
    stackNarrationSource: source.trim() || script,
    videoNarrationRevision: (card.videoNarrationRevision || 0) + (changed ? 1 : 0),
  };
}

export function invalidatedNarrationMedia() {
  return {
    socialVideoRenderVersion: '', socialLandscapeVideoRenderVersion: '',
    trailerVideoRenderVersion: '', trailerLandscapeVideoRenderVersion: '',
    trailerVideoSourceFingerprint: '',
  };
}
