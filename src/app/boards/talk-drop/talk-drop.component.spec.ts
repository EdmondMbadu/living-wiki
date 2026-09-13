import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TalkDropComponent } from './talk-drop.component';
import { TalkDropUploadService } from './talk-drop-upload.service';
import { TalkDropVideo } from './talk-drop';

const clip: TalkDropVideo = { url: 'https://example.test/clip.mp4', mimeType: 'video/mp4', fileName: 'Place.mp4' };
const selected = (file: File) => ({ target: { files: [file], value: 'selected' } }) as unknown as Event;

describe('Talk Drop controls', () => {
  let upload: jasmine.Spy;
  beforeEach(() => {
    upload = jasmine.createSpy('upload');
    TestBed.configureTestingModule({ imports: [TalkDropComponent], providers: [provideZonelessChangeDetection(), { provide: TalkDropUploadService, useValue: { upload } }] });
  });

  it('loads no video until the viewer explicitly asks to play it', () => {
    const fixture = TestBed.createComponent(TalkDropComponent);
    fixture.componentRef.setInput('video', clip);
    fixture.detectChanges();
    const play = jasmine.createSpy('play');
    fixture.componentInstance.playRequested.subscribe(play);
    expect(fixture.nativeElement.querySelector('video')).toBeNull();
    fixture.nativeElement.querySelector('.talk-drop__play').click();
    expect(play).toHaveBeenCalledTimes(1);
    expect(upload).not.toHaveBeenCalled();
  });

  it('waits for upload completion before emitting a persistable video', async () => {
    let finish!: (clip: TalkDropVideo) => void;
    upload.and.returnValue({ result: new Promise<TalkDropVideo>(resolve => { finish = resolve; }), cancel: () => undefined });
    const fixture = TestBed.createComponent(TalkDropComponent);
    const component = fixture.componentInstance;
    const videoChange = jasmine.createSpy('videoChange');
    const busy = jasmine.createSpy('busy');
    component.videoChange.subscribe(videoChange);
    component.uploadingChange.subscribe(busy);
    const pending = component.selectVideo(selected(new File(['test'], 'place.mp4', { type: 'video/mp4' })));
    expect(component.progress()).toBe(0);
    expect(busy).toHaveBeenCalledWith(true);
    expect(videoChange).not.toHaveBeenCalled();
    upload.calls.mostRecent().args[1](42);
    expect(component.progress()).toBe(42);
    finish(clip);
    await pending;
    expect(videoChange).toHaveBeenCalledOnceWith(clip);
    expect(component.progress()).toBeNull();
    expect(busy.calls.mostRecent().args).toEqual([false]);
  });

  it('retains the existing clip if replacement fails and allows retry', async () => {
    upload.and.callFake(() => ({ result: Promise.reject(new Error('Network unavailable')), cancel: () => undefined }));
    const fixture = TestBed.createComponent(TalkDropComponent);
    fixture.componentRef.setInput('video', clip);
    const changed = jasmine.createSpy('changed');
    fixture.componentInstance.videoChange.subscribe(changed);
    await fixture.componentInstance.selectVideo(selected(new File(['test'], 'place.mp4', { type: 'video/mp4' })));
    expect(changed).not.toHaveBeenCalled();
    expect(fixture.componentInstance.video()).toEqual(clip);
    expect(fixture.componentInstance.error()).toBe('Network unavailable');
    expect(fixture.componentInstance.progress()).toBeNull();
  });

  it('ignores a late completion after cancellation or leaving the editor', async () => {
    let finish!: (clip: TalkDropVideo) => void;
    const cancel = jasmine.createSpy('cancel');
    upload.and.returnValue({ result: new Promise<TalkDropVideo>(resolve => { finish = resolve; }), cancel });
    const fixture = TestBed.createComponent(TalkDropComponent);
    const changed = jasmine.createSpy('changed');
    fixture.componentInstance.videoChange.subscribe(changed);
    const pending = fixture.componentInstance.selectVideo(selected(new File(['test'], 'place.mp4', { type: 'video/mp4' })));
    fixture.destroy();
    finish(clip);
    await pending;
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(changed).not.toHaveBeenCalled();
  });

  it('removes a video without changing the card photo', () => {
    const fixture = TestBed.createComponent(TalkDropComponent);
    fixture.componentRef.setInput('video', clip);
    fixture.componentRef.setInput('poster', 'place.jpg');
    const changed = jasmine.createSpy('changed');
    fixture.componentInstance.videoChange.subscribe(changed);
    fixture.componentInstance.removeVideo();
    expect(changed).toHaveBeenCalledOnceWith(null);
    expect(fixture.componentInstance.poster()).toBe('place.jpg');
  });
});
