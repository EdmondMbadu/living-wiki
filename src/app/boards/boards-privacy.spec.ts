import { signal } from '@angular/core';
import { BoardsComponent } from './boards';

// Exercise the real save/render orchestration without starting gallery subscriptions.
function harness(): any {
  const component = Object.create(BoardsComponent.prototype);
  Object.assign(component, {
    authService: { uid: () => 'owner' },
    isBrowser: true,
    storage: {},
    firestore: null,
    boards: signal([]),
    boardTranslationActive: () => false,
    stackVideoExporting: signal(false),
    stackVideoBrandingLoading: () => false,
    stackVideoBrandingSaving: () => false,
    stackVideoBrandingUploading: () => false,
    stackVideoNarrationEnabled: () => false,
    stackTrailerNarrationEnabled: () => false,
    stackNarratorVoiceId: () => 'default',
    stackAudioTrackId: () => '',
    stackAudioVolume: () => 0.2,
    stackShareMode: () => 'video',
    stackSharePreviewRatio: () => 'vertical',
    stackVideoProgress: signal(0),
    stackVideoVerticalProgress: signal(0),
    stackVideoLandscapeProgress: signal(0),
    stackVideoRenderingRatio: signal(null),
    stackPublishedVideoReady: signal(false),
    stackPublishedTrailerReady: signal(false),
    publishedStackVideoFiles: new Map(),
    publishedStackTrailerFiles: new Map(),
    setStackShareMessage: jasmine.createSpy('message'),
    stackBoardWithSavedVideoSettings: async (board: unknown) => board,
    stackBoardWithSavedScript: async (board: unknown) => board,
    stackCoverImage: () => '',
    boardRouteRoot: () => '/boards',
    stackRatio: () => 'vertical',
  });
  return component;
}

function savedBoard(component: any, overrides: Record<string, unknown> = {}): any {
  return component.boardFromRecord('board-1', {
    owner_user_id: 'owner', title: 'Photo story', visibility: 'private',
    photoStoryBoard: true, photoStudioDraft: true, cards: [], ...overrides,
  });
}

