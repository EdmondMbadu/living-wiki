import { signal } from '@angular/core';
import { BoardsComponent } from './boards';

const board: any = {
  id: 'published-board', ownerUserId: 'owner', title: 'Case board', description: 'Cases', imageUrl: '',
  cards: [{ id: 'case-1', title: 'The case', notes: 'A narrated case.', videoNarrationRevision: 1 }],
  socialVideoUrl: 'https://example.com/full.mp4', trailerVideoUrl: 'https://example.com/trailer.mp4',
  socialVideoAudioTrackId: 'golden-hour-square', socialVideoAudioVolume: 0.18,
  stackNarratorVoiceId: 'warm-storyteller',
};

function harness(): any {
  const c = Object.create(BoardsComponent.prototype);
  Object.assign(c, {
    isBrowser: true,
    boards: signal([board]), stackBoard: () => c.boards()[0], canEditBoard: () => true,
    boardsSyncError: signal(null),
    stackCoverSaving: signal(false), stackCoverImageUploading: signal(false), stackScriptSaving: signal(false),
    stackCoverError: signal(null), stackCoverSavedAt: signal(''),
    stackScriptBoardTitle: signal(board.title), stackScriptBoardDescription: signal(board.description),
    stackCoverImageDraft: signal(board.imageUrl),
    stackFinalScreenSaving: signal(false), stackFinalScreenImageUploading: signal(false),
    stackFinalScreenError: signal(null),
    stackScriptRegeneratingCardId: signal(null), stackScriptError: signal(null),
    stackAudioTrackId: signal('none'), stackAudioVolume: signal(0.2), stackAudioError: signal(null),
    stackNarratorVoiceId: signal('calm-documentary'), stackVoiceError: signal(null),
    stackPublishedVideoReady: signal(true), stackPublishedTrailerReady: signal(true),
    boardCardNumbersSavingId: signal(null), boardInsideDisplaySavingId: signal(null),
    activeAlongsideBoardIds: signal(new Set()),
    publishedStackVideoFiles: new Map(), publishedStackTrailerFiles: new Map(),
    stackPublishedFileKey: (id: string, ratio: string) => `${id}:${ratio}`,
    stopStackVoicePreview: () => {}, setStackShareMessage: () => {},
    applyStackCoverState: () => {}, applyStackFinalScreenState: () => {},
    stackScriptDirty: () => false,
    stackScriptNarration: (card: any) => card.notes,
    currentStackFinalScreen: () => ({ headline: 'Read on', message: 'Open the board',
      showQrCode: true, image: 'cover', customImageUrl: '', durationSeconds: 3 }),
    persistAndReplaceBoard: jasmine.createSpy('save').and.resolveTo(true),
  });
  return c;
}

