import { isPlatformBrowser } from '@angular/common';
import { Component, HostListener, PLATFORM_ID, computed, effect, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { httpsCallable } from 'firebase/functions';
import { doc, getDoc } from 'firebase/firestore';
import { AuthService } from '../auth.service';
import { getFirebaseFirestore, getFirebaseFunctions } from '../firebase.client';
import { WorkspaceNavigationService } from '../workspace-navigation/workspace-navigation';
import { KiwiBoardRefreshService } from './kiwi-board-refresh.service';
import kiwiVoices from '../../../functions/src/kiwi-voices.json';

type KiwiMessage = { id: number; role: 'user' | 'assistant'; text: string };
type KiwiCardDraft = { title: string; subtitle: string; notes: string; type: string };
type KiwiBoardDraft = { kind: 'create_board'; title: string; description: string; tone: string; visibility: string; cards: KiwiCardDraft[] };
type KiwiProposal = { id: string; summary: string; details?: string[]; kind: string; cards?: string[]; visibility?: string; workspace: string; draft?: KiwiBoardDraft };
type KiwiTalkResponse = { reply: string; proposal?: KiwiProposal };
type KiwiApplyResponse = { boardId: string; applied: boolean };
type KiwiStreamEvent = { type: 'started' | 'draft'; draft?: KiwiBoardDraft };
type VoiceResult = { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }> };
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
  private readonly boardRefresh = inject(KiwiBoardRefreshService);
  private readonly router = inject(Router);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly functions = this.isBrowser ? getFirebaseFunctions() : null;
  private readonly firestore = this.isBrowser ? getFirebaseFirestore() : null;
  private recognition: BrowserRecognition | null = null;
  private nextMessageId = 1;
  private loadedForUid = '';
  private loadingNameForUid = '';
  private scopeKey = '';
  private recognitionRestartTimer: ReturnType<typeof setTimeout> | null = null;
  private voiceTurnTimer: ReturnType<typeof setTimeout> | null = null;
  private voiceCommittedTranscript = '';
  private recognitionTranscript = '';
  private audio: HTMLAudioElement | null = null;
  private audioUrl = '';
  private speechAbort: AbortController | null = null;
  private talkAbort: AbortController | null = null;
  private speechRequestId = 0;
  private studioDirty = new Set<string>();
  private streamSequence = 0;

  readonly open = signal(false);
  readonly name = signal('Kiwi');
  readonly nameDraft = signal('Kiwi');
  readonly voices = kiwiVoices;
  readonly voiceId = signal(kiwiVoices[0].id);
  readonly voiceDraft = signal(kiwiVoices[0].id);
  readonly settingsOpen = signal(false);
  readonly settingsError = signal('');
  readonly savingSettings = signal(false);
  readonly previewingVoice = signal('');
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
  readonly voiceTranscript = signal('');
  readonly planningCreation = signal(false);
  readonly boardAwaitingOpen = signal('');
  readonly studioOpen = signal(false);
  readonly studioDraft = signal<KiwiBoardDraft | null>(null);
  readonly studioReady = signal(false);
  readonly studioMessage = signal('');
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
  readonly currentVoiceName = computed(() => this.voices.find((voice) => voice.id === this.voiceId())?.name || 'Sunny');
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
        this.voiceId.set(kiwiVoices[0].id);
        this.voiceDraft.set(kiwiVoices[0].id);
        this.settingsOpen.set(false);
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
      // The voice connection lives at the app shell. Route changes update the
      // action scope but must not end the conversation or discard its draft.
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
  onEscape(): void { if (this.settingsOpen()) this.closeSettings(); else if (this.studioOpen()) this.studioOpen.set(false); else if (this.open()) this.close(); }

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
    this.talkAbort?.abort();
    this.streamSequence++;
    this.stopVoiceSession();
    this.planningCreation.set(false);
    this.studioOpen.set(false);
    this.open.set(false);
    this.closeSettings();
    if (this.isBrowser) window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('.kiwi-launcher')?.focus();
    });
  }

  setDraft(event: Event): void { this.draft.set((event.target as HTMLTextAreaElement).value); }
  setStudioMessage(event: Event): void { this.studioMessage.set((event.target as HTMLInputElement).value); }
  onStudioMessageKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') { event.preventDefault(); void this.sendStudioMessage(); }
  }
  async sendStudioMessage(): Promise<void> {
    const message = this.studioMessage().trim();
    if (!message || this.busy() || this.applying()) return;
    this.studioMessage.set('');
    await this.send(message);
  }
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
      const callable = httpsCallable<Record<string, never>, { name: string; voiceId?: string }>(this.functions, 'kiwiPreferences');
      const { data } = await callable({});
      if (this.auth.uid() === uid) {
        this.name.set(data.name || 'Kiwi');
        this.nameDraft.set(data.name || 'Kiwi');
        const selectedVoice = this.voices.find((voice) => voice.id === data.voiceId)?.id || this.voices[0].id;
        this.voiceId.set(selectedVoice);
        this.voiceDraft.set(selectedVoice);
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
    this.voiceDraft.set(this.voiceId());
    this.settingsError.set('');
    this.stopVoiceSession();
    this.settingsOpen.set(true);
    if (this.isBrowser) window.requestAnimationFrame(() => document.querySelector<HTMLInputElement>('#kiwi-name')?.focus());
  }

  closeSettings(): void {
    this.stopSpeaking();
    this.settingsOpen.set(false);
    this.settingsError.set('');
  }

  selectVoice(voiceId: string): void { this.voiceDraft.set(voiceId); }

  async saveSettings(): Promise<void> {
    const next = this.nameDraft().trim().slice(0, 32);
    if (next.length < 2 || !this.functions) {
      this.settingsError.set('Choose a name with at least two characters.');
      return;
    }
    this.savingSettings.set(true);
    this.settingsError.set('');
    try {
      const callable = httpsCallable<{ operation: string; name: string; voiceId: string },
        { name: string; voiceId: string }>(this.functions, 'kiwiPreferences');
      const { data } = await callable({ operation: 'setPreferences', name: next, voiceId: this.voiceDraft() });
      this.name.set(data.name);
      this.voiceId.set(data.voiceId);
      this.closeSettings();
    } catch (error) {
      this.settingsError.set(this.errorText(error, 'Could not save your settings.'));
    } finally { this.savingSettings.set(false); }
  }

  async previewVoice(voiceId: string): Promise<void> {
    if (!this.functions || !this.settingsOpen()) return;
    if (this.previewingVoice() === voiceId) { this.stopSpeaking(); return; }
    this.stopSpeaking();
    this.settingsError.set('');
    this.previewingVoice.set(voiceId);
    const requestId = this.speechRequestId;
    try {
      const callable = httpsCallable<{ voiceId: string; preview: boolean }, { audio: string }>(this.functions, 'kiwiSpeak');
      const { data } = await callable({ voiceId, preview: true });
      if (requestId !== this.speechRequestId || !this.settingsOpen()) return;
      await this.playAudio(data.audio, requestId, () => {
        this.releaseAudio();
        this.previewingVoice.set('');
      }, () => {
        this.releaseAudio();
        this.previewingVoice.set('');
        this.settingsError.set('This voice could not play. Try another.');
      });
    } catch (error) {
      if (requestId === this.speechRequestId) {
        this.previewingVoice.set('');
        this.settingsError.set(this.errorText(error, 'This voice could not play. Try another.'));
      }
    }
  }

  private mergeStudioDraft(incoming: KiwiBoardDraft): void {
    const previous = this.studioDraft();
    const preserve = (key: string, oldValue: string, newValue: string) =>
      this.studioDirty.has(key) ? oldValue : newValue;
    const cards = this.studioDirty.has('cards') && previous ? previous.cards : incoming.cards.slice(0, 12).map((card, index) => {
      const old = previous?.cards[index];
      return {
        title: preserve(`card.${index}.title`, old?.title || '', card.title),
        subtitle: preserve(`card.${index}.subtitle`, old?.subtitle || '', card.subtitle),
        notes: preserve(`card.${index}.notes`, old?.notes || '', card.notes),
        type: preserve(`card.${index}.type`, old?.type || 'note', card.type),
      };
    });
    this.studioDraft.set({ kind: 'create_board',
      title: preserve('title', previous?.title || '', incoming.title),
      description: preserve('description', previous?.description || '', incoming.description),
      tone: preserve('tone', previous?.tone || 'teal', incoming.tone),
      visibility: this.scope().teamId ? 'private'
        : preserve('visibility', previous?.visibility || 'public', incoming.visibility),
      cards });
  }

  setStudioField(field: 'title' | 'description' | 'tone' | 'visibility', event: Event): void {
    const previous = this.studioDraft();
    if (!previous) return;
    const next = (event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value;
    this.studioDirty.add(field);
    this.studioDraft.set({ ...previous, [field]: next });
  }

  chooseStudioBoardType(event: Event): void {
    const choice = (event.target as HTMLSelectElement).value;
    if (choice !== 'wizard') return;
    this.close();
    this.proposal.set(null);
    void this.router.navigateByUrl('/boards?create=choose');
  }

  setStudioCardField(index: number, field: keyof KiwiCardDraft, event: Event): void {
    const previous = this.studioDraft();
    if (!previous || !previous.cards[index]) return;
    const next = (event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value;
    this.studioDirty.add(`card.${index}.${field}`);
    this.studioDraft.set({ ...previous, cards: previous.cards.map((card, cardIndex) =>
      cardIndex === index ? { ...card, [field]: next } : card) });
  }

  addStudioCard(): void {
    const previous = this.studioDraft();
    if (!previous || previous.cards.length >= 12) return;
    this.studioDraft.set({ ...previous, cards: [...previous.cards,
      { title: 'New card', subtitle: '', notes: '', type: 'note' }] });
    this.studioDirty.add('cards');
  }

  removeStudioCard(index: number): void {
    const previous = this.studioDraft();
    if (!previous) return;
    this.studioDraft.set({ ...previous, cards: previous.cards.filter((_, cardIndex) => cardIndex !== index) });
    this.studioDirty.add('cards');
  }

  async send(prefill?: string, byVoice = false): Promise<void> {
    const text = (prefill || this.draft()).trim();
    if (!text || this.busy() || this.applying() || this.boardAwaitingOpen() || !this.signedIn() || !this.functions) return;
    const controller = new AbortController();
    this.talkAbort = controller;
    const currentDraft = this.proposal()?.kind === 'create_board' ? this.studioDraft() : null;
    const creating = /\b(create|make|build|design|draft)\b/i.test(text)
      && /\b(board|menu|list|wiki)\b/i.test(text);
    const sequence = ++this.streamSequence;
    const history = this.messages().slice(-8).map(({ role, text: content }) => ({ role, text: content }));
    this.messages.update((items) => [...items, { id: this.nextMessageId++, role: 'user', text }]);
    this.draft.set('');
    if (!currentDraft) {
      this.proposal.set(null);
      this.planningCreation.set(false);
    }
    this.planningCreation.set(creating || !!currentDraft);
    if (creating && !currentDraft) {
      this.boardAwaitingOpen.set('');
      this.studioDirty.clear();
      this.studioDraft.set({ kind: 'create_board', title: 'New board', description: '', tone: 'teal',
        visibility: this.scope().teamId ? 'private' : 'public', cards: [] });
      this.studioReady.set(false);
      this.studioOpen.set(true);
    }
    this.busy.set(true);
    if (byVoice) this.voicePhase.set('thinking');
    this.error.set('');
    if (byVoice && (creating || currentDraft)) void this.speak(currentDraft
      ? 'I’ll update the draft on your screen.' : 'I’ll start the board on your screen.');
    try {
      const callable = httpsCallable<{
        message: string; history: Array<{ role: string; text: string }>;
        teamId: string; boardId: string; currentDraft?: KiwiBoardDraft;
      }, KiwiTalkResponse, KiwiStreamEvent>(this.functions, 'kiwiTalk');
      const { stream, data: finalData } = await callable.stream({ message: text, history,
        teamId: this.scope().teamId, boardId: this.scope().boardId,
        ...(currentDraft ? { currentDraft } : {}) }, { signal: controller.signal });
      for await (const event of stream) {
        if (sequence !== this.streamSequence) break;
        if (event.type === 'draft' && event.draft) {
          this.mergeStudioDraft(event.draft);
          this.studioOpen.set(true);
        }
      }
      const data = await finalData;
      if (sequence !== this.streamSequence) return;
      this.messages.update((items) => [...items, { id: this.nextMessageId++, role: 'assistant', text: data.reply }]);
      if (data.proposal) this.proposal.set(data.proposal);
      else if (!currentDraft) this.proposal.set(null);
      if (data.proposal?.kind === 'create_board' && data.proposal.draft) {
        this.mergeStudioDraft(data.proposal.draft);
        this.studioOpen.set(true);
        this.studioReady.set(true);
      } else if (creating && !currentDraft) {
        this.studioReady.set(false);
      }
      if (byVoice && this.voiceActive()) void this.speak(data.proposal
        ? `${data.reply} Please review the draft on screen. You can keep talking or create it when you are ready.`
        : data.reply);
    } catch (error) {
      if (sequence !== this.streamSequence || controller.signal.aborted) return;
      this.error.set(this.errorText(error, 'Kiwi could not answer. Please try again.'));
      if (byVoice && this.voiceActive()) this.scheduleListening();
    } finally {
      if (this.talkAbort === controller) this.talkAbort = null;
      this.busy.set(false);
      this.planningCreation.set(false);
      if (byVoice && this.voiceActive() && !this.speaking()) this.scheduleListening();
    }
  }

  async apply(): Promise<void> {
    const proposal = this.proposal();
    if (!proposal || this.applying() || !this.functions) return;
    if (this.voiceTurnTimer) clearTimeout(this.voiceTurnTimer);
    this.voiceTurnTimer = null;
    this.voiceCommittedTranscript = '';
    this.recognitionTranscript = '';
    this.voiceTranscript.set('');
    if (this.recognition) {
      const recognition = this.recognition;
      this.recognition = null;
      recognition.stop();
      this.listening.set(false);
    }
    this.applying.set(true);
    const creatingBoard = proposal.kind === 'create_board';
    this.error.set('');
    try {
      if (proposal.kind === 'email_board') {
        const sendEmail = httpsCallable<{ proposalId: string }, { sent: boolean }>(this.functions, 'kiwiEmail');
        await sendEmail({ proposalId: proposal.id });
        this.proposal.set(null);
        this.messages.update((items) => [...items, { id: this.nextMessageId++, role: 'assistant', text: 'Email sent.' }]);
        return;
      }
      const draft = creatingBoard ? this.studioDraft() : null;
      if (creatingBoard && (!draft || !draft.title.trim() || draft.cards.some((card) => !card.title.trim()))) {
        this.error.set('Give the board and every card a title before creating it.');
        return;
      }
      let boardId = this.boardAwaitingOpen();
      if (!boardId) {
        const callable = httpsCallable<{ proposalId: string; draft?: KiwiBoardDraft }, KiwiApplyResponse>(this.functions, 'kiwiApply');
        const { data } = await callable({ proposalId: proposal.id, ...(draft ? { draft } : {}) });
        boardId = data.boardId;
        this.boardAwaitingOpen.set(boardId);
      }
      const readback = httpsCallable<{ boardId: string; teamId: string }, { boardId: string; title: string }>(this.functions, 'kiwiReadback');
      await readback({ boardId, teamId: this.scope().teamId });
      if (!this.scope().teamId && this.firestore) {
        const snapshot = await getDoc(doc(this.firestore, 'boards', boardId));
        if (!snapshot.exists() || snapshot.data()['owner_user_id'] !== this.auth.uid())
          throw new Error('The board was saved, but it is not visible to your account yet. Try opening it again.');
      }
      const path = this.scope().teamId
        ? `/teams/${encodeURIComponent(this.scope().teamId)}/listings/${encodeURIComponent(boardId)}/edit`
        : `/boards/${encodeURIComponent(boardId)}`;
      this.boardRefresh.notify(boardId);
      const opened = this.router.url.split('?')[0] === path ? true : await this.router.navigateByUrl(path);
      if (!opened) throw new Error('The board was saved, but the editor could not open. Please try opening it from your boards.');
      if (creatingBoard || proposal.kind === 'copy_board') await this.waitForBoardRendered(boardId);
      this.boardAwaitingOpen.set('');
      this.proposal.set(null);
      this.studioOpen.set(false);
      this.studioDraft.set(null);
      const confirmation = creatingBoard || proposal.kind === 'copy_board'
        ? 'Your board is created and open.' : 'Your changes are saved and the board is open.';
      this.messages.update((items) => [...items, { id: this.nextMessageId++, role: 'assistant', text: confirmation }]);
      if (this.voiceActive()) void this.speak(`${confirmation} What would you like to change or add?`);
    } catch (error) {
      this.error.set(this.errorText(error, 'The change could not be saved. Ask Kiwi to review it again.'));
    } finally {
      this.applying.set(false);
      if (this.voiceActive() && !this.speaking()) this.scheduleListening();
    }
  }

  dismissProposal(): void {
    this.proposal.set(null);
    this.boardAwaitingOpen.set('');
    this.studioOpen.set(false);
    this.studioDraft.set(null);
    this.studioDirty.clear();
    this.planningCreation.set(false);
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
    this.recognition = recognition;
    recognition.lang = document.documentElement.lang || 'en-US';
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.onresult = (event) => {
      if (!this.voiceActive() || this.recognition !== recognition) return;
      const results = Array.from(event.results);
      this.recognitionTranscript = results
        .map((result) => result[0]?.transcript?.trim() || '').filter(Boolean).join(' ');
      const transcript = [this.voiceCommittedTranscript, this.recognitionTranscript].filter(Boolean).join(' ').trim();
      if (!transcript) return;
      this.voiceTranscript.set(transcript);
      if (results[results.length - 1]?.isFinal) this.scheduleVoiceTurn(1100);
      else if (this.voiceTurnTimer) { clearTimeout(this.voiceTurnTimer); this.voiceTurnTimer = null; }
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
      if (this.recognitionTranscript) this.voiceCommittedTranscript =
        [this.voiceCommittedTranscript, this.recognitionTranscript].filter(Boolean).join(' ');
      this.recognitionTranscript = '';
      if (this.voiceCommittedTranscript && !this.voiceTurnTimer && !this.busy()) this.scheduleVoiceTurn(1100);
      if (this.voiceActive() && !this.busy() && !this.speaking()) this.scheduleListening();
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

  private scheduleVoiceTurn(delayMs: number): void {
    if (this.voiceTurnTimer) clearTimeout(this.voiceTurnTimer);
    this.voiceTurnTimer = setTimeout(() => {
      this.voiceTurnTimer = null;
      this.finishVoiceTurn();
    }, delayMs);
  }

  finishVoiceTurn(): void {
    const transcript = this.voiceTranscript().trim();
    if (!transcript || !this.voiceActive() || this.busy() || this.applying()) return;
    if (this.voiceTurnTimer) clearTimeout(this.voiceTurnTimer);
    this.voiceTurnTimer = null;
    if (this.recognitionRestartTimer) clearTimeout(this.recognitionRestartTimer);
    this.recognitionRestartTimer = null;
    const recognition = this.recognition;
    this.recognition = null;
    recognition?.stop();
    this.voiceCommittedTranscript = '';
    this.recognitionTranscript = '';
    this.voiceTranscript.set('');
    this.listening.set(false);
    this.voicePhase.set('thinking');
    if (this.proposal() && /^(?:yes[, ]+)?(?:create|save|apply)(?: it| this board| the board| this change)(?: now)?[.!]?$/i.test(transcript)) {
      void this.apply();
      return;
    }
    void this.send(transcript, true);
  }

  stopVoiceSession(): void {
    this.voiceActive.set(false);
    this.voicePhase.set('idle');
    if (this.recognitionRestartTimer) clearTimeout(this.recognitionRestartTimer);
    this.recognitionRestartTimer = null;
    if (this.voiceTurnTimer) clearTimeout(this.voiceTurnTimer);
    this.voiceTurnTimer = null;
    this.recognition?.stop();
    this.recognition = null;
    this.voiceCommittedTranscript = '';
    this.recognitionTranscript = '';
    this.voiceTranscript.set('');
    this.listening.set(false);
    this.stopSpeaking();
  }

  private async speak(text: string): Promise<void> {
    if (!this.isBrowser || !this.functions) return;
    this.stopSpeaking();
    const requestId = this.speechRequestId;
    this.speaking.set(true);
    this.voicePhase.set('speaking');
    const finished = () => {
      if (requestId !== this.speechRequestId) return;
      this.releaseAudio();
      this.speaking.set(false);
      if (!this.voiceActive()) return;
      this.scheduleListening();
    };
    try {
      if (typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported('audio/mpeg')) {
        try { await this.playStreamedSpeech(text, requestId, finished); }
        catch (streamError) {
          if (requestId !== this.speechRequestId || !this.voiceActive()) return;
          if (this.audio && this.audio.currentTime > 0) throw streamError;
          this.releaseAudio();
          await this.playCompleteSpeech(text, requestId, finished);
        }
      } else {
        await this.playCompleteSpeech(text, requestId, finished);
      }
    } catch (error) {
      if (requestId !== this.speechRequestId) return;
      this.releaseAudio();
      this.speaking.set(false);
      this.error.set(this.errorText(error, 'Kiwi could not speak. You can continue in Chat.'));
      this.scheduleListening();
    }
  }

  private async playCompleteSpeech(text: string, requestId: number, finished: () => void): Promise<void> {
    if (!this.functions) return;
    const callable = httpsCallable<{ voiceId: string; text: string }, { audio: string }>(this.functions, 'kiwiSpeak');
    const { data } = await callable({ voiceId: this.voiceId(), text });
    if (requestId !== this.speechRequestId || !this.voiceActive()) return;
    await this.playAudio(data.audio, requestId, finished, () => {
      if (requestId !== this.speechRequestId) return;
      this.releaseAudio();
      this.speaking.set(false);
      this.error.set('Kiwi’s voice could not play. You can continue talking or choose Chat.');
      this.scheduleListening();
    });
  }

  private async playStreamedSpeech(text: string, requestId: number, finished: () => void): Promise<void> {
    if (!this.functions) return;
    const controller = new AbortController();
    this.speechAbort = controller;
    const source = new MediaSource();
    const url = URL.createObjectURL(source);
    this.audioUrl = url;
    const audio = new Audio(url);
    this.audio = audio;
    audio.onended = finished;
    audio.onerror = () => {
      if (requestId !== this.speechRequestId) return;
      this.releaseAudio();
      this.speaking.set(false);
      this.error.set('Kiwi’s voice could not play. You can continue talking or choose Chat.');
      this.scheduleListening();
    };
    const bufferReady = new Promise<SourceBuffer>((resolve, reject) => {
      source.addEventListener('sourceopen', () => {
        try { resolve(source.addSourceBuffer('audio/mpeg')); } catch (error) { reject(error); }
      }, { once: true });
      source.addEventListener('sourceclose', () => reject(new Error('Voice playback closed.')), { once: true });
    });
    audio.load();
    const buffer = await bufferReady;
    if (requestId !== this.speechRequestId) return;
    const callable = httpsCallable<{ voiceId: string; text: string }, { contentType: string },
      { type: 'audio'; data: string }>(this.functions, 'kiwiSpeakStream');
    const { stream, data } = await callable.stream({ voiceId: this.voiceId(), text }, { signal: controller.signal });
    let started = false;
    for await (const chunk of stream) {
      if (requestId !== this.speechRequestId || controller.signal.aborted) return;
      if (chunk.type !== 'audio' || !chunk.data) continue;
      const bytes = Uint8Array.from(atob(chunk.data), (character) => character.charCodeAt(0));
      await new Promise<void>((resolve, reject) => {
        const done = () => { buffer.removeEventListener('error', failed); resolve(); };
        const failed = () => { buffer.removeEventListener('updateend', done); reject(new Error('Voice buffer failed.')); };
        buffer.addEventListener('updateend', done, { once: true });
        buffer.addEventListener('error', failed, { once: true });
        try { buffer.appendBuffer(bytes); } catch (error) { failed(); reject(error); }
      });
      if (!started) {
        started = true;
        void audio.play().catch((error) => {
          if (requestId !== this.speechRequestId) return;
          this.error.set(this.errorText(error, 'Kiwi’s voice could not start.'));
          this.releaseAudio();
          this.speaking.set(false);
          this.scheduleListening();
        });
      }
    }
    await data;
    if (requestId === this.speechRequestId && source.readyState === 'open' && !buffer.updating) source.endOfStream();
  }

  stopSpeaking(): void {
    this.speechRequestId++;
    this.speechAbort?.abort();
    this.speechAbort = null;
    this.releaseAudio();
    this.previewingVoice.set('');
    this.speaking.set(false);
  }

  private releaseAudio(): void {
    if (this.audio) {
      this.audio.onended = null;
      this.audio.onerror = null;
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.audio.load();
      this.audio = null;
    }
    if (this.audioUrl) URL.revokeObjectURL(this.audioUrl);
    this.audioUrl = '';
  }

  private async playAudio(encoded: string, requestId: number, finished: () => void, failed: () => void): Promise<void> {
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
    if (requestId !== this.speechRequestId) { URL.revokeObjectURL(url); return; }
    this.audioUrl = url;
    const audio = new Audio(url);
    this.audio = audio;
    audio.onended = finished;
    audio.onerror = failed;
    await audio.play();
  }

  private errorText(error: unknown, fallback: string): string {
    const message = error instanceof Error ? error.message : '';
    return message.includes(': ') ? message.slice(message.indexOf(': ') + 2) : message || fallback;
  }

  private waitForBoardRendered(boardId: string): Promise<void> {
    if (!this.isBrowser) return Promise.resolve();
    const selector = `.board-detail[data-board-id="${boardId}"]`;
    if (document.querySelector(selector)) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const observer = new MutationObserver(() => {
        if (!document.querySelector(selector)) return;
        clearTimeout(timeout);
        observer.disconnect();
        resolve();
      });
      const timeout = setTimeout(() => {
        observer.disconnect();
        reject(new Error('The board was saved, but its editor did not appear. Use Open saved board to try again.'));
      }, 12000);
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }

}