describe('board privacy and video creation', () => {
  it('restores the saved privacy setting if the settings write fails', async () => {
    const component = harness();
    const board = savedBoard(component);
    Object.assign(component, {
      boardSettingsBoard: () => board,
      boardSettingsDraft: signal({ title: board.title, description: board.description,
        visibility: 'public', showCardNumbers: true, insideCardsDisplay: 'nested' }),
      boardSettingsSaving: signal(false),
      boardSettingsError: signal(null),
      canUsePrivateBoards: () => true,
      persistVisibilityAndReplaceBoard: jasmine.createSpy('save').and.resolveTo(false),
    });
    component.boards.set([board]);
    await component.saveBoardSettings(new Event('submit'));
    expect(component.persistVisibilityAndReplaceBoard).toHaveBeenCalled();
    expect(component.boards()[0].visibility).toBe('private');
    expect(component.boardSettingsError()).toContain('could not be saved');
    expect(component.boardSettingsSaving()).toBeFalse();
  });

  it('keeps an already-public photo draft public through reload and subsequent full saves', async () => {
    const component = harness();
    const board = savedBoard(component, { visibility: 'public' });
    expect(board.visibility).toBe('public');
    expect(board.photoStudioDraft).toBeFalse();
    const persisted = await component.persistBoard({ ...board, photoStudioDraft: true });
    expect(persisted.visibility).toBe('public');
    expect(persisted.photoStudioDraft).toBeFalse();
    expect((await component.persistBoard(savedBoard(component))).visibility).toBe('private');
  });

  for (const videoKind of ['full', 'trailer'] as const) {
    for (const photoStudioDraft of [false, true]) {
      it(`creates both ${videoKind} formats for a private ${photoStudioDraft ? 'photo draft' : 'board'} without publishing`, async () => {
        const component = harness();
        const board = savedBoard(component, { photoStudioDraft });
        component.boards.set([board]);
        const result = { blob: new Blob(['video'], { type: 'video/mp4' }), extension: 'mp4', mimeType: 'video/mp4', durationSeconds: 4 };
        const pair = { vertical: result, landscape: result };
        component.createStackVideoPair = jasmine.createSpy('render').and.resolveTo(pair);
        component.createStackTrailerPair = jasmine.createSpy('trailer').and.resolveTo({ results: pair, script: 'A story', fingerprint: 'f', cardIds: [] });
        component.uploadPublishedStackVariant = jasmine.createSpy('public upload').and.rejectWith(new Error('Must not publish'));
        component.videoLibrary = {
          saveLatestBoardVideo: jasmine.createSpy('save private video').and.resolveTo({
            videoUrl: 'https://example.test/private-phone.mp4', storagePath: 'users/owner/video-library/phone.mp4',
            landscapeVariant: { videoUrl: 'https://example.test/private-landscape.mp4', storagePath: 'users/owner/video-library/landscape.mp4' },
          }),
        };

        await (videoKind === 'full' ? component.publishStackVideo(board) : component.publishStackTrailer(board));

        expect(component.videoLibrary.saveLatestBoardVideo).toHaveBeenCalledTimes(1);
        const input = component.videoLibrary.saveLatestBoardVideo.calls.mostRecent().args[0];
        expect(input.videoKind).toBe(videoKind);
        expect(input.landscapeVariant.blob).toBe(result.blob);
        expect(input.publicShareUrl).toBeUndefined();
        expect(input.publicStoragePath).toBeUndefined();
        expect(component.uploadPublishedStackVariant).not.toHaveBeenCalled();
        const updated = component.boards()[0];
        expect(updated.visibility).toBe('private');
        expect(updated.photoStudioDraft).toBe(photoStudioDraft);
        expect(updated[videoKind === 'full' ? 'socialVideoUrl' : 'trailerVideoUrl']).toContain('private-phone');
        expect(updated[videoKind === 'full' ? 'socialLandscapeVideoUrl' : 'trailerLandscapeVideoUrl']).toContain('private-landscape');
        expect(component.stackSelectedShareUrl(updated)).toBe('');
        expect(component.stackVideoExporting()).toBeFalse();
      });
    }
  }

  it('does not report a private video as ready when library saving fails', async () => {
    const component = harness();
    const board = savedBoard(component);
    component.boards.set([board]);
    const result = { blob: new Blob(['video']), extension: 'mp4', mimeType: 'video/mp4', durationSeconds: 4 };
    component.createStackVideoPair = async () => ({ vertical: result, landscape: result });
    component.saveStackVideoToLibrary = async () => false;
    await component.publishStackVideo(board);
    expect(component.boards()[0].socialVideoUrl).toBe('');
    expect(component.stackPublishedVideoReady()).toBeFalse();
    expect(component.setStackShareMessage).toHaveBeenCalledWith(jasmine.stringMatching('could not be saved'), false);
  });

  it('keeps both public video formats on the existing public upload path', async () => {
    const component = harness();
    const board = savedBoard(component, { visibility: 'public' });
    const result = { blob: new Blob(['video']), extension: 'mp4', mimeType: 'video/mp4', durationSeconds: 4 };
    component.uploadPublishedStackVariant = jasmine.createSpy('upload').and.resolveTo({ path: 'public/video', url: 'https://example.test/video', file: new File([], 'video.mp4') });
    component.saveStackVideoToLibrary = jasmine.createSpy('private library');
    await component.storeStackVideoPair(board, { vertical: result, landscape: result }, 'full', 'now');
    expect(component.uploadPublishedStackVariant).toHaveBeenCalledTimes(2);
    expect(component.saveStackVideoToLibrary).not.toHaveBeenCalled();
  });

  it('rejects creating a video for another owner before rendering', async () => {
    const component = harness();
    component.createStackVideoPair = jasmine.createSpy('render');
    await component.publishStackVideo(savedBoard(component, { owner_user_id: 'another-owner' }));
    expect(component.createStackVideoPair).not.toHaveBeenCalled();
  });
});
