import { signal } from '@angular/core';
import { BoardsComponent } from './boards';

describe('board save ordering', () => {
  it('removes the original slug and city metadata before saving a personal copy', async () => {
    const component: any = Object.create(BoardsComponent.prototype);
    const source = {
      id: 'source', ownerUserId: 'edmond', ownerDisplayName: 'Edmond',
      title: 'Understanding the Condo', kind: 'standard', visibility: 'public',
      customSlug: 'understanding-the-condo', atlasId: 'source-wiki',
      generatedForAtlasId: 'source-wiki', likeCount: 37,
      cards: [{ id: 'photo', title: 'Lobby', imageUrls: [], tags: [], stickers: [], tour: null }],
      stickers: [], tourMeta: null,
    };
    let copied: any;
    Object.assign(component, {
      authService: { uid: () => 'jim' },
      currentOwnerSnapshot: () => ({ ownerUserId: 'jim', ownerDisplayName: 'Jim' }),
      nextBoardSortOrder: () => 1,
      createId: () => 'new-id',
      ownerName: () => 'Edmond',
      boards: signal([]),
      boardsSyncError: signal(null),
      boardForkingId: signal(null),
      persistBoard: async (board: unknown) => { copied = board; return board; },
      setShareMessage: () => undefined,
    });

    expect(await component.forkBoard(source, undefined, false)).toBeTruthy();
    expect(copied).toEqual(jasmine.objectContaining({
      id: 'new-id', ownerUserId: 'jim', customSlug: '', atlasId: '',
      generatedForAtlasId: '', likeCount: 0,
    }));
    expect(copied.cards[0].id).toBe('new-id');
  });

  it('duplicates an owned board with independent cards, related cards, route legs, and metadata', async () => {
    const component: any = Object.create(BoardsComponent.prototype);
    let nextId = 0;
    const card = (id: string, title: string, toCardId = '') => ({
      id, title, imageUrls: ['cover.jpg'], tags: ['tour'], stickers: [{ id: `${id}-sticker` }],
      tour: { sequence: id === 'first' ? 1 : 2, legToNext: toCardId ? { toCardId, instruction: 'Walk' } : null },
      relatedCards: id === 'first' ? [{ id: 'related', title: 'Detail', imageUrls: [], tags: [], stickers: [], tour: null, createdAt: 'old', updatedAt: 'old' }] : [],
      createdAt: 'old', updatedAt: 'old',
    });
    const source = {
      id: 'original', ownerUserId: 'edmond', title: 'A'.repeat(90), kind: 'walking-tour', visibility: 'public',
      customSlug: 'original-slug', atlasId: 'atlas', generatedForAtlasId: 'atlas', likeCount: 12,
      forkedFromBoardId: 'someone-else', forkedFromTitle: 'Old', forkedFromOwnerUserId: 'other', forkedFromOwnerName: 'Other',
      socialVideoUrl: 'old.mp4', trailerVideoUrl: 'old-trailer.mp4',
      cards: [card('first', 'Start', 'second'), card('second', 'Finish')],
      stickers: [{ id: 'board-sticker' }], tourMeta: { extras: ['note'] },
    };
    let persisted: any;
    Object.assign(component, {
      authService: { uid: () => 'edmond' },
      canEditBoard: () => true,
      currentOwnerSnapshot: () => ({ ownerUserId: 'edmond' }),
      nextBoardSortOrder: () => -1,
      createId: () => `new-${++nextId}`,
      boards: signal([source]),
      boardsSyncError: signal(null),
      boardDuplicatingId: signal(null),
      persistBoard: async (board: unknown) => { persisted = board; return board; },
    });

    await component.duplicateBoard(source);

    expect(persisted.title).toBe(`${'A'.repeat(83)} (copy)`);
    expect(persisted.id).not.toBe(source.id);
    expect(persisted.visibility).toBe('public');
    expect(persisted.customSlug).toBe('');
    expect(persisted.atlasId).toBe('');
    expect(persisted.generatedForAtlasId).toBe('');
    expect(persisted.likeCount).toBe(0);
    expect(persisted.forkedFromBoardId).toBe('');
    expect(persisted.socialVideoUrl).toBe('');
    expect(persisted.trailerVideoUrl).toBe('');
    expect(persisted.cards.map((item: any) => item.title)).toEqual(['Start', 'Finish']);
    expect(persisted.cards[0].id).not.toBe('first');
    expect(persisted.cards[0].tour.legToNext.toCardId).toBe(persisted.cards[1].id);
    expect(persisted.cards[0].relatedCards[0].id).not.toBe('related');
    expect(persisted.cards[0].stickers[0].id).not.toBe('first-sticker');
    expect(persisted.stickers[0].id).not.toBe('board-sticker');
    expect(persisted.createdAt).toBe(persisted.updatedAt);
    expect(component.boards()[0]).toBe(persisted);
    expect(source.cards[0].tour.legToNext?.toCardId).toBe('second');
  });

  it('does not add a duplicate when saving fails', async () => {
    const component: any = Object.create(BoardsComponent.prototype);
    const source = {
      id: 'original', ownerUserId: 'edmond', title: 'My board', visibility: 'public',
      cards: [], stickers: [], tourMeta: null,
    };
    Object.assign(component, {
      canEditBoard: () => true,
      currentOwnerSnapshot: () => ({ ownerUserId: 'edmond' }),
      nextBoardSortOrder: () => -1,
      createId: () => 'copy',
      boards: signal([source]),
      boardsSyncError: signal(null),
      boardDuplicatingId: signal(null),
      persistBoard: async () => { throw new Error('Could not save'); },
    });
    spyOn(console, 'error');

    await component.duplicateBoard(source);

    expect(component.boards()).toEqual([source]);
    expect(component.boardsSyncError()).toBe('Could not save');
    expect(component.boardDuplicatingId()).toBeNull();
  });

  it('loads a full board before duplicating a gallery summary', async () => {
    const component: any = Object.create(BoardsComponent.prototype);
    const summary = { id: 'original', ownerUserId: 'edmond', title: 'My board', isSummary: true, cards: [], stickers: [] };
    const full = {
      ...summary, isSummary: false,
      cards: [{ id: 'card', title: 'Story', imageUrls: [], tags: [], stickers: [], tour: null, createdAt: 'old', updatedAt: 'old' }],
    };
    let saved: any;
    Object.assign(component, {
      canEditBoard: () => true,
      currentOwnerSnapshot: () => ({ ownerUserId: 'edmond' }),
      nextBoardSortOrder: () => -1,
      createId: () => 'new-id',
      boards: signal([summary]),
      boardsSyncError: signal(null),
      boardDuplicatingId: signal(null),
      loadBoardById: async () => full,
      persistBoard: async (board: unknown) => { saved = board; return board; },
    });

    await component.duplicateBoard(summary);

    expect(saved.isSummary).toBeFalse();
    expect(saved.cards.length).toBe(1);
    expect(saved.cards[0].title).toBe('Story');
  });

  it('includes cards from a board inside the duplicated board', async () => {
    const component: any = Object.create(BoardsComponent.prototype);
    let nextId = 0;
    const nestedCard = { id: 'nested-card', title: 'Inside', imageUrls: [], tags: [], stickers: [], tour: null, createdAt: 'old', updatedAt: 'old' };
    const source = {
      id: 'original', ownerUserId: 'edmond', title: 'Parent',
      cards: [{ ...nestedCard, id: 'parent-card', title: 'Parent card', childBoardId: 'child-board' }],
      stickers: [], tourMeta: null,
    };
    const child = { id: 'child-board', cards: [
      { ...nestedCard, tour: { legToNext: { toCardId: 'next-card' } } },
      { ...nestedCard, id: 'next-card', title: 'Next' },
    ] };
    let saved: any;
    Object.assign(component, {
      canEditBoard: () => true,
      currentOwnerSnapshot: () => ({ ownerUserId: 'edmond' }),
      nextBoardSortOrder: () => -1,
      createId: () => `new-${++nextId}`,
      boards: signal([source]),
      boardsSyncError: signal(null),
      boardDuplicatingId: signal(null),
      loadBoardById: async (id: string) => id === 'child-board' ? child : null,
      persistBoard: async (board: unknown) => { saved = board; return board; },
    });

    await component.duplicateBoard(source);

    expect(saved.cards[0].childBoardId).toBe('');
    expect(saved.cards[0].relatedCards[0].title).toBe('Inside');
    expect(saved.cards[0].relatedCards[0].id).not.toBe('nested-card');
    expect(saved.cards[0].relatedCards[0].tour.legToNext.toCardId).toBe(saved.cards[0].relatedCards[1].id);
  });

  it('does not claim a board was saved when Firebase is unavailable', async () => {
    const component: any = Object.create(BoardsComponent.prototype);
    Object.assign(component, {
      authService: { uid: () => 'jim' },
      teamContextId: () => '',
      firestore: null,
    });
    await expectAsync(component.persistBoard({
      id: 'copy', ownerUserId: 'jim', visibility: 'public',
    })).toBeRejectedWithError('Board sync is not ready. Refresh and try again.');
  });

  it('does not replace a newer local voice choice with an earlier save response', async () => {
    const component: any = Object.create(BoardsComponent.prototype);
    const earlier = {
      id: 'copied-board', ownerUserId: 'owner', title: 'Condo course',
      stackNarratorVoiceId: 'warm-storyteller', updatedAt: '2026-09-21T10:00:00.000Z',
    };
    const newer = {
      ...earlier, stackNarratorVoiceId: 'calm-documentary',
      updatedAt: '2026-09-21T10:00:01.000Z',
    };
    let finishSave!: (value: typeof earlier) => void;
    Object.assign(component, {
      boards: signal([earlier]),
      boardsSyncError: signal(null),
      canEditBoard: () => true,
      persistBoard: () => new Promise<typeof earlier>((resolve) => { finishSave = resolve; }),
    });

    const pending = component.persistAndReplaceBoard(earlier);
    component.boards.set([newer]);
    finishSave(earlier);

    expect(await pending).toBeTrue();
    expect(component.boards()[0].stackNarratorVoiceId).toBe('calm-documentary');
  });

  it('reports the Firebase reason when a board save fails', async () => {
    const component: any = Object.create(BoardsComponent.prototype);
    const board = { id: 'copied-board', ownerUserId: 'owner', updatedAt: '2026-09-21T10:00:00.000Z' };
    Object.assign(component, {
      boards: signal([board]),
      boardsSyncError: signal(null),
      canEditBoard: () => true,
      persistBoard: async () => { throw { code: 'permission-denied' }; },
    });
    spyOn(console, 'error');

    expect(await component.persistAndReplaceBoard(board)).toBeFalse();
    expect(component.boardsSyncError()).toContain('permission-denied');
  });
});
