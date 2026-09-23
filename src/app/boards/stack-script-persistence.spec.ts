import { signal } from '@angular/core';
import { BoardsComponent } from './boards';
import { applyBoardTranslation } from './board-translation';
import { listingContactCardDetails } from './listing-contact-card';

const fullScript = 'The kitchen opens to the dining room. Windows overlook the garden. A covered porch adjoins the kitchen.';

// Exercise the actual editor, save orchestration, and Firestore record reader.
function harness(records: any[] = [{ id: 'room', title: 'Kitchen', notes: fullScript }]): any {
  const c = Object.create(BoardsComponent.prototype);
  c.cardTypes = [{ id: 'place' }, { id: 'note' }];
  c.cardScopes = [{ id: 'general' }, { id: 'place' }];
  c.cardStatuses = [{ id: 'saved' }, { id: 'planned' }];
  const cards = records.map(record => c.cardFromRecord(record));
  const board = { id: 'board', title: 'Home', description: '', cards, imageUrl: '' };
  Object.assign(c, {
    boards: signal([board]), stackBoard: () => c.boards()[0],
    stackScriptAdjustmentRequest: 0, stackStudioOpen: signal(true),
    stackScriptCardDrafts: signal(Object.fromEntries(cards.map((card: any) => [card.id, {
      title: card.title, subtitle: card.subtitle, narration: c.persistedStackCardNarrationText(card),
    }]))),
    stackSelectedCardIds: signal(new Set(cards.map((card: any) => card.id))),
    stackSelectedCards: () => c.stackBoard().cards.filter((card: any) => c.stackSelectedCardIds().has(card.id)),
    stackScriptLengthSourceNarrations: signal(Object.fromEntries(cards.map((card: any) => [card.id, card.stackNarrationSource || c.persistedStackCardNarrationText(card)]))),
    stackScriptShortening: signal(false), stackScriptShortenMenuOpen: signal(false),
    stackScriptShortenUndoNarrations: signal(null), stackScriptShortenNotice: signal(null),
    stackScriptError: signal(null), boardsSyncError: signal(null), stackScriptSaving: signal(false), stackCoverSaving: signal(false),
    stackScriptBoardTitle: signal('Home'), stackScriptBoardDescription: signal(''), stackCoverImageDraft: signal(''),
    stackScriptOriginalSnapshot: signal(''), stackScriptSavedAt: signal(''),
    publishedStackVideoFiles: new Map(), publishedStackTrailerFiles: new Map(),
    stackPublishedVideoReady: signal(true), stackPublishedTrailerReady: signal(true),
    stackScriptSnapshot: () => JSON.stringify(c.stackScriptCardDrafts()),
    stackScriptMissingCount: () => 0, canEditBoard: () => true, isPhotoStudioDraft: () => false,
    isPhotoStoryBoard: () => false, applyStackCoverState: () => {}, setStackShareMessage: () => {},
    stopStackPlayback: jasmine.createSpy('stop playback'),
    requestStackScriptRewrite: jasmine.createSpy('rewrite').and.rejectWith(new Error('Offline')),
    persistAndReplaceBoard: jasmine.createSpy('persist').and.callFake(async (next: any) => {
      c.boards.set([{ ...next, cards: JSON.parse(JSON.stringify(next.cards)).map((record: any) => c.cardFromRecord(record)) }]);
      return true;
    }),
  });
  return c;
}

