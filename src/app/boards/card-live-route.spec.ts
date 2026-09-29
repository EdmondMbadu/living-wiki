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
      stackTourNarrationConsent: signal(false),
      stackNarrationNeedsGesture: signal(false),
      stackFrames: () => frames,
      stopStackPlayback: jasmine.createSpy('stopStackPlayback'),
      syncStackDirectView: jasmine.createSpy('syncStackDirectView'),
      startStackPlayback: jasmine.createSpy('startStackPlayback'),
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
    expect(component.syncStackDirectView).toHaveBeenCalledWith({ deferPlayback: true });
    expect(component.startStackPlayback).toHaveBeenCalledTimes(1);

    component.syncRequestedCardRoute();
    expect(component.startStackPlayback).toHaveBeenCalledTimes(1);
  });

  it('leaves cards without Live narration in the focused card view', () => {
    const component = harness('silent', [{ id: 'silent', title: '' }]);

    component.syncRequestedCardRoute();

    expect(component.stackDirectView()).toBeFalse();
    expect(component.startStackPlayback).not.toHaveBeenCalled();
  });
});
