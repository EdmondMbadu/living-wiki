import { signal } from '@angular/core';
import type { TalkingCardEditorResult } from './talking-card';
import { BoardsComponent } from './boards';

const result: TalkingCardEditorResult = {
  atlasId: 'agent-atlas',
  title: 'Jenny Morgan',
  subtitle: 'Listing agent',
  imageUrl: '',
  openingMessage: 'Ask me about this home.',
  ctaLabel: 'Ask Jenny',
  actions: [],
  placement: 'end',
};

function harness(saved: boolean): any {
  const component = Object.create(BoardsComponent.prototype);
  const placeholder = {
    id: 'setup',
    title: 'Your Talking Card',
    tags: ['listing-talking-card-pla', 'author-only'],
    rank: 11,
    sourceUrl: '',
    createdAt: '2026-09-10T00:00:00.000Z',
  };
  const contact = { id: 'contact', title: 'Contact Jenny', tags: ['listing-contact'] };
  const board = { id: 'board', cards: [placeholder, contact], updatedAt: '' };
  const completeSave = jasmine.createSpy('completeSave').and.resolveTo();
  Object.assign(component, {
    boards: signal([board]),
    boardsSyncError: signal<string | null>(null),
    talkingCardEditorBoard: () => board,
    listingTalkingCardSetup: () => ({ boardId: board.id, placeholderCardId: placeholder.id }),
    canEditBoard: () => true,
    createId: () => 'guide',
    cardFromRecord: (value: unknown) => value,
    persistAndReplaceBoard: jasmine.createSpy('persistAndReplaceBoard').and.resolveTo(saved),
    closeTalkingCardEditor: jasmine.createSpy('closeTalkingCardEditor'),
    talkingCardEditor: { completeSave },
  });
  return { component, board, completeSave };
}

describe('Talking Card board persistence', () => {
  it('does not claim completion or replace local state when Firestore save fails', async () => {
    const { component, board, completeSave } = harness(false);

    await component.addTalkingCard(result);

    expect(component.persistAndReplaceBoard).toHaveBeenCalled();
    expect(component.boards()[0]).toBe(board);
    expect(component.closeTalkingCardEditor).not.toHaveBeenCalled();
    expect(completeSave).toHaveBeenCalledWith(jasmine.stringMatching(/could not be saved/i));
  });

  it('closes the editor only after Firestore confirms the Talking Card save', async () => {
    const { component, completeSave } = harness(true);

    await component.addTalkingCard(result);

    expect(completeSave).toHaveBeenCalledWith();
    expect(component.closeTalkingCardEditor).toHaveBeenCalled();
    const savedBoard = component.persistAndReplaceBoard.calls.mostRecent().args[0];
    expect(savedBoard.cards.map((card: { id: string }) => card.id)).toEqual(['guide', 'contact']);
  });
});
