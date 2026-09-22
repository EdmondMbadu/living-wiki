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
      cards: [{ id: 'photo', title: 'Lobby', stickers: [], tour: null }],
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
