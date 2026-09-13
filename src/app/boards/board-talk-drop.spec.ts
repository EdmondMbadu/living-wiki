import { signal } from '@angular/core';
import { BoardsComponent } from './boards';

const clip = { url: 'https://firebasestorage.googleapis.com/v0/b/test/o/users%2Fowner%2Fboards%2Ftalk-drops%2Fclip.mp4?alt=media', mimeType: 'video/mp4', fileName: 'Place.mp4' };

function harness(): any {
  const component = Object.create(BoardsComponent.prototype);
  Object.assign(component, {
    cardTypes: [{ id: 'place' }], cardScopes: [{ id: 'place' }], cardStatuses: [{ id: 'saved' }],
  });
  const card = component.cardFromRecord({ id: 'place', title: 'Quiet overlook', type: 'place', imageUrl: 'place.jpg', what3wordsAddress: 'filled.count.soap', talkDrop: clip });
  const board = { id: 'board', kind: 'off-grid', visibility: 'public', cards: [card], updatedAt: '' };
  Object.assign(component, {
    boards: signal([board]), selectedBoard: () => component.boards()[0],
    editingCardBoardId: () => 'board', editingCardId: signal('place'),
    cardTalkDropUploading: signal(false), imageUploadError: signal(null),
    relatedCardParentId: () => null, relatedCardEditingId: () => null,
    canEditBoard: () => true, isSongBoard: () => false,
    cardTourFromDraft: () => null,
    cardDraft: signal({ ...card, rating: '4', tags: 'off-grid', youtubeReference: '' }),
    persistAndReplaceBoard: jasmine.createSpy('persist').and.resolveTo(true),
    closeCardDialog: jasmine.createSpy('close'),
  });
  return component;
}

describe('Off-grid Talk Drop persistence', () => {
  it('opens the selected video when a card has both a Talk Drop and a YouTube link', () => {
    const component = harness();
    Object.assign(component, {
      cardVideoViewerKind: signal('youtube'), cardVideoViewerCardId: signal(null),
      cardVideoRepairNotice: signal(null), closeCardPhotoViewer: () => {},
      boardAnalytics: { trackCardOpen: () => {} },
    });
    const card = { ...component.boards()[0].cards[0], youtubeVideoId: 'dQw4w9WgXcQ' };
    component.openCardVideoViewer(card, undefined, 'talk-drop');
    expect(component.cardVideoViewerKind()).toBe('talk-drop');
    expect(component.cardVideoViewerCardId()).toBe(card.id);
    component.openCardVideoViewer(card);
    expect(component.cardVideoViewerKind()).toBe('youtube');
    component.openWizardCardVideoViewer(card, undefined, 'talk-drop');
    expect(component.cardVideoViewerKind()).toBe('talk-drop');
  });

  it('preserves both media when reloading and editing a place', async () => {
    const component = harness();
    component.cardDraft.update((draft: any) => ({ ...draft, title: 'The overlook' }));
    await component.saveCard(new Event('submit'));
    const saved = component.persistAndReplaceBoard.calls.mostRecent().args[0].cards[0];
    const reloaded = component.cardFromRecord(JSON.parse(JSON.stringify(saved)));
    expect(reloaded.talkDrop).toEqual(clip);
    expect(reloaded.imageUrl).toBe('place.jpg');
    expect(reloaded.what3wordsAddress).toBe('filled.count.soap');
    expect(reloaded.title).toBe('The overlook');
  });

  it('can replace or remove a video without losing the photograph', async () => {
    const component = harness();
    const replacement = { ...clip, fileName: 'New recording.mp4', url: clip.url + '&token=replacement' };
    component.setCardTalkDrop(replacement);
    await component.saveCard(new Event('submit'));
    expect(component.boards()[0].cards[0].talkDrop).toEqual(replacement);
    component.setCardTalkDrop(null);
    await component.saveCard(new Event('submit'));
    expect(component.boards()[0].cards[0].talkDrop).toBeNull();
    expect(component.boards()[0].cards[0].imageUrl).toBe('place.jpg');
  });

  it('does not save an unfinished upload or close the editor after a failed save', async () => {
    const component = harness();
    component.cardTalkDropUploading.set(true);
    await component.saveCard(new Event('submit'));
    expect(component.persistAndReplaceBoard).not.toHaveBeenCalled();
    component.cardTalkDropUploading.set(false);
    component.persistAndReplaceBoard.and.resolveTo(false);
    component.editingCardId.set(null);
    await component.saveCard(new Event('submit'));
    expect(component.closeCardDialog).not.toHaveBeenCalled();
    expect(component.imageUploadError()).toContain('could not be saved');
    expect(component.cardDraft().talkDrop).toEqual(clip);
    expect(component.boards()[0].cards.length).toBe(1);
  });

  it('preserves the video through off-grid generation and draft normalization', () => {
    const component = harness();
    Object.assign(component, {
      wizardOffGridVerifiedLocations: () => ({}), wizardOffGridResolvedLocation: () => null,
      wizardOffGridTip: () => 'Come at sunset', wizardTargetBoardId: () => 'new',
      wizardOffGridName: () => 'Quiet overlook', wizardOffGridPhoto: () => 'place.jpg',
      wizardOffGridTalkDrop: () => clip,
      wizardPrompt: () => '', wizardTargetBoardTitle: () => 'Off-grid Places',
    });
    const batch = component.buildWhat3WordsWizardBatch({ title: '', issues: [], items: [{ name: 'Quiet overlook', words: 'filled.count.soap' }] }, true);
    const normalized = component.normalizeWizardGeneratedCard(JSON.parse(JSON.stringify(batch.cards[0])));
    expect(normalized.talkDrop).toEqual(clip);
    expect(normalized.imageUrl).toBe('place.jpg');
    expect(component.wizardCardToCurrentCard(normalized).talkDrop).toEqual(clip);
  });
});
