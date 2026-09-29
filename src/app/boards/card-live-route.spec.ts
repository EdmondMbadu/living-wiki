import { signal } from '@angular/core';
import { BoardsComponent } from './boards';

describe('shared card Live route', () => {
  function harness(cardId: string, cards: any[]) {
    const component: any = Object.create(BoardsComponent.prototype);
    const board = { id: 'board', cards };
    const frames = [
      { kind: 'cover' },
      ...cards.map((card) => ({ kind: 'card', card })),
      { kind: 'closing' },
    ];
    Object.assign(component, {
      requestedCardId: signal(cardId),
      selectedBoard: () => board,
      boardRouteLoadState: signal({ requestId: 1, routeKey: 'board', complete: true }),
      cardLiveRouteKey: '',
      stackDirectView: signal(false),
      stackFrameIndex: signal(0),
      stackCardPhotoIndex: signal(2),
      stackPlaying: signal(false),
      stackTourNarrationConsent: signal(false),
      stackNarrationNeedsGesture: signal(false),
      stackFrames: () => frames,
      stackCurrentFrame: () => frames[component.stackFrameIndex()],
      stackCurrentNarrationFrame: () => frames[component.stackFrameIndex()],
      stopStackPlayback: jasmine.createSpy('stopStackPlayback'),
      syncStackDirectView: jasmine.createSpy('syncStackDirectView'),
      startStackPlayback: jasmine.createSpy('startStackPlayback'),
      unlockStackNarrationAudio: jasmine.createSpy('unlockStackNarrationAudio').and.resolveTo(undefined),
      syncStackNarrationAfterFrameChange: jasmine.createSpy('syncStackNarrationAfterFrameChange'),
    });
    return component;
  }

  it('selects the exact narrated card before starting its voice', () => {
    const component = harness('second', [
      { id: 'first', title: 'First' },
      { id: 'second', title: 'Second', notes: 'The second card narration.' },
    ]);
    component.startStackPlayback.and.callFake(() => expect(component.stackFrameIndex()).toBe(2));

    component.syncRequestedCardRoute();

    expect(component.stackDirectView()).toBeTrue();
    expect(component.stackFrameIndex()).toBe(2);
    expect(component.stackCardPhotoIndex()).toBe(0);
    expect(component.stackTourNarrationConsent()).toBeTrue();
    expect(component.stackNarrationNeedsGesture()).toBeTrue();
    expect(component.syncStackDirectView).toHaveBeenCalledWith({ deferPlayback: true });
    expect(component.startStackPlayback).toHaveBeenCalledTimes(1);

    component.syncRequestedCardRoute();
    expect(component.startStackPlayback).toHaveBeenCalledTimes(1);
  });

  it('unlocks and starts the same card when the visitor taps Play', async () => {
    const component = harness('second', [
      { id: 'first', title: 'First' },
      { id: 'second', title: 'Second', notes: 'Narrate the second card.' },
    ]);
    component.syncRequestedCardRoute();

    await component.replayStackCurrentNarration(new Event('click'));

    expect(component.stackFrameIndex()).toBe(2);
    expect(component.unlockStackNarrationAudio).toHaveBeenCalledTimes(1);
    expect(component.stackNarrationNeedsGesture()).toBeFalse();
    expect(component.syncStackNarrationAfterFrameChange).toHaveBeenCalledWith({ autoAdvance: true, forceNarration: true });
  });

  it('leaves cards without Live narration in the focused card view', () => {
    const component = harness('silent', [{ id: 'silent', title: '' }]);

    component.syncRequestedCardRoute();

    expect(component.stackDirectView()).toBeFalse();
    expect(component.startStackPlayback).not.toHaveBeenCalled();
  });
});
