import { signal } from '@angular/core';
import { FirebaseError } from 'firebase/app';
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

function ordinaryBoardHarness(saved = true): any {
  const context = harness(saved);
  const { component, board } = context;
  // Exercise the same card normalization used when loading saved boards.
  delete component.cardFromRecord;
  Object.assign(component, {
    cardTypes: [{ id: 'note' }],
    cardScopes: [{ id: 'place' }],
    cardStatuses: [{ id: 'saved' }],
    listingTalkingCardSetup: () => null,
  });
  board.title = 'An Introduction to Wet AMD';
  board.cards = [
    component.cardFromRecord({ id: 'intro', title: 'Introduction', type: 'note' }),
    component.cardFromRecord({ id: 'information', title: 'Learn more', type: 'note' }),
  ];
  return context;
}

describe('Talking Card board persistence', () => {
  for (const placement of ['start', 'end'] as const) {
    it(`saves a Talking Card at the ${placement} of an ordinary board and reloads its conversation`, async () => {
      const { component, board, completeSave } = ordinaryBoardHarness();
      const originalCards = [...board.cards];
      const value: TalkingCardEditorResult = {
        ...result, placement, title: 'Patient guide', subtitle: 'Ask a question',
        openingMessage: 'What would you like to learn about?', ctaLabel: 'Ask the guide',
        imageUrl: 'https://example.com/guide.jpg',
        actions: [{ id: 'learn-more', kind: 'link', label: 'Learn more', url: 'https://example.com/information' }],
      };

      await component.addTalkingCard(value);

      const [savedBoard, intent] = component.persistAndReplaceBoard.calls.mostRecent().args;
      expect(intent).toBe('cards');
      expect(savedBoard.id).toBe(board.id);
      expect(savedBoard.cards.map((card: any) => card.id)).toEqual(
        placement === 'end' ? ['intro', 'information', 'guide'] : ['guide', 'intro', 'information'],
      );
      expect(savedBoard.cards.filter((card: any) => card.id !== 'guide')).toEqual(originalCards);
      const reloaded = component.cardFromRecord(JSON.parse(JSON.stringify(savedBoard.cards.find((card: any) => card.id === 'guide'))));
      expect(component.isTalkingCard(reloaded)).toBeTrue();
      expect(reloaded.conversation).toEqual({
        version: 1, provider: 'atlas', atlasId: value.atlasId,
        openingMessage: value.openingMessage, ctaLabel: value.ctaLabel, actions: value.actions,
      });
      expect(reloaded.imageUrls).toEqual([value.imageUrl]);
      expect(reloaded.authorOnly).toBeFalse();
      expect(completeSave).toHaveBeenCalledWith();
      expect(component.closeTalkingCardEditor).toHaveBeenCalled();
    });
  }

  it('edits an existing ordinary Talking Card without duplicating it or moving it', async () => {
    const { component, board } = ordinaryBoardHarness();
    const originalCards = [...board.cards];
    const existing = component.cardFromRecord({
      id: 'guide', title: 'Patient guide', type: 'note',
      conversation: { provider: 'atlas', atlasId: 'original-avatar', openingMessage: 'Welcome', starters: ['Where do I start?'] },
    });
    board.cards = [originalCards[0], existing, originalCards[1]];

    await component.addTalkingCard({ ...result, cardId: 'guide', title: 'Updated guide', placement: 'keep' });

    const savedBoard = component.persistAndReplaceBoard.calls.mostRecent().args[0];
    expect(savedBoard.cards.map((card: any) => card.id)).toEqual(['intro', 'guide', 'information']);
    expect(savedBoard.cards[1].title).toBe('Updated guide');
    expect(savedBoard.cards[1].conversation.atlasId).toBe(result.atlasId);
    expect(savedBoard.cards[1].conversation.starters).toEqual(['Where do I start?']);
    expect(savedBoard.cards.filter((card: any) => card.id !== 'guide')).toEqual(originalCards);
  });

  it('keeps the ordinary board and editor intact if adding the card fails', async () => {
    const { component, board, completeSave } = ordinaryBoardHarness(false);
    const originalCards = [...board.cards];

    await component.addTalkingCard(result);

    expect(component.boards()[0].cards).toEqual(originalCards);
    expect(component.closeTalkingCardEditor).not.toHaveBeenCalled();
    expect(completeSave).toHaveBeenCalledWith(jasmine.stringMatching(/could not be saved/i));
  });

  it('does not claim completion or replace local state when Firestore save fails', async () => {
    const { component, board, completeSave } = harness(false);

    await component.addTalkingCard(result);

    expect(component.persistAndReplaceBoard).toHaveBeenCalled();
    expect(component.boards()[0]).toBe(board);
    expect(component.closeTalkingCardEditor).not.toHaveBeenCalled();
    expect(completeSave).toHaveBeenCalledWith(jasmine.stringMatching(/could not be saved/i));
  });

  it('preserves the underlying Firebase error in the modal instead of blaming the connection', async () => {
    const { component, completeSave } = harness(false);
    const error = 'Firebase denied the save (permission-denied). Check board ownership, visibility, and content limits.';
    component.boardsSyncError.set(error);
    await component.addTalkingCard(result);
    expect(completeSave).toHaveBeenCalledWith(error);
    expect(component.closeTalkingCardEditor).not.toHaveBeenCalled();
  });

  for (const error of [
    new FirebaseError('invalid-argument', 'Document boards/board cannot be written because its size (1100000 bytes) exceeds the maximum allowed size (1048576 bytes).'),
    new FirebaseError('resource-exhausted', 'The document size exceeds the maximum allowed size.'),
    { code: 'functions/invalid-argument', message: 'maximum entity size is 1048576 bytes' },
  ]) {
    it(`explains the board size limit in the Talking Card modal for ${error.code}`, async () => {
      const { component, completeSave } = harness(false);
      const message = component.boardSaveErrorMessage(error);
      expect(message).toContain('1 MiB (1,048,576 bytes)');
      expect(message).toContain('split the cards across smaller boards');
      expect(message).not.toContain('connection');
      component.boardsSyncError.set(message);

      await component.addTalkingCard(result);

      expect(completeSave).toHaveBeenCalledWith(message);
      expect(component.closeTalkingCardEditor).not.toHaveBeenCalled();
    });
  }

  it('explains an oversized field without calling it a total board size failure', () => {
    const { component } = harness(false);
    const message = component.boardSaveErrorMessage(new FirebaseError(
      'invalid-argument', 'The value of property "cards" is longer than 1048487 bytes.',
    ));
    expect(message).toContain('One field on this board');
    expect(message).toContain('Shorten long card text');
    expect(message).not.toContain('1,048,576');
  });

  it('does not misdiagnose a quota failure as oversized content', () => {
    const { component } = harness(false);
    const message = component.boardSaveErrorMessage(new FirebaseError('resource-exhausted', 'Quota exceeded.'));
    expect(message).toContain('quota limit (resource-exhausted)');
    expect(message).toContain('Try again later');
    expect(message).not.toContain('Shorten');
    expect(message).not.toContain('1 MiB');
  });

  it('keeps unrelated invalid arguments separate from size failures', () => {
    const { component } = harness(false);
    expect(component.boardSaveErrorMessage(new FirebaseError('invalid-argument', 'Invalid document path.')))
      .toContain('Firebase save failed (invalid-argument)');
  });

  it('includes current text limits in a rule denial without asserting that size caused it', () => {
    const { component } = harness(false);
    const message = component.boardSaveErrorMessage(new FirebaseError('permission-denied', 'Missing or insufficient permissions.'));
    expect(message).toContain('Check board ownership and visibility');
    expect(message).toContain('If you edited the board text');
    expect(message).toContain('titles allow 240 characters');
    expect(message).toContain('descriptions allow 5,000');
  });

  for (const visibility of ['public', 'unlisted']) {
    it(`allows a ${visibility} board to use its owner's private avatar`, async () => {
      const { component, board } = ordinaryBoardHarness();
      board.visibility = visibility;
      board.ownerUserId = 'owner';
      board.cards.push({ id: 'guide', conversation: { atlasId: 'private-avatar' } });
      component.atlasService = { getAccessibleAtlasById: jasmine.createSpy().and.resolveTo({ user_id: 'owner', is_public: false }) };
      await expectAsync(component.assertBoardVisitorKnowledge(board)).toBeResolved();
    });
  }

  it('closes the editor only after Firestore confirms the Talking Card save', async () => {
    const { component, completeSave } = harness(true);

    await component.addTalkingCard(result);

    expect(completeSave).toHaveBeenCalledWith();
    expect(component.closeTalkingCardEditor).toHaveBeenCalled();
    const savedBoard = component.persistAndReplaceBoard.calls.mostRecent().args[0];
    expect(savedBoard.cards.map((card: { id: string }) => card.id)).toEqual(['guide', 'contact']);
  });
});
