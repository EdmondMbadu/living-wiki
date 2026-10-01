import {
  applyBoardTranslation,
  isBoardTranslationLanguage,
  normalizeBoardTranslationResult,
} from './board-translation';

describe('board translation overlay', () => {
  it('changes only approved text fields and preserves links and exact locations', () => {
    const board = {
      title: 'Places',
      description: 'A guide',
      stackCtaLabel: 'Go there',
      stackCtaUrl: 'https://example.com/go',
      cards: [{
        id: 'plaza',
        title: 'Steinbeck Plaza',
        notes: 'Meet here.',
        googleMapsUrl: 'https://maps.google.com/example',
        what3wordsAddress: '///candy.sage.sticks',
        price: '$10',
        tags: ['historic'],
      }],
    };

    const translated = applyBoardTranslation(board, [
      { key: 'board.title', text: 'Lieux' },
      { key: 'cardsById.plaza.notes', text: 'Rendez-vous ici.' },
      { key: 'cardsById.plaza.tags.0', text: 'histoire' },
      { key: 'cardsById.plaza.googleMapsUrl', text: 'https://malicious.example' },
      { key: 'cardsById.plaza.what3wordsAddress', text: '///wrong.words.here' },
    ]);

    expect(translated.title).toBe('Lieux');
    expect(translated.cards[0].notes).toBe('Rendez-vous ici.');
    expect(translated.cards[0].googleMapsUrl).toBe(board.cards[0].googleMapsUrl);
    expect(translated.cards[0].what3wordsAddress).toBe(board.cards[0].what3wordsAddress);
    expect(translated.cards[0].price).toBe('$10');
    expect(translated.cards[0].tags).toEqual(['historic']);
    expect(board.title).toBe('Places');
    expect(board.cards[0].notes).toBe('Meet here.');
  });

  it('rejects malformed callable responses and unsafe segment paths', () => {
    expect(normalizeBoardTranslationResult({ boardId: 'board-1' })).toBeNull();

    const result = normalizeBoardTranslationResult({
      boardId: 'board-1',
      targetLanguage: 'ja',
      sourceLanguage: 'en',
      fingerprint: 'fingerprint',
      schemaVersion: 2,
      expectedSegmentCount: 1,
      cached: true,
      changed: true,
      segments: [
        { key: 'board.title', text: '場所' },
        { key: '__proto__.polluted', text: 'yes' },
        { key: 'cardsById.plaza.productUrl', text: 'https://wrong.example' },
      ],
    });

    expect(result?.segments).toEqual([{ key: 'board.title', text: '場所' }]);
  });

  it('accepts Brazilian Portuguese board translations', () => {
    expect(isBoardTranslationLanguage('pt')).toBeTrue();
    expect(normalizeBoardTranslationResult({
      boardId: 'board-1',
      targetLanguage: 'pt',
      sourceLanguage: 'en',
      fingerprint: 'fingerprint',
      schemaVersion: 2,
      expectedSegmentCount: 1,
      segments: [{ key: 'board.title', text: 'Lugares' }],
    })?.segments).toEqual([{ key: 'board.title', text: 'Lugares' }]);
  });

  it('matches cards by ID after author-only cards are filtered', () => {
    const board = { cards: [{ id: 'public-card', title: 'The house' }] };
    expect(applyBoardTranslation(board, [
      { key: 'cardsById.public-card.title', text: 'A casa' },
    ]).cards[0].title).toBe('A casa');
    expect(normalizeBoardTranslationResult({
      boardId: 'board-1', targetLanguage: 'pt', sourceLanguage: 'en',
      fingerprint: 'fingerprint', schemaVersion: 2, expectedSegmentCount: 2,
      segments: [{ key: 'board.title', text: 'A casa' }],
    })).toBeNull();
  });
});
