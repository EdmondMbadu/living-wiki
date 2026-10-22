import { signal } from '@angular/core';
import { BoardsComponent } from './boards';
import { BOARD_TRANSLATION_SCHEMA_VERSION, type BoardTranslationResult } from './board-translation';
import { LIVE_LANGUAGE_STORAGE_KEY, liveLanguageEntry, savedLiveLanguage } from './live-language';
import { LiveTranslationQueue } from './live-translation-queue';

describe('Live visitor language', () => {
  it('defaults to English and prompts only when the board asks and no preference exists', () => {
    expect(liveLanguageEntry({ saved: null, explicit: null, ask: false })).toEqual({ language: 'en', prompt: false, translate: true });
    expect(liveLanguageEntry({ saved: null, explicit: null, ask: true }).prompt).toBeTrue();
    expect(liveLanguageEntry({ saved: 'de', explicit: null, ask: true })).toEqual({ language: 'de', prompt: false, translate: true });
    expect(liveLanguageEntry({ saved: 'zh', explicit: 'original', ask: false }).language).toBe('zh');
    expect(liveLanguageEntry({ saved: 'unsupported', explicit: null, ask: true }).prompt).toBeTrue();
    expect(savedLiveLanguage('zh-Hans')).toBeNull(); // Stored preferences use API language IDs.
  });

  it('honors an explicitly localized shared link while still offering an enabled first-visit chooser', () => {
    expect(liveLanguageEntry({ saved: 'de', explicit: 'fr', ask: true }).language).toBe('fr');
    expect(liveLanguageEntry({ saved: null, explicit: 'fr', ask: true }).prompt).toBeTrue();
    expect(liveLanguageEntry({ saved: null, explicit: 'original', ask: false }).translate).toBeFalse();
    const localized = harness(); localized.localeId = 'de'; localized.initializeLiveLanguage();
    expect(localized.boardTranslationTarget()).toBe('de');
  });

  function harness() {
    const c: any = Object.create(BoardsComponent.prototype);
    const board = { id: 'board-123', updatedAt: 'v1', askVisitorLanguage: false, cards: [] };
    Object.assign(c, {
      isBrowser: true, functions: {}, originalSelectedBoard: signal(board),
      boardTranslationTarget: signal('de'), boardTranslationResult: signal(null), boardTranslationVersion: signal(''),
      liveCardTranslations: signal({}), liveTranslationPartial: signal(false), liveTranslationQueue: new LiveTranslationQueue(),
      liveDesiredCardIds: new Set(['one','two']), liveTranslationSession: 'board-123:v1:de',
      stackDirectView: signal(true), liveLanguageOpen: signal(false), liveLanguageFirstVisit: signal(false), liveLanguageInitial: signal('en'),
      stackPlaying: signal(false), boardTranslationRun: 0, boardTranslationRequestKey: '',
      route: { snapshot: { queryParamMap: { get: () => null } } }, teamContextId: signal(''), localeId: 'en-US',
      boardTranslationLoading: signal(false), boardTranslationError: signal(null),
    });
    c.stopStackPlayback = jasmine.createSpy('stop playback');
    c.startStackPlayback = jasmine.createSpy('start playback');
    c.unlockStackNarrationAudio = jasmine.createSpy('unlock audio').and.resolveTo();
    c.router = { navigate: jasmine.createSpy('navigate').and.resolveTo(true) };
    c.syncLiveFrameTranslation = jasmine.createSpy('sync Live').and.resolveTo();
    return c;
  }

  function result(cardId: string, language = 'de') {
    return { data: { boardId: 'board-123', cardId, targetLanguage: language, sourceLanguage: 'en', fingerprint: 'hash',
      schemaVersion: BOARD_TRANSLATION_SCHEMA_VERSION, expectedSegmentCount: 1,
      segments: [{ key: `cardsById.${cardId}.notes`, text: 'Übersetzt' }], changed: true, cached: false } };
  }

  it('initializes the first-visit chooser before any playback', () => {
    const old = localStorage.getItem(LIVE_LANGUAGE_STORAGE_KEY);
    try {
      localStorage.removeItem(LIVE_LANGUAGE_STORAGE_KEY);
      const c = harness(); c.originalSelectedBoard.update((board: any) => ({ ...board, askVisitorLanguage: true }));
      c.initializeLiveLanguage();
      expect(c.liveLanguageOpen()).toBeTrue();
      expect(c.stopStackPlayback).toHaveBeenCalled();
      expect(c.liveLanguageFirstVisit()).toBeTrue();
      expect(c.startStackPlayback).not.toHaveBeenCalled();
    } finally { old === null ? localStorage.removeItem(LIVE_LANGUAGE_STORAGE_KEY) : localStorage.setItem(LIVE_LANGUAGE_STORAGE_KEY, old); }
  });

  it('saves a confirmed preference across boards and preserves the route card parameter', () => {
    const old = localStorage.getItem(LIVE_LANGUAGE_STORAGE_KEY);
    const oldLocale = localStorage.getItem('livingwiki.locale');
    try {
      const c = harness(); c.liveLanguageFirstVisit.set(true);
      c.selectLiveLanguage('zh');
      expect(localStorage.getItem(LIVE_LANGUAGE_STORAGE_KEY)).toBe('zh');
      expect(c.router.navigate).toHaveBeenCalledWith([], jasmine.objectContaining({ queryParams: { contentLang: 'zh' }, queryParamsHandling: 'merge' }));
      expect(c.liveLanguageOpen()).toBeFalse();
      const another = harness(); another.initializeLiveLanguage();
      expect(another.boardTranslationTarget()).toBe('zh');
      expect(another.liveLanguageOpen()).toBeFalse();
    } finally {
      old === null ? localStorage.removeItem(LIVE_LANGUAGE_STORAGE_KEY) : localStorage.setItem(LIVE_LANGUAGE_STORAGE_KEY, old);
      oldLocale === null ? localStorage.removeItem('livingwiki.locale') : localStorage.setItem('livingwiki.locale', oldLocale);
    }
  });

  it('pauses while choosing and resumes the existing language when cancelled', () => {
    const c = harness(); c.stackPlaying.set(true);
    c.openLiveLanguage();
    expect(c.stopStackPlayback).toHaveBeenCalled();
    c.dismissLiveLanguage();
    expect(c.startStackPlayback).toHaveBeenCalled();
    expect(c.boardTranslationTarget()).toBe('de');
  });

  it('waits for the scanned card route before starting translation from an already loaded board', async () => {
    const c = harness();
    c.requestedCardId = signal('one');
    c.boardRouteLoadState = signal({ complete: false });
    for (const direct of [false, true]) {
      c.stackDirectView.set(direct);
      await c.syncRequestedBoardTranslation();
      expect(c.boardTranslationRequestKey).toBe('');
      expect(c.syncLiveFrameTranslation).not.toHaveBeenCalled();
    }
    expect(c.boardTranslationError()).toBeNull();
  });

  it('keeps language choice and a stable anonymous ID usable when browser storage is blocked', () => {
    spyOn(Storage.prototype, 'getItem').and.throwError('Storage blocked');
    spyOn(Storage.prototype, 'setItem').and.throwError('Storage blocked');
    const c = harness();
    c.initializeLiveLanguage();
    expect(c.boardTranslationTarget()).toBe('en');
    c.selectLiveLanguage('fr');
    c.liveLanguageBoardId = '';
    c.initializeLiveLanguage();
    expect(c.boardTranslationTarget()).toBe('fr');
    const visitor = c.ensureTourAnonymousVisitorId();
    expect(visitor.length).toBeGreaterThan(8);
    expect(c.ensureTourAnonymousVisitorId()).toBe(visitor);
  });

  it('shares an in-flight card request and merges partial results without replacing previous cards', async () => {
    const c = harness();
    let resolve!: (value: unknown) => void;
    c.requestLiveCardTranslation = jasmine.createSpy('request').and.returnValue(new Promise((done) => resolve = done));
    const one = c.prepareLiveCard('one'); const duplicate = c.prepareLiveCard('one');
    expect(c.requestLiveCardTranslation).toHaveBeenCalledTimes(1);
    resolve(result('one')); await Promise.all([one, duplicate]);
    c.requestLiveCardTranslation.and.resolveTo(result('two'));
    await c.prepareLiveCard('two');
    expect(c.boardTranslationResult().segments.length).toBe(2);
    expect(c.liveCardTranslations()['one']).toBeDefined();
    expect(c.liveTranslationPartial()).toBeTrue();
  });

  it('ignores a late translation after language or source revision changes', async () => {
    for (const change of ['language','revision']) {
      const c = harness(); let resolve!: (value: unknown) => void;
      c.requestLiveCardTranslation = () => new Promise((done) => resolve = done);
      const pending = c.prepareLiveCard('one');
      if (change === 'language') c.boardTranslationTarget.set('fr');
      else c.originalSelectedBoard.update((board: any) => ({ ...board, updatedAt: 'v2' }));
      resolve(result('one')); await pending;
      expect(c.boardTranslationResult()).toBeNull();
      expect(Object.keys(c.liveCardTranslations()).length).toBe(0);
    }
  });

  it('rejects a response for a different card', async () => {
    const c = harness(); c.requestLiveCardTranslation = async () => result('two');
    await expectAsync(c.prepareLiveCard('one')).toBeRejected();
    expect(c.boardTranslationResult()).toBeNull();
  });
});

describe('Live translation scheduling', () => {
  it('bounds concurrency, prioritizes a newly selected card and skips obsolete queued work', async () => {
    const queue = new LiveTranslationQueue(1); const calls: string[] = [];
    let finish!: () => void;
    const first = queue.schedule('first', () => new Promise<void>((done) => { calls.push('first'); finish = done; }), () => true, true);
    const old = queue.schedule('obsolete', async () => { calls.push('obsolete'); }, () => false, true);
    const speculative = queue.schedule('next', async () => { calls.push('next'); }, () => true, false);
    const chosen = queue.schedule('chosen', async () => { calls.push('chosen'); }, () => true, true);
    expect(calls).toEqual(['first']); finish();
    await Promise.all([first, old, speculative, chosen]);
    expect(calls).toEqual(['first', 'chosen', 'next']);
  });
});
