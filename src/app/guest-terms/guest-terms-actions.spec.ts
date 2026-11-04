import { provideZonelessChangeDetection, signal } from '@angular/core';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '../auth.service';
import { ChatComponent } from '../chat/chat';
import { TalkingCardConversationComponent } from '../talking-card-conversation/talking-card-conversation';
import { GuestTermsDialogComponent } from './guest-terms-dialog';
import { GuestTermsService, GUEST_TERMS_STORAGE } from './guest-terms.service';
import { GuestTermsTestStorage, guestTermsAuthStub } from './guest-terms.testing';

describe('avatar conversation action boundaries', () => {
  it('keeps a public chat question intact and sends nothing when consent is declined', async () => {
    const requestConversation = jasmine.createSpy('requestConversation').and.resolveTo(false);
    const activeThreadId = jasmine.createSpy('activeThreadId');
    const page = {
      question: signal('What can I learn here?'), isSubmitting: () => false,
      publicNotFound: () => false, guestTerms: { requestConversation }, activeThreadId,
    } as unknown as ChatComponent;
    await ChatComponent.prototype.submitQuestion.call(page);
    expect(requestConversation).toHaveBeenCalledTimes(1);
    expect(activeThreadId).not.toHaveBeenCalled();
    expect(page.question()).toBe('What can I learn here?');
  });

  it('does not request a voice credential or microphone for a declined city-avatar call', async () => {
    const requestConversation = jasmine.createSpy('requestConversation').and.resolveTo(false);
    const currentVoiceAtlasId = jasmine.createSpy('currentVoiceAtlasId');
    const page = { realtimeVoiceActive: () => false, guestTerms: { requestConversation }, currentVoiceAtlasId } as unknown as ChatComponent;
    await ChatComponent.prototype.startRealtimeVoice.call(page);
    expect(requestConversation).toHaveBeenCalledTimes(1);
    expect(currentVoiceAtlasId).not.toHaveBeenCalled();
  });

  it('does not send a Talking Card question or create analytics before consent', async () => {
    const requestConversation = jasmine.createSpy('requestConversation').and.resolveTo(false);
    const page = {
      draft: signal('Tell me about this person'), atlas: () => ({ id: 'avatar' }),
      submitting: () => false, guestTerms: { requestConversation }, analyticsSessionId: '',
    } as unknown as TalkingCardConversationComponent;
    await TalkingCardConversationComponent.prototype.send.call(page);
    expect(requestConversation).toHaveBeenCalledTimes(1);
    expect(page.draft()).toBe('Tell me about this person');
  });

  it('does not start a Talking Card voice session after a declined request', async () => {
    const requestConversation = jasmine.createSpy('requestConversation').and.resolveTo(false);
    const set = jasmine.createSpy('voice status');
    const status = Object.assign(() => 'idle', { set });
    const page = { atlas: () => ({ id: 'avatar' }), conversationStage: () => 'conversation', voiceStatus: status, guestTerms: { requestConversation } } as unknown as TalkingCardConversationComponent;
    await TalkingCardConversationComponent.prototype.startVoice.call(page);
    expect(requestConversation).toHaveBeenCalledTimes(1);
    expect(set).not.toHaveBeenCalled();
  });
});

@Component({
  imports: [GuestTermsDialogComponent],
  template: '@if (terms.promptOpen()) { <app-guest-terms-dialog /> }',
})
class DialogHost {
  readonly terms = inject(GuestTermsService);
}

describe('avatar terms modal', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [DialogHost], providers: [
      provideZonelessChangeDetection(), provideRouter([]),
      { provide: AuthService, useValue: guestTermsAuthStub() },
      { provide: GUEST_TERMS_STORAGE, useValue: new GuestTermsTestStorage() },
    ] }).compileComponents();
  });

  it('opens a native modal only after a conversation request, then cancels on Escape', async () => {
    const fixture = TestBed.createComponent(DialogHost);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('dialog')).toBeNull();
    const waiting = fixture.componentInstance.terms.requestConversation();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    fixture.detectChanges();
    await fixture.whenStable();
    const dialog = fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;
    expect(dialog.open).toBeTrue();
    expect(dialog.querySelector('input')!.checked).toBeFalse();
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(await waiting).toBeFalse();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('dialog')).toBeNull();
    expect(fixture.componentInstance.terms.hasAccepted()).toBeFalse();
  });
});
