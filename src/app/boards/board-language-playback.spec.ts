import { signal } from '@angular/core';
import { BoardsComponent } from './boards';
import { DEFAULT_STACK_NARRATOR_VOICE_ID } from './stack-voice';

describe('localized board narration', () => {
  function harness(localeId = 'es-419') {
    const component: any = Object.create(BoardsComponent.prototype);
    Object.assign(component, {
      localeId, isBrowser: true, teamContextId: signal(''),
      boardTranslationTarget: signal(null), boardTranslationResult: signal(null),
      boardTranslationVersion: signal('old'), boardTranslationError: signal('old error'),
      boardTranslationLoading: signal(true), boardTranslationRun: 0,
      boardTranslationRequestKey: 'old request', tourSpeechRequestRun: 0,
      boardTranslationReady: signal(false), selectedBoard: signal({ id: 'board' }),
      tourAudioNotice: signal(null), tourSpeechPlaying: signal(false),
      tourAudioUrls: new Map(), tourAudioPromises: new Map(), functions: null,
    });
    component.stopTourSpeech = jasmine.createSpy('stop speech').and.callFake(() => {
      component.tourSpeechRequestRun += 1;
    });
    component.stopStackPlayback = jasmine.createSpy('stop playback').and.callFake(() => {
      component.stopTourSpeech();
    });
    return component;
  }

  for (const [locale, language] of [['fr', 'fr'], ['ja', 'ja'], ['pt-BR', 'pt'], ['es-419', 'es'], ['de', 'de'], ['zh-Hans', 'zh']]) {
    it(`uses ${language} for a plain localized board, cancels old audio, and separates its cache`, async () => {
      const c = harness(locale);
      c.syncBoardTranslationLanguage(null);
      expect(c.boardTranslationTarget()).toBe(language);
      expect(c.stopStackPlayback).toHaveBeenCalledTimes(1);
      expect(c.boardTranslationLoading()).toBeFalse();
      expect(c.boardTranslationError()).toBeNull();
      const result = { boardId: 'board', sourceLanguage: 'en', targetLanguage: language };
      c.boardTranslationResult.set(result);
      c.boardTranslationReady.set(true);
      expect(c.boardSpeechLanguage()).toBe(language);
      const voice = DEFAULT_STACK_NARRATOR_VOICE_ID;
      c.tourAudioUrls.set(c.narrationAudioRequestKey('card', voice, 'Translated text', 'en'), 'english.mp3');
      expect(await c.ensureTourAudioUrl('card', 'Translated text', voice)).toBeNull();
      c.tourAudioUrls.set(c.narrationAudioRequestKey('card', voice, 'Translated text'), 'translated.mp3');
      expect(await c.ensureTourAudioUrl('card', 'Translated text', voice)).toBe('translated.mp3');
      // A view-only query change must not reset a ready translation or cancel playback again.
      c.syncBoardTranslationLanguage(language);
      expect(c.boardTranslationResult()).toBe(result);
      expect(c.stopStackPlayback).toHaveBeenCalledTimes(1);
    });
  }

  it('keeps team working copies in the authored language', () => {
    const c = harness();
    c.teamContextId.set('team');
    c.syncBoardTranslationLanguage(null);
    expect(c.boardTranslationTarget()).toBeNull();
  });

  it('honors Show original in a localized route and cancels translated playback', () => {
    const c = harness();
    c.syncBoardTranslationLanguage(null);
    c.syncBoardTranslationLanguage('original');
    expect(c.boardTranslationTarget()).toBeNull();
    expect(c.boardTranslationResult()).toBeNull();
    expect(c.stopStackPlayback).toHaveBeenCalledTimes(2);
  });

  it('does not request original tour speech while translation is pending', async () => {
    const c = harness();
    c.syncBoardTranslationLanguage(null);
    c.ensureTourAudioUrl = jasmine.createSpy('speech');
    await c.speakTourFrame({ card: { id: 'card', notes: 'Original English' }, kind: 'stop' });
    expect(c.ensureTourAudioUrl).not.toHaveBeenCalled();
  });

  it('ignores delayed tour audio after the reader switches language', async () => {
    const c = harness();
    c.syncBoardTranslationLanguage(null);
    c.boardTranslationReady.set(true);
    c.boardTranslationResult.set({ boardId: 'board', sourceLanguage: 'en', targetLanguage: 'es' });
    let resolve!: (url: string) => void;
    c.ensureTourAudioUrl = jasmine.createSpy('speech').and.returnValue(new Promise<string>(done => { resolve = done; }));
    const createAudio = spyOn(window, 'Audio');
    const pending = c.speakTourFrame({ card: { id: 'card', notes: 'Texto español' }, kind: 'stop' });
    c.syncBoardTranslationLanguage('fr');
    resolve('stale-spanish.mp3');
    await pending;
    expect(createAudio).not.toHaveBeenCalled();
  });
});