describe('script adjustment persistence', () => {
  it('recovers from malformed rewrite entries without leaving the editor busy', async () => {
    const c = harness();
    c.requestStackScriptRewrite.and.resolveTo([null, {}, {cardId:'room',narration:42}]);
    await c.shortenEntireStackScript(1);
    expect(c.stackScriptShortening()).toBeFalse();
    expect(c.stackScriptCardDrafts().room.narration).toBe('The kitchen opens to the dining room.');
  });
  it('shortens offline, saves, reloads, and expands from the approved source', async () => {
    let c = harness();
    await c.shortenEntireStackScript(1);
    expect(c.stackScriptCardDrafts().room.narration).toBe('The kitchen opens to the dining room.');
    expect(await c.saveStackScript(c.stackBoard())).toBeTrue();
    expect(c.persistAndReplaceBoard).toHaveBeenCalledWith(jasmine.any(Object), 'script');
    const saved = c.stackBoard();
    expect(saved.cards[0].stackNarrationSource).toBe(fullScript);
    expect(saved.cards[0].videoNarrationRevision).toBe(1);
    expect(saved.socialVideoRenderVersion).toBe('');
    expect(saved.socialLandscapeVideoRenderVersion).toBe('');
    expect(saved.trailerVideoRenderVersion).toBe('');
    expect(saved.trailerLandscapeVideoRenderVersion).toBe('');
    expect(c.stackPublishedVideoReady()).toBeFalse();
    expect(c.stackPublishedTrailerReady()).toBeFalse();
    c = harness(saved.cards);
    await c.shortenEntireStackScript(3);
    expect(c.stackScriptCardDrafts().room.narration).toBe(fullScript);
    expect(await c.saveStackScript(c.stackBoard())).toBeTrue();
    expect(c.persistedStackCardNarrationText(c.stackBoard().cards[0])).toBe(fullScript);
  });

  it('keeps long approved sources intact through the actual record reader', () => {
    const source = fullScript.repeat(35);
    const c = harness([{id:'room',title:'Room',notes:'A short script.',stackNarrationSource:source}]);
    expect(c.stackBoard().cards[0].stackNarrationSource).toBe(source);
  });

  it('preserves contact actions when saving and translating a shorter spoken closing', async () => {
    const c = harness([{ id:'contact',title:'Contact Alex',tags:['listing-contact'],notes:fullScript,
      contactDetails:{name:'Alex',organization:'Example Realty',phone:'2125550100',email:'alex@example.com'} }]);
    await c.shortenEntireStackScript(1);
    await c.saveStackScript(c.stackBoard());
    const card = c.stackBoard().cards[0];
    expect(listingContactCardDetails(card).phoneHref).toBe('tel:2125550100');
    expect(listingContactCardDetails(card).emailHref).toBe('mailto:alex@example.com');
    expect(card.stackNarration).toBe(card.notes);
    const translated = applyBoardTranslation(c.stackBoard(), [{key:'cards.0.stackNarration',text:'Contactez Alex pour une visite.'}]);
    expect(c.persistedStackCardNarrationText(translated.cards[0])).toBe('Contactez Alex pour une visite.');
    expect(translated.cards[0].contactDetails).toEqual(card.contactDetails);
  });

  it('undoes a real adjustment after a repeated no-op adjustment', async () => {
    const c = harness();
    await c.shortenEntireStackScript(1);
    await c.shortenEntireStackScript(1);
    c.undoStackScriptShortening();
    expect(c.stackScriptCardDrafts().room.narration).toBe(fullScript);
  });

  it('does not resurrect stale claims after an author edits the script', async () => {
    const c = harness();
    await c.shortenEntireStackScript(1);
    c.updateStackScriptCard('room', 'narration', 'The kitchen faces the courtyard.');
    await c.shortenEntireStackScript(3);
    expect(c.stackScriptCardDrafts().room.narration).toBe('The kitchen faces the courtyard.');
    expect(c.stackScriptLengthSourceNarrations().room).toBe('The kitchen faces the courtyard.');
  });

  it('keeps drafts and their full source when a save fails', async () => {
    const c = harness();
    await c.shortenEntireStackScript(1);
    c.persistAndReplaceBoard.and.resolveTo(false);
    c.boardsSyncError.set('Firebase denied the save (permission-denied).');
    expect(await c.saveStackScript(c.stackBoard())).toBeFalse();
    expect(c.stackScriptError()).toContain('draft is still here');
    expect(c.stackScriptError()).toContain('permission-denied');
    expect(c.stackScriptLengthSourceNarrations().room).toBe(fullScript);
    expect(c.stackScriptSaving()).toBeFalse();
  });

  it('does not let a delayed rewrite overwrite a manual edit or save mid-adjustment', async () => {
    const c = harness();
    let finish!: (value: any[]) => void;
    c.requestStackScriptRewrite.and.returnValue(new Promise(resolve => { finish = resolve; }));
    const pending = c.shortenEntireStackScript(1);
    expect(await c.saveStackScript(c.stackBoard())).toBeFalse();
    c.updateStackScriptCard('room', 'narration', 'An approved manual change.');
    finish([{cardId:'room',narration:'The kitchen opens to the dining room.'}]);
    await pending;
    expect(c.stackScriptCardDrafts().room.narration).toBe('An approved manual change.');
    expect(c.persistAndReplaceBoard).not.toHaveBeenCalled();
  });

  it('ignores an old session response even when the same board has reopened', async () => {
    const c = harness();
    let finish!: (value: any[]) => void;
    c.requestStackScriptRewrite.and.returnValue(new Promise(resolve => { finish = resolve; }));
    const pending = c.shortenEntireStackScript(1);
    c.stackScriptAdjustmentRequest++; // close/reopen starts another session
    c.stackScriptShortening.set(true); // a newer request owns the spinner
    finish([{cardId:'room',narration:'The kitchen opens to the dining room.'}]);
    await pending;
    expect(c.stackScriptCardDrafts().room.narration).toBe(fullScript);
    expect(c.stackScriptShortening()).toBeTrue();
  });
});
