import { isPlatformBrowser } from '@angular/common';
import { Component, HostListener, PLATFORM_ID, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { httpsCallable } from 'firebase/functions';
import { AuthService } from '../auth.service';
import { getFirebaseFunctions } from '../firebase.client';
import { WorkspaceNavigationService } from '../workspace-navigation/workspace-navigation';

type KiwiMessage = { id: number; role: 'user' | 'assistant'; text: string };
type KiwiProposal = { id: string; summary: string; details?: string[]; kind: string; cards?: string[]; visibility?: string; workspace: string };
type KiwiTalkResponse = { reply: string; proposal?: KiwiProposal };
type KiwiApplyResponse = { boardId: string; applied: boolean };
type VoiceResult = { results: ArrayLike<ArrayLike<{ transcript: string }>> };
type VoicePhase = 'idle' | 'listening' | 'thinking' | 'speaking' | 'review';
type BrowserRecognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: VoiceResult) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};
type RecognitionWindow = Window & {
  SpeechRecognition?: new () => BrowserRecognition;
  webkitSpeechRecognition?: new () => BrowserRecognition;
};

@Component({
  selector: 'app-kiwi',
  imports: [RouterLink],
  templateUrl: './kiwi.html',
  styleUrl: './kiwi.css',
})
export class KiwiComponent {
  private readonly auth = inject(AuthService);
  private readonly navigation = inject(WorkspaceNavigationService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly functions = this.isBrowser ? getFirebaseFunctions() : null;
  private recognition: BrowserRecognition | null = null;
  private nextMessageId = 1;
  private loadedForUid = '';
  private loadingNameForUid = '';
  private scopeKey = '';
  private recognitionRestartTimer: ReturnType<typeof setTimeout> | null = null;

  readonly open = signal(false);
  readonly name = signal('Kiwi');
  readonly renaming = signal(false);
  readonly nameDraft = signal('Kiwi');
  readonly draft = signal('');
  readonly messages = signal<KiwiMessage[]>([]);
  readonly proposal = signal<KiwiProposal | null>(null);
  readonly busy = signal(false);
  readonly applying = signal(false);
  readonly listening = signal(false);
  readonly error = signal('');
  readonly speaking = signal(false);
  readonly mode = signal<'voice' | 'chat'>('voice');
  readonly voiceActive = signal(false);
  readonly voicePhase = signal<VoicePhase>('idle');
  readonly signedIn = this.auth.isAuthenticated;
  readonly currentUrl = this.navigation.currentUrl;
  readonly scope = computed(() => {
    const path = this.currentUrl().split('?')[0].split('#')[0];
    const teamEdit = path.match(/^\/teams\/([A-Za-z0-9_-]+)\/listings\/([A-Za-z0-9_-]+)\/edit\/?$/);
    if (teamEdit) return { teamId: teamEdit[1], boardId: teamEdit[2], label: 'Team workspace' };
    const team = path.match(/^\/teams\/([A-Za-z0-9_-]+)(?:\/.*)?$/);
    if (team && !['new', 'invitations'].includes(team[1])) return { teamId: team[1], boardId: '', label: 'Team workspace' };
    const board = path.match(/^\/(?:boards|songs|trips)\/([A-Za-z0-9_-]+)\/?$/);
    return { teamId: '', boardId: board?.[1] || '', label: 'Personal' };
  });
  readonly signInRedirect = computed(() => ({ redirectTo: this.currentUrl() || '/boards' }));
  readonly voiceAvailable = this.isBrowser && !!((window as RecognitionWindow).SpeechRecognition || (window as RecognitionWindow).webkitSpeechRecognition);
  readonly hidden = computed(() => /^\/(?:sign-in|sign-up|reset-password|verify-email)(?:\/|$)/.test(this.currentUrl()));
  readonly voiceStatus = computed(() => {
    switch (this.voicePhase()) {
      case 'listening': return 'Listening…';
      case 'thinking': return 'Kiwi is thinking…';
      case 'speaking': return 'Kiwi is speaking…';
      case 'review': return 'Review the proposed change below';
      default: return 'Talk with Kiwi';
    }
  });

  constructor() {
    effect(() => {
      const uid = this.auth.uid();
      if (!uid) {
        this.stopVoiceSession();
        this.name.set('Kiwi');
        this.nameDraft.set('Kiwi');
        this.loadedForUid = '';
        this.messages.set([]);
        this.proposal.set(null);
      } else if (uid !== this.loadedForUid) {
        void this.loadName();
      }
    });
    effect(() => {
      const { teamId, boardId } = this.scope();
      const nextKey = `${teamId}:${boardId}`;
      if (nextKey === this.scopeKey) return;
      this.scopeKey = nextKey;
      this.stopVoiceSession();
      this.messages.set([]);
      this.proposal.set(null);
      this.error.set('');
    });
    effect(() => {
      this.messages();
      this.proposal();
      this.busy();
      if (this.isBrowser && this.open()) {
        window.requestAnimationFrame(() => {
          const log = document.querySelector<HTMLElement>('.kiwi-panel__conversation');
          if (log) log.scrollTop = log.scrollHeight;
        });
      }
    });
  }

  @HostListener('window:keydown.escape')
  onEscape(): void { if (this.open()) this.close(); }

  toggle(): void {
    if (this.open()) { this.close(); return; }
    this.open.set(true);
    this.error.set('');
    if (this.signedIn()) void this.loadName();
    if (this.isBrowser) window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(this.signedIn()
        ? this.mode() === 'voice' ? '.kiwi-voice-action' : '#kiwi-request'
        : '.kiwi-panel__guest a')?.focus();
    });
  }

  close(): void {
    this.stopVoiceSession();
    this.open.set(false);
    this.renaming.set(false);
    if (this.isBrowser) window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('.kiwi-launcher')?.focus();
    });
  }

  setDraft(event: Event): void { this.draft.set((event.target as HTMLTextAreaElement).value); }
  setMode(mode: 'voice' | 'chat'): void {
    if (mode === this.mode()) return;
    this.stopVoiceSession();
    this.mode.set(mode);
    if (mode === 'chat' && this.isBrowser) window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('#kiwi-request')?.focus();
    });
  }
  setNameDraft(event: Event): void { this.nameDraft.set((event.target as HTMLInputElement).value); }
  onComposerKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void this.send();
    }
  }

  private async loadName(): Promise<void> {
    const uid = this.auth.uid();
    if (!uid || uid === this.loadedForUid || uid === this.loadingNameForUid || !this.functions) return;
    this.loadingNameForUid = uid;
    try {
      const callable = httpsCallable<Record<string, never>, { name: string }>(this.functions, 'kiwiPreferences');
      const { data } = await callable({});
      if (this.auth.uid() === uid) {
        this.name.set(data.name || 'Kiwi');
        this.nameDraft.set(data.name || 'Kiwi');
        this.loadedForUid = uid;
      }
    } catch {
      if (this.auth.uid() === uid) {
        this.loadedForUid = uid;
        if (this.open()) this.error.set('Kiwi could not connect. Please refresh after the service is available.');
      }
    } finally { if (this.loadingNameForUid === uid) this.loadingNameForUid = ''; }
  }

  beginRename(): void {
    this.nameDraft.set(this.name());
    this.renaming.set(true);
  }

  async saveName(): Promise<void> {
    const next = this.nameDraft().trim().slice(0, 32);
    if (next.length < 2 || !this.functions) {
      this.error.set('Choose a name with at least two characters.');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const callable = httpsCallable<{ operation: string; name: string }, { name: string }>(this.functions, 'kiwiPreferences');
      const { data } = await callable({ operation: 'setName', name: next });
      this.name.set(data.name);
      this.renaming.set(false);
    } catch (error) {
      this.error.set(this.errorText(error, 'Could not save the name.'));
    } finally { this.busy.set(false); }
  }

  async send(prefill?: string, byVoice = false): Promise<void> {
    const text = (prefill || this.draft()).trim();
    if (!text || this.busy() || !this.signedIn() || !this.functions) return;
    const history = this.messages().slice(-8).map(({ role, text: content }) => ({ role, text: content }));
    this.messages.update((items) => [...items, { id: this.nextMessageId++, role: 'user', text }]);
    this.draft.set('');
    this.proposal.set(null);
    this.busy.set(true);
    if (byVoice) this.voicePhase.set('thinking');
    this.error.set('');
    try {
      const callable = httpsCallable<{
        message: string; history: Array<{ role: string; text: string }>;
        teamId: string; boardId: string;
      }, KiwiTalkResponse>(this.functions, 'kiwiTalk');
      const { data } = await callable({ message: text, history, teamId: this.scope().teamId, boardId: this.scope().boardId });
      this.messages.update((items) => [...items, { id: this.nextMessageId++, role: 'assistant', text: data.reply }]);
      this.proposal.set(data.proposal || null);
      if (byVoice && this.voiceActive()) this.speak(data.proposal
        ? `${data.reply} Please review the proposed change on screen and tap Apply when you are ready.`
        : data.reply);
    } catch (error) {
      this.error.set(this.errorText(error, 'Kiwi could not answer. Please try again.'));
      if (byVoice) this.stopVoiceSession();
    } finally {
      this.busy.set(false);
      if (byVoice && this.voiceActive() && !this.speaking() && !this.proposal()) this.scheduleListening();
    }
  }

  async apply(): Promise<void> {
    const proposal = this.proposal();
    if (!proposal || this.applying() || !this.functions) return;
    this.stopVoiceSession();
    this.applying.set(true);
    this.error.set('');
    try {
      if (proposal.kind === 'email_board') {
        const sendEmail = httpsCallable<{ proposalId: string }, { sent: boolean }>(this.functions, 'kiwiEmail');
        await sendEmail({ proposalId: proposal.id });
        this.proposal.set(null);
        this.messages.update((items) => [...items, { id: this.nextMessageId++, role: 'assistant', text: 'Email sent.' }]);
        return;
      }
      const callable = httpsCallable<{ proposalId: string }, KiwiApplyResponse>(this.functions, 'kiwiApply');
      const { data } = await callable({ proposalId: proposal.id });
      this.proposal.set(null);
      this.messages.update((items) => [...items, { id: this.nextMessageId++, role: 'assistant', text: 'Saved. Opening your board now.' }]);
      const path = this.scope().teamId
        ? `/teams/${encodeURIComponent(this.scope().teamId)}/listings/${encodeURIComponent(data.boardId)}/edit`
        : `/boards/${encodeURIComponent(data.boardId)}`;
      if (this.isBrowser) window.location.assign(path);
    } catch (error) {
      this.error.set(this.errorText(error, 'The change could not be saved. Ask Kiwi to review it again.'));
    } finally { this.applying.set(false); }
  }

  dismissProposal(): void {
    this.proposal.set(null);
    if (this.voicePhase() === 'review') this.voicePhase.set('idle');
  }

  toggleVoiceSession(): void {
    if (this.voiceActive()) { this.stopVoiceSession(); return; }
    if (!this.signedIn() || !this.voiceAvailable || this.busy() || this.applying()) return;
    this.error.set('');
    this.voiceActive.set(true);
    this.startListening();
  }

  private startListening(): void {
    if (!this.voiceActive() || !this.voiceAvailable || this.listening() || this.busy() || this.speaking()) return;
    const browser = window as RecognitionWindow;
    const Recognition = browser.SpeechRecognition || browser.webkitSpeechRecognition;
    if (!Recognition) return;
    const recognition = new Recognition();
    let heardSpeech = false;
    this.recognition = recognition;
    recognition.lang = document.documentElement.lang || 'en-US';
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      if (!this.voiceActive() || heardSpeech) return;
      const transcript = event.results[0]?.[0]?.transcript?.trim();
      if (!transcript) return;
      heardSpeech = true;
      this.listening.set(false);
      this.voicePhase.set('thinking');
      recognition.stop();
      void this.send(transcript, true);
    };
    recognition.onerror = (event) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      this.stopVoiceSession();
      this.error.set(event.error === 'not-allowed' || event.error === 'service-not-allowed'
        ? 'Microphone access was denied. Allow it in your browser, or choose Chat.'
        : 'Voice recognition stopped. Try again or choose Chat.');
    };
    recognition.onend = () => {
      if (this.recognition !== recognition) return;
      this.recognition = null;
      this.listening.set(false);
      if (this.voiceActive() && !heardSpeech && !this.busy() && !this.speaking()) this.scheduleListening();
    };
    try {
      recognition.start();
      this.listening.set(true);
      this.voicePhase.set('listening');
    } catch {
      this.stopVoiceSession();
      this.error.set('Microphone access is unavailable. Choose Chat to type your request.');
    }
  }

  private scheduleListening(): void {
    if (!this.voiceActive() || this.recognitionRestartTimer) return;
    this.recognitionRestartTimer = setTimeout(() => {
      this.recognitionRestartTimer = null;
      this.startListening();
    }, 300);
  }

  stopVoiceSession(): void {
    this.voiceActive.set(false);
    this.voicePhase.set('idle');
    if (this.recognitionRestartTimer) clearTimeout(this.recognitionRestartTimer);
    this.recognitionRestartTimer = null;
    this.recognition?.stop();
    this.recognition = null;
    this.listening.set(false);
    this.stopSpeaking();
  }

  private speak(text: string): void {
    if (!this.isBrowser || !('speechSynthesis' in window)) return;
    this.stopSpeaking();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = document.documentElement.lang || 'en-US';
    utterance.rate = 1;
    const finished = () => {
      this.speaking.set(false);
      if (!this.voiceActive()) return;
      if (this.proposal()) {
        this.voiceActive.set(false);
        this.voicePhase.set('review');
      } else this.scheduleListening();
    };
    utterance.onend = finished;
    utterance.onerror = finished;
    window.speechSynthesis.speak(utterance);
    this.speaking.set(true);
    this.voicePhase.set('speaking');
  }

  stopSpeaking(): void {
    if (this.isBrowser && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    this.speaking.set(false);
  }

  private errorText(error: unknown, fallback: string): string {
    const message = error instanceof Error ? error.message : '';
    return message.includes(': ') ? message.slice(message.indexOf(': ') + 2) : message || fallback;
  }
}
