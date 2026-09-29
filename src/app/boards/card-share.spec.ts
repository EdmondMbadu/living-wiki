import { canShareCardPublicly, findCardPath, publicCardUrl } from './card-share';

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
});