describe('published board Studio saves', () => {
  it('routes cover and final-screen saves through focused writes', async () => {
    const c = harness();
    expect(await c.saveStackCover(board)).toBeTrue();
    expect(c.persistAndReplaceBoard).toHaveBeenCalledWith(jasmine.objectContaining({
      title: board.title, socialVideoUrl: board.socialVideoUrl,
      socialVideoRenderVersion: '', trailerVideoRenderVersion: '',
    }), 'cover');
    expect(await c.saveStackFinalScreen(board)).toBeTrue();
    expect(c.persistAndReplaceBoard).toHaveBeenCalledWith(jasmine.objectContaining({
      socialVideoClosingHeadline: 'Read on', socialLandscapeVideoRenderVersion: '',
    }), 'final-screen');
  });

  it('routes a fresh narration revision through the card-only write', async () => {
    const c = harness();
    c.persistAndReplaceBoard.and.resolveTo(false);
    c.boardsSyncError.set('Firebase denied the save (permission-denied).');
    await c.regenerateStackScriptCardNarration(board.cards[0]);
    expect(c.persistAndReplaceBoard).toHaveBeenCalledWith(jasmine.objectContaining({
      socialVideoUrl: board.socialVideoUrl,
      cards: [jasmine.objectContaining({ videoNarrationRevision: 2 })],
      trailerVideoRenderVersion: '',
    }), 'fresh-narration');
    expect(c.stackScriptError()).toContain('permission-denied');
  });

  it('restores the last saved music and voice after rejected writes', async () => {
    const c = harness();
    c.boardsSyncError.set('Firebase denied the save (permission-denied).');
    c.persistStackAudioPreferences = jasmine.createSpy('music').and.resolveTo(false);
    c.persistStackNarratorPreference = jasmine.createSpy('voice').and.resolveTo(false);

    c.saveStackAudioPreferences(board);
    c.saveStackNarratorPreference(board);
    await Promise.resolve();
    await Promise.resolve();

    expect(c.stackAudioTrackId()).toBe(board.socialVideoAudioTrackId);
    expect(c.stackAudioVolume()).toBe(board.socialVideoAudioVolume);
    expect(c.stackAudioError()).toContain('permission-denied');
    expect(c.stackNarratorVoiceId()).toBe(board.stackNarratorVoiceId);
    expect(c.stackVoiceError()).toContain('permission-denied');
    expect(c.boards()[0]).toBe(board);
    expect(c.stackPublishedVideoReady()).toBeTrue();
    expect(c.stackPublishedTrailerReady()).toBeTrue();
  });

  it('invalidates render versions for a card edit while keeping published video URLs', async () => {
    const c = harness();
    c.persistAndReplaceBoard = BoardsComponent.prototype['persistAndReplaceBoard'];
    c.persistBoardStudio = jasmine.createSpy('focused card write').and.callFake(async (value: any) => value);
    const edited = { ...board, cards: [{ ...board.cards[0], notes: 'Updated card.' }],
      socialVideoRenderVersion: 'old-render', trailerVideoRenderVersion: 'old-trailer',
      updatedAt: '2026-09-23T12:00:00.000Z' };
    c.boards.set([edited]);

    expect(await c.persistAndReplaceBoard(edited, 'cards')).toBeTrue();
    expect(c.persistBoardStudio).toHaveBeenCalledWith(jasmine.objectContaining({
      socialVideoUrl: board.socialVideoUrl, trailerVideoUrl: board.trailerVideoUrl,
      socialVideoRenderVersion: '', trailerVideoRenderVersion: '',
    }), 'cards');
    expect(c.boards()[0].socialVideoRenderVersion).toBe('');
    expect(c.boards()[0].cards[0].notes).toBe('Updated card.');
  });

  it('routes display toggles through a focused settings write without clearing video URLs', async () => {
    const c = harness();
    await c.setBoardShowCardNumbers(board, false);
    expect(c.persistAndReplaceBoard).toHaveBeenCalledWith(jasmine.objectContaining({
      showCardNumbers: false, socialVideoUrl: board.socialVideoUrl,
      trailerVideoUrl: board.trailerVideoUrl, socialVideoRenderVersion: '',
    }), 'settings');
    await c.setBoardInsideDisplay(board, 'alongside');
    expect(c.persistAndReplaceBoard).toHaveBeenCalledWith(jasmine.objectContaining({
      insideCardsDisplay: 'alongside', socialVideoUrl: board.socialVideoUrl,
    }), 'settings');
  });

  it('keeps the general editor open and restores the last saved board on a rejected write', async () => {
    const c = harness();
    const previous = { ...board, visibility: 'public', backNote: '', icon: 'space_dashboard',
      tone: 'teal', logoUrl: '', logoLinkUrl: '', stackCtaLabel: '', stackCtaUrl: '', stickers: [] };
    c.boards.set([previous]);
    c.editingBoardId = signal(board.id);
    c.creatingBoardInside = signal(null);
    c.boardDraft = signal({ title: 'Edited title', description: board.description,
      backNote: '', icon: 'space_dashboard', tone: 'teal', visibility: 'public',
      imageUrl: '', logoUrl: '', logoLinkUrl: '', stackCtaLabel: '', stackCtaUrl: '', stickers: [] });
    c.boardDialogError = signal(null);
    c.isVisibilityOnlyBoardEdit = () => false;
    c.closeBoardDialog = jasmine.createSpy('close editor');
    c.persistAndReplaceBoard.and.resolveTo(false);
    c.boardsSyncError.set('Firebase denied the save (permission-denied).');

    await c.saveBoardDraft(new Event('submit'));

    expect(c.boards()[0]).toBe(previous);
    expect(c.boardDialogError()).toContain('permission-denied');
    expect(c.closeBoardDialog).not.toHaveBeenCalled();
  });
});
