import { canShareCardPublicly, findCardPath, narratedLiveCard, publicCardUrl } from './card-share';

describe('card sharing', () => {
  it('builds a stable public link from IDs and encodes special characters', () => {
    expect(publicCardUrl('board id', 'card/a & b')).toBe(
      'https://www.livingwiki.com/boards/board%20id?card=card%2Fa%20%26%20b',
    );
  });

  it('finds nested cards and inherits author-only visibility from parents', () => {
    type Card = { id: string; authorOnly?: boolean; relatedCards?: Card[] };
    const cards: Card[] = [{ id: 'parent', authorOnly: true, relatedCards: [{ id: 'child' }] }];
    expect(findCardPath(cards, 'child')).toEqual({ card: cards[0].relatedCards![0], authorOnly: true, parentId: 'parent' });
    expect(findCardPath(cards, 'deleted')).toBeNull();
  });

  it('shares only cards that anonymous visitors can open', () => {
    expect(canShareCardPublicly('public', false, false)).toBeTrue();
    expect(canShareCardPublicly('unlisted', false, false)).toBeTrue();
    expect(canShareCardPublicly('private', false, false)).toBeFalse();
    expect(canShareCardPublicly('public', true, false)).toBeFalse();
    expect(canShareCardPublicly('public', false, true)).toBeFalse();
  });

  it('opens only a top-level narratable card in Live view', () => {
    const cards = [
      { id: 'narrated', title: 'Kitchen', notes: 'Welcome to the kitchen.' },
      { id: 'silent', title: '' },
      { id: 'talking', title: 'Ask me', conversation: { atlasId: 'agent' } },
      { id: 'hidden', title: 'Secret', authorOnly: true },
      { id: 'parent', title: 'Parent', relatedCards: [{ id: 'nested', title: 'Nested' }] },
    ];
    expect(narratedLiveCard(cards, 'narrated')).toBe(cards[0]);
    expect(narratedLiveCard(cards, 'silent')).toBeNull();
    expect(narratedLiveCard(cards, 'talking')).toBeNull();
    expect(narratedLiveCard(cards, 'hidden')).toBeNull();
    expect(narratedLiveCard(cards, 'nested')).toBeNull();
  });
});
