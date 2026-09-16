// Keep the browser and Functions copies identical; the summary test checks parity.
export type PropertyBoardLike = {
  title?: unknown;
  description?: unknown;
  cards?: readonly unknown[] | null;
};

export function isPropertyBoardContent(board: PropertyBoardLike): boolean {
  const cards = (board.cards ?? []).filter((card): card is Record<string, unknown> =>
    !!card && typeof card === 'object' && (card as Record<string, unknown>)['authorOnly'] !== true);
  const tagsFor = (card: Record<string, unknown>): string[] =>
    (Array.isArray(card['tags']) ? card['tags'] : [])
      .filter((tag): tag is string => typeof tag === 'string')
      .map((tag) => tag.trim().toLowerCase());
  const tags = new Set(cards.flatMap(tagsFor));
  const title = `${board.title ?? ''} ${board.description ?? ''}`;
  if (/real estate virtualtalkthru/i.test(title)
    || tags.has('listing-story')
    || (tags.has('listing') && ['real-estate', 'lodging', 'rental'].some((tag) => tags.has(tag)))) return true;
  const legacyPropertySignal = /\b(?:condo(?:minium)?|house|home|property|apartment|unit)\b/i.test(title)
    || tags.has('condo') || tags.has('condominium');
  if (legacyPropertySignal && tags.has('agent-intro') && tags.has('contact-card')) return true;
  const residentialTourSignal = /\b(?:condo(?:minium)?|house|home|property|rental|retreat|getaway)\b/i.test(title);
  const residentialRoomCount = cards.filter((card) =>
    /\b(?:bed(?:room)?|bath(?:room)?|kitchen|living room|laundry|backyard|porch|hot tub)\b/i
      .test(`${card['title'] ?? ''} ${card['subtitle'] ?? ''} ${tagsFor(card).join(' ')}`)).length;
  return residentialTourSignal && residentialRoomCount >= 4;
}
