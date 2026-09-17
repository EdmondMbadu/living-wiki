import { computed, signal } from '@angular/core';
import { BoardsComponent } from './boards';
import { buildStackStoryFrames } from './stack-story-frames';

describe('Live contact ending playback', () => {
  beforeEach(() => jasmine.clock().install());
  afterEach(() => jasmine.clock().uninstall());
  async function settle() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
  const contact = { id: 'contact', title: 'Contact Alex', tags: ['listing-contact', 'real-estate'],
    notes: 'Ask Alex about a showing.', stackNarration: 'Call Alex.',
    contactDetails: { name: 'Alex', phone: '2125550100', email: 'alex@example.com' } };

  function harness() {
    const c: any = Object.create(BoardsComponent.prototype);
    const frames = buildStackStoryFrames([{ id: 'room', title: 'Kitchen' }, contact], false, contact)
      .map((frame, index, all) => ({ ...frame, index, total: all.length }));
    Object.assign(c, {
      stackFrames: () => frames, stackFrameCount: () => frames.length,
      stackFrameIndex: signal(1), stackCurrentFrame: computed(() => frames[c.stackFrameIndex()]),
      stackPlaying: signal(true), stackDirectView: () => true, isBrowser: true,
      stackFrameDurationMs: 4200, stackActiveFrameDurationMs: signal(4200),
      stackCardPhotoIndex: signal(0), stackExpandedCardId: signal(null),
      stackPlaybackTimer: null, stackCardPhotoTimer: null, stackTourNarrationSwitchToken: 1,
      stackNarrationSession: { audio: null },
      stackTourNarrationConsent: signal(false), stackStudioOpen: () => false,
      stackNarratorVoiceId: () => 'voice', stackBoard: () => null,
      selectedBoard: () => ({ id: 'board' }),
      tourAudioNotice: signal(null), tourAudioLoadingKey: signal(null), tourSpeechPlaying: signal(false),
      ensureTourAudioUrl: jasmine.createSpy('audio').and.resolveTo('mock.wav'),
      syncStackLivePreviewAfterFrameChange: () => {}, scheduleStackCardPhotoSequence: () => {},
      prefetchNextStackNarration: jasmine.createSpy('prefetch'),
      unlockStackNarrationAudio: jasmine.createSpy('unlock').and.resolveTo(undefined),
    });
    const audio: any = { play: jasmine.createSpy('play').and.resolveTo(undefined), pause: () => {},
      currentTime: 0, duration: 1, onended: null, onerror: null, onloadedmetadata: null };
    c.stackNarrationAudio = audio;
    return { c, audio };
  }

  it('plays the original contact card script, then advances to a separate silent ending', async () => {
    const { c, audio } = harness();
    c.advanceStackFrame();
    await settle();
    expect(c.stackCurrentFrame().kind).toBe('card');
    expect(c.stackCurrentFrame().card).toBe(contact);
    expect(c.ensureTourAudioUrl.calls.mostRecent().args[1]).toBe('Call Alex.');
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(c.stackPlaying()).toBeTrue();
    audio.onended();
    jasmine.clock().tick(449);
    expect(c.stackCurrentFrame().kind).toBe('card');
    jasmine.clock().tick(1);
    expect(c.stackCurrentFrame().kind).toBe('closing');
    expect(c.stackPlaying()).toBeFalse();
    expect(c.stackPlaybackTimer).toBeNull();
    jasmine.clock().tick(60_000);
    expect(c.stackFrameIndex()).toBe(3);
    expect(c.ensureTourAudioUrl).toHaveBeenCalledTimes(1);
    expect(c.stackCurrentFrame().contactCard.contactDetails.phone).toBe('2125550100');
  });

  it('stays at the ending when audio and browser narration are unavailable', async () => {
    const { c } = harness();
    c.ensureTourAudioUrl.and.resolveTo(null);
    c.startStackBrowserNarration = () => false;
    c.advanceStackFrame();
    await settle();
    jasmine.clock().tick(60_000);
    expect(c.stackPlaying()).toBeFalse();
    expect(c.stackFrameIndex()).toBe(3);
    expect(c.stackPlaybackTimer).toBeNull();
  });

  it('keeps contact controls available when the narration is completely empty', async () => {
    const { c, audio } = harness();
    c.stackNarrationTextForTourFrame = () => '';
    c.advanceStackFrame();
    await settle();
    jasmine.clock().tick(60_000);
    expect(audio.play).not.toHaveBeenCalled();
    expect(c.stackPlaying()).toBeFalse();
    expect(c.stackCurrentFrame().contactCard.contactDetails.email).toBe('alex@example.com');
  });

  it('stops at contact when media fails after playback starts', async () => {
    const { c, audio } = harness();
    c.startStackBrowserNarration = () => false;
    c.advanceStackFrame();
    await settle();
    audio.onerror();
    jasmine.clock().tick(60_000);
    expect(c.stackPlaying()).toBeFalse();
    expect(c.stackFrameIndex()).toBe(3);
    expect(c.stackPlaybackTimer).toBeNull();
  });

  it('finishes browser speech on the original card, then stops on the silent ending', async () => {
    const { c } = harness();
    const utterances: SpeechSynthesisUtterance[] = [];
    spyOn(window.speechSynthesis, 'speak').and.callFake(value => utterances.push(value));
    c.ensureTourAudioUrl.and.resolveTo(null);
    c.advanceStackFrame();
    await settle();
    expect(utterances.length).toBe(1);
    utterances[0].onend?.(new Event('end') as SpeechSynthesisEvent);
    jasmine.clock().tick(60_000);
    expect(c.stackFrameIndex()).toBe(3);
    expect(c.stackPlaying()).toBeFalse();
  });

  it('cancels delayed ending audio after replay and starts again from the cover', async () => {
    const { c, audio } = harness();
    let resolve!: (url: string) => void;
    c.ensureTourAudioUrl.and.returnValue(new Promise<string>(done => { resolve = done; }));
    c.advanceStackFrame();
    void c.replayStack({ id: 'board' });
    await settle();
    expect(c.stackFrameIndex()).toBe(0);
    resolve('late.wav');
    await settle();
    expect(audio.play).not.toHaveBeenCalled();
    c.stopStackPlayback();
    jasmine.clock().tick(60_000);
    expect(c.stackFrameIndex()).toBe(0);
  });

  it('ignores stale completion callbacks and allows manual previous/next navigation', async () => {
    const { c, audio } = harness();
    c.advanceStackFrame();
    await settle();
    const end = audio.onended;
    c.previousStackFrame();
    await settle();
    end();
    expect(c.stackFrameIndex()).toBe(1);
    expect(c.stackPlaying()).toBeTrue();
    c.stopStackPlayback();
    c.nextStackFrame();
    await settle();
    expect(c.stackFrameIndex()).toBe(2);
    expect(c.stackPlaying()).toBeFalse();
    c.nextStackFrame();
    jasmine.clock().tick(60_000);
    expect(c.stackFrameIndex()).toBe(3);
    expect(c.stackPlaying()).toBeFalse();
  });

  it('never treats the final contact buttons as a narration script', async () => {
    const { c, audio } = harness();
    c.stackFrameIndex.set(2);
    c.advanceStackFrame();
    await settle();
    expect(c.stackCurrentFrame().contactCard).toBe(contact);
    expect(c.stackTourFrameFromStackFrame(c.stackCurrentFrame())).toBeNull();
    expect(c.stackNarrationLoading()).toBeFalse();
    c.stackPlaying.set(true);
    c.syncStackNarrationAfterFrameChange({ autoAdvance: true, forceNarration: true });
    jasmine.clock().tick(60_000);
    expect(c.ensureTourAudioUrl).not.toHaveBeenCalled();
    expect(audio.play).not.toHaveBeenCalled();
    expect(c.stackFrameIndex()).toBe(3);
    expect(c.stackPlaying()).toBeFalse();
  });

  it('does not start delayed contact audio after closing the Live view', async () => {
    const { c, audio } = harness();
    let resolve!: (url: string) => void;
    c.ensureTourAudioUrl.and.returnValue(new Promise<string>(done => { resolve = done; }));
    c.advanceStackFrame();
    c.stopStackPlayback();
    c.stackDirectView = () => false;
    resolve('late.wav');
    await settle();
    expect(audio.play).not.toHaveBeenCalled();
    expect(c.stackPlaying()).toBeFalse();
  });
});
