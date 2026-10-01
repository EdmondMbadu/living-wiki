import { computed, signal } from '@angular/core';
import { BoardsComponent } from './boards';
import { CARD_CREATION_OPTIONS } from './card-creation';

function harness(): any {
  const component = Object.create(BoardsComponent.prototype);
  const board = {
    id: 'wet-amd', title: 'An Introduction to Wet AMD', description: '',
    ownerUserId: 'owner', visibility: 'public', kind: 'standard', cards: [],
  };
  Object.assign(component, {
    boards: signal([board, { ...board, id: 'history', title: 'William Penn' }]),
    selectedBoardId: signal('history'),
    boardTranslationActive: () => false,
    authService: { uid: signal('owner') },
    boardsSyncError: signal(null),
    cardTypeChooserBoardId: signal(null),
    specialCardEditorBoardId: signal(null),
    specialCardError: signal(null),
    talkingCardEditorBoardId: signal(null),
    talkingCardEditingCardId: signal(null),
    listingTalkingCardSetup: signal(null),
    openGeneralCardEditor: jasmine.createSpy('openGeneralCardEditor'),
    openSpecialCardEditor: jasmine.createSpy('openSpecialCardEditor'),
  });
  component.selectedBoard = computed(() => component.boards().find((item: any) => item.id === component.selectedBoardId()));
  component.cardTypeChooserBoard = computed(() => component.boards().find((item: any) => item.id === component.cardTypeChooserBoardId()));
  return { component, board };
}

describe('Adding a Talking Card from the board card chooser', () => {
  it('opens the existing avatar editor for the chosen board without a board-level toggle', () => {
    const { component, board } = harness();
    component.listingTalkingCardSetup.set({ boardId: 'old-listing', placeholderCardId: 'setup' });
    component.talkingCardEditingCardId.set('old-card');

    component.openCreateCard(board.id);
    expect(component.cardTypeChooserBoard()?.id).toBe(board.id);
    const talkingOption = CARD_CREATION_OPTIONS.find((option) => option.kind === 'talking');
    expect(talkingOption).toBeDefined();
    component.selectCardCreationType(talkingOption!.kind);

    expect(component.talkingCardEditorBoardId()).toBe(board.id);
    expect(component.cardTypeChooserBoardId()).toBeNull();
    expect(component.talkingCardEditingCardId()).toBeNull();
    expect(component.listingTalkingCardSetup()).toBeNull();
    expect(component.openGeneralCardEditor).not.toHaveBeenCalled();
    expect(component.openSpecialCardEditor).not.toHaveBeenCalled();
  });

  it('can cancel and then open a Talking Card on a different board', () => {
    const { component } = harness();
    component.openCreateCard('wet-amd');
    component.selectCardCreationType('talking');
    component.closeTalkingCardEditor();
    expect(component.talkingCardEditorBoardId()).toBeNull();

    component.openCreateCard('history');
    component.selectCardCreationType('talking');
    expect(component.talkingCardEditorBoardId()).toBe('history');
  });

  it('retains the specialized setup for a real-estate board', () => {
    const { component, board } = harness();
    component.boards.set([{ ...board, cards: [{ id: 'room', tags: ['real-estate', 'listing'] }] }]);
    component.openCreateCard(board.id);
    component.selectCardCreationType('talking');
    expect(component.talkingCardEditorBoardId()).toBe(board.id);
    expect(component.listingTalkingCardSetup()).toEqual({ boardId: board.id, placeholderCardId: '' });
  });

  it('does not let a visitor open the chooser or Talking Card editor', () => {
    const { component, board } = harness();
    component.authService.uid.set('visitor');
    component.openCreateCard(board.id);
    component.openTalkingCardEditor(board.id);
    expect(component.cardTypeChooserBoardId()).toBeNull();
    expect(component.talkingCardEditorBoardId()).toBeNull();
  });

  it('rechecks edit access when selecting a card type', () => {
    const { component, board } = harness();
    component.openCreateCard(board.id);
    component.authService.uid.set(null);
    component.selectCardCreationType('talking');
    expect(component.talkingCardEditorBoardId()).toBeNull();
  });

  it('does not open an editor if the chosen board is no longer available', () => {
    const { component, board } = harness();
    component.openCreateCard(board.id);
    component.boards.set([]);
    component.selectCardCreationType('talking');
    expect(component.talkingCardEditorBoardId()).toBeNull();
  });
});
