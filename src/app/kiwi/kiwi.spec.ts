import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { AuthService } from '../auth.service';
import { WorkspaceNavigationService } from '../workspace-navigation/workspace-navigation';
import { KiwiComponent } from './kiwi';

describe('Kiwi conversation interface', () => {
  beforeEach(async () => {
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
    spyOn<any>(fixture.componentInstance, 'startVoiceSession').and.resolveTo();
    fixture.componentInstance.toggle();
    fixture.detectChanges();
    fixture.componentInstance.toggleVoiceSession();
    fixture.detectChanges();
    expect(fixture.componentInstance.voiceActive()).toBeTrue();
    expect(fixture.componentInstance.voiceStatus()).toBe('Connecting to Kiwi…');
    expect(fixture.nativeElement.textContent).toContain('End conversation');

    fixture.componentInstance.toggleVoiceSession();
    fixture.detectChanges();
    expect(fixture.componentInstance.voiceActive()).toBeFalse();
    expect(fixture.componentInstance.voiceStatus()).toBe('Talk with Kiwi');
  });

  it('opens name and voice settings, previews voice choices, and stops an active conversation', () => {
    const fixture = TestBed.createComponent(KiwiComponent);
    spyOn<any>(fixture.componentInstance, 'loadName').and.resolveTo();
    spyOn<any>(fixture.componentInstance, 'startVoiceSession').and.resolveTo();
    fixture.componentInstance.toggle();
    fixture.componentInstance.toggleVoiceSession();
    fixture.componentInstance.beginRename();
    fixture.detectChanges();

    expect(fixture.componentInstance.voiceActive()).toBeFalse();
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

  it('opens the property wizard without ending an active voice conversation', async () => {
    const fixture = TestBed.createComponent(KiwiComponent);
    spyOn<any>(fixture.componentInstance, 'loadName').and.resolveTo();
    spyOn<any>(fixture.componentInstance, 'startVoiceSession').and.resolveTo();
    const navigate = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
    const kiwi = fixture.componentInstance;
    kiwi.toggle();
    kiwi.toggleVoiceSession();
    await kiwi.send('Create a real estate listing board', true);
    expect(navigate).toHaveBeenCalledWith('/boards?create=choose');
    expect(kiwi.voiceActive()).toBeTrue();
  });

  it('renders streamed cards and preserves a title the user edits while Kiwi continues', () => {
    const fixture = TestBed.createComponent(KiwiComponent);
    spyOn<any>(fixture.componentInstance, 'loadName').and.resolveTo();
    const kiwi = fixture.componentInstance;
    kiwi.toggle();
    kiwi.studioOpen.set(true);
    (kiwi as any).mergeStudioDraft({ kind: 'create_board', title: 'Tea menu', description: '',
      tone: 'teal', visibility: 'public', cards: [{ title: 'Tea', subtitle: '', notes: '', type: 'food' }] });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.kiwi-studio-card').length).toBe(1);
    const title = fixture.nativeElement.querySelector('.kiwi-studio input[type="text"]') as HTMLInputElement;
    title.value = 'My tea menu';
    title.dispatchEvent(new Event('input'));
    (kiwi as any).mergeStudioDraft({ kind: 'create_board', title: 'AI tea menu', description: '',
      tone: 'teal', visibility: 'public', cards: [
        { title: 'Tea', subtitle: '', notes: '', type: 'food' },
        { title: 'Cake', subtitle: '', notes: '', type: 'food' },
      ] });
    fixture.detectChanges();
    expect(kiwi.studioDraft()?.title).toBe('My tea menu');
    expect(fixture.nativeElement.querySelectorAll('.kiwi-studio-card').length).toBe(2);
    expect(fixture.nativeElement.textContent).toContain('Cake');
    expect(fixture.nativeElement.querySelector('#kiwi-studio-message')).not.toBeNull();
  });

  it('shows Describe it first and previews a photo on the card before creation', () => {
    const fixture = TestBed.createComponent(KiwiComponent);
    spyOn<any>(fixture.componentInstance, 'loadName').and.resolveTo();
    const kiwi = fixture.componentInstance;
    kiwi.toggle();
    kiwi.studioOpen.set(true);
    (kiwi as any).mergeStudioDraft({ kind: 'create_board', title: 'Tea places', description: '',
      tone: 'teal', visibility: 'public', cards: [{ title: 'Tea room', subtitle: '', notes: '', type: 'place',
        imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Tea.jpg' }] });
    fixture.detectChanges();
    const type = fixture.nativeElement.querySelector('.kiwi-studio__meta select') as HTMLSelectElement;
    expect(type.options[0].textContent).toContain('Describe it');
    expect(Array.from(type.options).some((option) => option.textContent?.includes('Real estate'))).toBeTrue();
    expect(fixture.nativeElement.querySelector('.kiwi-studio-card__photo img')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.kiwi-studio-card__find').textContent).toContain('Change photo');
  });

  it('requires an image in the draft before enabling Create board', () => {
    const fixture = TestBed.createComponent(KiwiComponent);
    spyOn<any>(fixture.componentInstance, 'loadName').and.resolveTo();
    const kiwi = fixture.componentInstance;
    kiwi.toggle();
    kiwi.studioOpen.set(true);
    kiwi.studioReady.set(true);
    kiwi.proposal.set({ id: 'proposal', summary: 'Create', kind: 'create_board', workspace: 'personal' });
    (kiwi as any).mergeStudioDraft({ kind: 'create_board', title: 'Tea', description: '', tone: 'teal',
      visibility: 'public', cards: [{ title: 'Matcha', subtitle: '', notes: '', type: 'food' }] });
    fixture.detectChanges();
    expect((fixture.nativeElement.querySelector('.kiwi-studio__footer > .kiwi-primary') as HTMLButtonElement).disabled).toBeTrue();
    (kiwi as any).mergeStudioDraft({ kind: 'create_board', title: 'Tea', description: '', tone: 'teal',
      visibility: 'public', cards: [{ title: 'Matcha', subtitle: '', notes: '', type: 'food',
        imageUrl: 'data:image/png;base64,aGVsbG8=', imageSource: 'generated' }] });
    fixture.detectChanges();
    expect((fixture.nativeElement.querySelector('.kiwi-studio__footer > .kiwi-primary') as HTMLButtonElement).disabled).toBeFalse();
    expect(fixture.nativeElement.textContent).toContain('AI illustration');
  });
});
