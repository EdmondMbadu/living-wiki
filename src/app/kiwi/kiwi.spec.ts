import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '../auth.service';
import { WorkspaceNavigationService } from '../workspace-navigation/workspace-navigation';
import { KiwiComponent } from './kiwi';

class FakeRecognition {
  static latest: FakeRecognition | null = null;
  lang = '';
  interimResults = false;
  continuous = false;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null = null;
  onerror: ((event: { error?: string }) => void) | null = null;
  onend: (() => void) | null = null;
  started = false;
  constructor() { FakeRecognition.latest = this; }
  start(): void { this.started = true; }
  stop(): void { this.started = false; this.onend?.(); }
}

describe('Kiwi conversation interface', () => {
  const originalRecognition = (window as any).SpeechRecognition;

  beforeEach(async () => {
    (window as any).SpeechRecognition = FakeRecognition;
    window.__LIVING_ATLAS_CONFIG__ = { firebase: {
      apiKey: 'test-key', appId: 'test-app', projectId: 'demo-kiwi', authDomain: 'demo-kiwi.firebaseapp.com',
    } };
    await TestBed.configureTestingModule({
      imports: [KiwiComponent],
      providers: [provideZonelessChangeDetection(), provideRouter([]),
        { provide: AuthService, useValue: { uid: signal('member'), isAuthenticated: signal(true) } },
        { provide: WorkspaceNavigationService, useValue: { currentUrl: signal('/boards') } },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    (window as any).SpeechRecognition = originalRecognition;
    FakeRecognition.latest = null;
    TestBed.resetTestingModule();
  });

  it('starts in Talk mode and keeps board actions out of the mode chooser', () => {
    const fixture = TestBed.createComponent(KiwiComponent);
    spyOn<any>(fixture.componentInstance, 'loadName').and.resolveTo();
    fixture.componentInstance.toggle();
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Start talking');
    expect(text).toContain('Chat');
    expect(text).not.toContain('Create a board');
    expect(fixture.nativeElement.querySelector('#kiwi-request')).toBeNull();

    fixture.componentInstance.setMode('chat');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#kiwi-request')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Chat with Kiwi');
  });

  it('starts and ends a voice conversation from the prominent control', () => {
    const fixture = TestBed.createComponent(KiwiComponent);
    spyOn<any>(fixture.componentInstance, 'loadName').and.resolveTo();
    fixture.componentInstance.toggle();
    fixture.detectChanges();
    fixture.componentInstance.toggleVoiceSession();
    fixture.detectChanges();
    expect(FakeRecognition.latest?.started).toBeTrue();
    expect(fixture.componentInstance.voiceStatus()).toBe('Listening…');
    expect(fixture.nativeElement.textContent).toContain('End conversation');

    fixture.componentInstance.toggleVoiceSession();
    fixture.detectChanges();
    expect(fixture.componentInstance.voiceActive()).toBeFalse();
    expect(FakeRecognition.latest?.started).toBeFalse();
  });

  it('opens name and voice settings, previews voice choices, and stops an active conversation', () => {
    const fixture = TestBed.createComponent(KiwiComponent);
    spyOn<any>(fixture.componentInstance, 'loadName').and.resolveTo();
    fixture.componentInstance.toggle();
    fixture.componentInstance.toggleVoiceSession();
    fixture.componentInstance.beginRename();
    fixture.detectChanges();

    expect(fixture.componentInstance.voiceActive()).toBeFalse();
    expect(FakeRecognition.latest?.started).toBeFalse();
    expect(fixture.nativeElement.querySelector('.kiwi-settings[role="dialog"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelectorAll('input[name="kiwi-voice"]').length).toBe(4);
    expect(fixture.nativeElement.textContent).toContain('Name & voice');
    expect(fixture.nativeElement.textContent).toContain('Sunny');
    expect(fixture.nativeElement.textContent).toContain('Listen');

    fixture.componentInstance.selectVoice('elegant-guide');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('input[value="elegant-guide"]').checked).toBeTrue();
    fixture.componentInstance.closeSettings();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.kiwi-settings')).toBeNull();
  });
});
