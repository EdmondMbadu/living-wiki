import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PinTalkRecorderComponent } from './pin-talk-recorder';
import { OffGridService } from './off-grid.service';
describe('PinTalk capture', () => {
  let tracks: Array<{ stop: jasmine.Spy; enabled: boolean }>,
    stream: MediaStream,
    original: typeof MediaRecorder;
  class Recorder {
    static isTypeSupported() {
      return true;
    }
    state = 'inactive';
    mimeType = 'video/webm';
    ondataavailable: ((e: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: (() => void) | null = null;
    start() {
      this.state = 'recording';
    }
    stop() {
      this.state = 'inactive';
      this.ondataavailable?.({ data: new Blob(['sample'], { type: 'video/webm' }) });
      this.onstop?.();
    }
  }
  beforeEach(() => {
    original = window.MediaRecorder;
    Object.defineProperty(window, 'MediaRecorder', { value: Recorder, configurable: true });
    tracks = [
      { stop: jasmine.createSpy('stop video'), enabled: true },
      { stop: jasmine.createSpy('stop audio'), enabled: true },
    ];
    stream = {
      getTracks: () => tracks,
      getAudioTracks: () => [tracks[1]],
    } as unknown as MediaStream;
    spyOn(navigator.mediaDevices, 'getUserMedia').and.resolveTo(stream);
    TestBed.configureTestingModule({
      imports: [PinTalkRecorderComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: OffGridService, useValue: { upload: jasmine.createSpy('upload') } },
      ],
    });
  });
  afterEach(() =>
    Object.defineProperty(window, 'MediaRecorder', { value: original, configurable: true }),
  );
  it('records into a local review without uploading and releases both tracks', async () => {
    const fixture = TestBed.createComponent(PinTalkRecorderComponent);
    fixture.componentRef.setInput('spotId', 'gem');
    const c = fixture.componentInstance;
    await c.openCamera();
    expect(c.camera()).toBeTrue();
    c.start();
    expect(c.recording()).toBeTrue();
    c.toggleMic();
    expect(tracks[1].enabled).toBeFalse();
    c.stop();
    expect(c.reviewUrl()).toContain('blob:');
    expect(c.camera()).toBeFalse();
    expect(tracks.every((t) => t.stop.calls.count() === 1)).toBeTrue();
    expect(TestBed.inject(OffGridService).upload).not.toHaveBeenCalled();
    fixture.destroy();
  });
  it('reports permission denial without starting a recording', async () => {
    (navigator.mediaDevices.getUserMedia as jasmine.Spy).and.rejectWith(
      new DOMException('denied', 'NotAllowedError'),
    );
    const fixture = TestBed.createComponent(PinTalkRecorderComponent);
    fixture.componentRef.setInput('spotId', 'gem');
    const c = fixture.componentInstance;
    await c.openCamera();
    expect(c.error()).toContain('permission was denied');
    expect(c.recording()).toBeFalse();
    fixture.destroy();
  });
  it('stops active camera tracks when navigating away', async () => {
    const fixture = TestBed.createComponent(PinTalkRecorderComponent);
    fixture.componentRef.setInput('spotId', 'gem');
    await fixture.componentInstance.openCamera();
    fixture.destroy();
    expect(tracks.every((t) => t.stop.calls.count() === 1)).toBeTrue();
  });
});
