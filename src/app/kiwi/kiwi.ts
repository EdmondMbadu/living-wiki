import { isPlatformBrowser } from '@angular/common';
import { Component, HostListener, PLATFORM_ID, computed, effect, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { httpsCallable } from 'firebase/functions';
import { doc, getDoc } from 'firebase/firestore';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { AuthService } from '../auth.service';
import { getFirebaseFirestore, getFirebaseFunctions, getFirebaseStorage } from '../firebase.client';
import type { VoiceConversation } from '@elevenlabs/client';
import { WorkspaceNavigationService } from '../workspace-navigation/workspace-navigation';
import { KiwiBoardRefreshService } from './kiwi-board-refresh.service';
import kiwiVoices from '../../../functions/src/kiwi-voices.json';

type KiwiMessage = { id: number; role: 'user' | 'assistant'; text: string };
type KiwiCardDraft = { title: string; subtitle: string; notes: string; type: string; imageUrl?: string; imageSource?: 'search' | 'generated' };
type KiwiBoardDraft = { kind: 'create_board'; title: string; description: string; tone: string; visibility: string; cards: KiwiCardDraft[] };
type KiwiProposal = { id: string; summary: string; details?: string[]; kind: string; cards?: string[]; visibility?: string; workspace: string; draft?: KiwiBoardDraft };
type KiwiTalkResponse = { reply: string; proposal?: KiwiProposal };
type KiwiApplyResponse = { boardId: string; applied: boolean };
type KiwiStreamEvent = { type: 'started' | 'draft'; draft?: KiwiBoardDraft };
type KiwiImageResult = { imageUrl: string; thumbnailUrl: string; sourceUrl: string; sourceLabel: string; title: string };
type VoicePhase = 'idle' | 'listening' | 'thinking' | 'speaking' | 'review';

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
  private readonly storage = this.isBrowser ? getFirebaseStorage() : null;
  private conversation: VoiceConversation | null = null;
  private voiceAttempt = 0;
  private queuedVoiceRequest = '';
  private voiceUserSequence = 0;
  private proposalReadyVoiceSequence = 0;
  private nextMessageId = 1;
  private loadedForUid = '';
  private loadingNameForUid = '';
  private scopeKey = '';
  private audio: HTMLAudioElement | null = null;
  private audioUrl = '';
  private speechAbort: AbortController | null = null;
  private talkAbort: AbortController | null = null;
  private speechRequestId = 0;
  private studioDirty = new Set<string>();
  private streamSequence = 0;
  private imageRun = 0;

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
  readonly studioHasImage = computed(() => !!this.studioDraft()?.cards.some((card) => !!card.imageUrl));
  readonly studioReady = signal(false);
  readonly imageLoading = signal(false);
  readonly imageNotice = signal('');
  readonly imageChoices = signal<Record<number, KiwiImageResult[]>>({});
  readonly imageChoosing = signal<number | null>(null);
  readonly imageGenerating = signal<number | null>(null);
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
  readonly voiceAvailable = this.isBrowser && !!navigator.mediaDevices?.getUserMedia;
  readonly currentVoiceName = computed(() => this.voices.find((voice) => voice.id === this.voiceId())?.name || 'Sunny');
  readonly hidden = computed(() => /^\/(?:sign-in|sign-up|reset-password|verify-email)(?:\/|$)/.test(this.currentUrl()));
  readonly voiceStatus = computed(() => {
    switch (this.voicePhase()) {
      case 'listening': return 'Listening…';
      case 'thinking': return 'Connecting to Kiwi…';
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
      if (this.conversation) this.conversation.sendContextualUpdate(
        `The user is now in ${teamId ? 'team workspace ' + teamId : 'their personal workspace'}${
          boardId ? ', viewing board ' + boardId : ''}. Use the client tool for all board or card actions.`,
        { contextId: 'kiwi-current-workspace' });
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
    if (!message) return;
    if (this.conversation) {
      this.studioMessage.set('');
      this.conversation.sendUserMessage(message);
      return;
    }
    if (this.busy() || this.applying()) return;
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
        imageUrl: old?.title === card.title ? old.imageUrl || card.imageUrl || '' : card.imageUrl || '',
        imageSource: old?.title === card.title ? old.imageSource || card.imageSource : card.imageSource,
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
    if (choice === 'describe') return;
    void this.openBoardWizard(choice);
  }

  private async openBoardWizard(choice: string): Promise<void> {
    const create = choice === 'real-estate' ? choice : 'choose';
    this.studioOpen.set(false);
    this.open.set(false);
    this.proposal.set(null);
    this.studioDraft.set(null);
    this.imageRun++;
    this.imageLoading.set(false);
    this.conversation?.sendContextualUpdate(
      `The ${create === 'real-estate' ? 'real estate listing' : 'board'} wizard is opening. Ask the user to enter the source details there.`,
      { contextId: 'kiwi-last-action' });
    const destination = this.scope().teamId
      ? `/teams/${encodeURIComponent(this.scope().teamId)}/create-listing`
      : '/boards?create=choose';
    await this.router.navigateByUrl(destination);
  }

  private imageQuery(board: KiwiBoardDraft, card: KiwiCardDraft): string {
    return [card.title, board.title, card.subtitle].filter(Boolean).join(' ').slice(0, 180);
  }

  private async findCardImages(index: number, revealChoices: boolean): Promise<KiwiImageResult[]> {
    const board = this.studioDraft();
    const card = board?.cards[index];
    if (!board || !card || !this.functions) return [];
    const callable = httpsCallable<{ query: string; includeWeb: boolean }, { results: KiwiImageResult[] }>(this.functions, 'searchBoardCardImages');
    const queries = [
      [card.title, card.subtitle].filter(Boolean).join(' '),
      this.imageQuery(board, card),
    ].filter((query, queryIndex, all) => query.length >= 2 && all.indexOf(query) === queryIndex);
    let results: KiwiImageResult[] = [];
    for (const query of queries) {
      const { data } = await callable({ query, includeWeb: true });
      results = data.results.filter((result) => {
      try {
        const url = new URL(result.imageUrl);
        const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
        return url.protocol === 'https:' && !url.username && !url.password
          && !['localhost', '0.0.0.0', '::1', 'metadata.google.internal'].includes(host)
          && !host.endsWith('.internal') && !host.endsWith('.local')
          && !/^(?:127\.|10\.|192\.168\.|169\.254\.)/.test(host)
          && !/^172\.(?:1[6-9]|2\d|3[01])\./.test(host)
          && !/\.(?:svg|tiff?|gif)$/i.test(url.pathname);
      } catch { return false; }
      });
      if (results.length) break;
    }
    if (revealChoices) this.imageChoices.update((choices) => ({ ...choices, [index]: results }));
    return results;
  }

  private async enrichStudioImages(): Promise<void> {
    const board = this.studioDraft();
    if (!board?.cards.length) { this.studioReady.set(false); return; }
    const run = ++this.imageRun;
    this.imageLoading.set(true);
    this.imageNotice.set('Finding photos for your cards…');
    const indexes = board.cards.map((card, index) => card.imageUrl ? -1 : index).filter((index) => index >= 0);
    const usedImages = new Set(board.cards.map((card) => card.imageUrl).filter(Boolean));
    // Keep the image search load bounded while photos arrive one card at a time.
    for (let start = 0; start < indexes.length; start += 3) {
      await Promise.all(indexes.slice(start, start + 3).map(async (index) => {
        try {
          const results = await this.findCardImages(index, false);
          if (run !== this.imageRun || !results.length) return;
          const chosen = results.find((result) => !usedImages.has(result.imageUrl)) || results[0];
          usedImages.add(chosen.imageUrl);
          const current = this.studioDraft();
          if (current?.cards[index]?.title === board.cards[index]?.title && !current.cards[index].imageUrl) this.studioDraft.set({ ...current,
            cards: current.cards.map((card, cardIndex) => cardIndex === index
              ? { ...card, imageUrl: chosen.imageUrl, imageSource: 'search' } : card) });
        } catch { /* The user can search for a different photo on this card. */ }
      }));
      if (run !== this.imageRun) return;
    }
    const missingIndexes = this.studioDraft()?.cards.map((card, index) => card.imageUrl ? -1 : index)
      .filter((index) => index >= 0).slice(0, 6) || [];
    if (missingIndexes.length) this.imageNotice.set('Creating original images for cards without a matching photo…');
    for (let start = 0; start < missingIndexes.length; start += 2) {
      await Promise.all(missingIndexes.slice(start, start + 2).map(async (index) => {
        try { await this.createStudioIllustration(index, run); }
        catch { /* Keep the draft and let the user retry an illustration. */ }
      }));
      if (run !== this.imageRun) return;
      this.imageNotice.set(`Images added to ${this.studioDraft()?.cards.filter((card) => card.imageUrl).length || 0} of ${board.cards.length} cards…`);
    }
    if (run !== this.imageRun) return;
    const missing = this.studioDraft()?.cards.filter((card) => !card.imageUrl).length || 0;
    this.imageNotice.set(missing ? `${missing} card${missing === 1 ? '' : 's'} still need an image. Find a photo or generate an illustration.` : 'Images added. Review your board before creating it.');
    this.imageLoading.set(false);
    this.studioReady.set(true);
    if (this.conversation) this.conversation.sendContextualUpdate(
      missing ? `${missing} card photos still need attention. Ask the user to review the board draft.`
        : 'Card photos are added to the board draft. Ask the user to review and approve it before saving.',
      { contextId: 'kiwi-image-progress' });
  }

  private async createStudioIllustration(index: number, run: number): Promise<boolean> {
    const current = this.studioDraft();
    const card = current?.cards[index];
    if (!current || !card || card.imageUrl || !this.functions) return false;
    const callable = httpsCallable<Record<string, string>, { imageDataUrl: string }>(
      this.functions, 'generateBoardCardImage', { timeout: 130_000 });
    const { data } = await callable({ cardTitle: card.title, cardSubtitle: card.subtitle,
      cardNotes: card.notes, boardTitle: current.title, boardDescription: current.description });
    if (run !== this.imageRun || !/^data:image\/(?:png|jpeg|webp);base64,/i.test(data.imageDataUrl)) return false;
    const latest = this.studioDraft();
    if (latest?.cards[index]?.title !== card.title || latest.cards[index].imageUrl) return false;
    this.studioDraft.set({ ...latest, cards: latest.cards.map((item, cardIndex) => cardIndex === index
      ? { ...item, imageUrl: data.imageDataUrl, imageSource: 'generated' } : item) });
    return true;
  }

  async generateStudioCardImage(index: number): Promise<void> {
    if (this.imageGenerating() !== null) return;
    this.imageGenerating.set(index);
    this.imageNotice.set('Creating an original illustration…');
    try {
      const created = await this.createStudioIllustration(index, this.imageRun);
      this.imageNotice.set(created ? 'Illustration added. Review it before creating the board.'
        : 'The illustration was not added. Try again.');
    } catch { this.imageNotice.set('Image generation is unavailable right now. Try again later.'); }
    finally { this.imageGenerating.set(null); }
  }

  async searchStudioCardImage(index: number): Promise<void> {
    this.imageChoosing.set(index);
    this.imageNotice.set('Finding photo choices…');
    try {
      const results = await this.findCardImages(index, true);
      this.imageNotice.set(results.length ? 'Choose a photo below.' : 'No matching photos found. Generate an illustration or try a more specific title.');
    } catch { this.imageNotice.set('Photo search is unavailable right now. Try again shortly.'); }
    finally { this.imageChoosing.set(null); }
  }

  chooseStudioCardImage(index: number, imageUrl: string): void {
    const board = this.studioDraft();
    if (!board || !this.imageChoices()[index]?.some((result) => result.imageUrl === imageUrl)) return;
    this.studioDraft.set({ ...board, cards: board.cards.map((card, cardIndex) => cardIndex === index
      ? { ...card, imageUrl, imageSource: 'search' } : card) });
    this.imageChoices.update((choices) => ({ ...choices, [index]: [] }));
    this.imageNotice.set('Photo selected.');
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

  async send(prefill?: string, fromVoiceTool = false): Promise<void> {
    const text = (prefill || this.draft()).trim();
    if (!text || !this.signedIn() || !this.functions) return;
    if (this.busy() || this.applying() || this.boardAwaitingOpen()) {
      if (fromVoiceTool) this.queuedVoiceRequest = text;
      return;
    }
    const creating = /\b(create|make|build|design|draft)\b/i.test(text)
      && /\b(board|menu|list|wiki|listing|tour)\b/i.test(text);
    if (creating && /\b(real estate|property listing|home listing|rental property|sell my (?:home|house)|listing board)\b/i.test(text)) {
      if (!fromVoiceTool) this.messages.update((items) => [...items, { id: this.nextMessageId++, role: 'user', text }]);
      this.draft.set('');
      await this.openBoardWizard('real-estate');
      return;
    }
    if (creating && /\bwalking tour\b/i.test(text)) {
      if (this.scope().teamId) {
        const reply = 'Walking tours are currently created in personal boards. Team workspaces can create property listings here.';
        if (!fromVoiceTool) this.messages.update((items) => [...items, { id: this.nextMessageId++, role: 'user', text }]);
        this.draft.set('');
        this.messages.update((items) => [...items, { id: this.nextMessageId++, role: 'assistant', text: reply }]);
        this.conversation?.sendContextualUpdate(reply, { contextId: 'kiwi-last-action' });
        return;
      }
      if (!fromVoiceTool) this.messages.update((items) => [...items, { id: this.nextMessageId++, role: 'user', text }]);
      this.draft.set('');
      await this.openBoardWizard('choose');
      return;
    }
    const controller = new AbortController();
    this.talkAbort = controller;
    const currentDraft = this.proposal()?.kind === 'create_board' ? this.studioDraft() : null;
    const modelDraft = currentDraft ? { ...currentDraft, cards: currentDraft.cards.map((card) =>
      ({ ...card, imageUrl: '', imageSource: undefined })) } : null;
    if (currentDraft) { this.imageRun++; this.imageLoading.set(false); }
    const canStartCreation = creating && (!!this.scope().teamId || /\b(public|unlisted|private)\b/i.test(text));
    const sequence = ++this.streamSequence;
    const history = this.messages().slice(-8).map(({ role, text: content }) => ({ role, text: content }));
    if (!fromVoiceTool) this.messages.update((items) => [...items, { id: this.nextMessageId++, role: 'user', text }]);
    this.draft.set('');
    if (!currentDraft) {
      this.proposal.set(null);
      this.planningCreation.set(false);
    }
    this.planningCreation.set(canStartCreation || !!currentDraft);
    if (canStartCreation && !currentDraft) {
      this.imageRun++;
      this.imageNotice.set('');
      this.imageChoices.set({});
      this.boardAwaitingOpen.set('');
      this.studioDirty.clear();
      this.studioDraft.set({ kind: 'create_board', title: 'New board', description: '', tone: 'teal',
        visibility: this.scope().teamId || /\bprivate\b/i.test(text) ? 'private'
          : /\bunlisted\b/i.test(text) ? 'unlisted' : 'public', cards: [] });
      this.studioReady.set(false);
      this.studioOpen.set(true);
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const callable = httpsCallable<{
        message: string; history: Array<{ role: string; text: string }>;
        teamId: string; boardId: string; currentDraft?: KiwiBoardDraft;
      }, KiwiTalkResponse, KiwiStreamEvent>(this.functions, 'kiwiTalk');
      const { stream, data: finalData } = await callable.stream({ message: text, history,
        teamId: this.scope().teamId, boardId: this.scope().boardId,
        ...(modelDraft ? { currentDraft: modelDraft } : {}) }, { signal: controller.signal });
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
      if (data.proposal) {
        this.proposal.set(data.proposal);
        if (fromVoiceTool) this.proposalReadyVoiceSequence = this.voiceUserSequence;
      }
      else if (!currentDraft) this.proposal.set(null);
      if (data.proposal?.kind === 'create_board' && data.proposal.draft) {
        this.mergeStudioDraft(data.proposal.draft);
        this.studioOpen.set(true);
        void this.enrichStudioImages();
      } else if (creating && !currentDraft) {
        this.studioReady.set(false);
        this.studioOpen.set(false);
        this.studioDraft.set(null);
      }
      if (fromVoiceTool && this.conversation) this.conversation.sendContextualUpdate(
        data.proposal
          ? `The requested change is ready for review on screen: ${data.reply} The user must approve before saving.`
          : `The action could not produce a proposal: ${data.reply}`,
        { contextId: 'kiwi-last-action' });
    } catch (error) {
      if (sequence !== this.streamSequence || controller.signal.aborted) return;
      this.error.set(this.errorText(error, 'Kiwi could not answer. Please try again.'));
      if (fromVoiceTool && this.conversation) this.conversation.sendContextualUpdate(
        'The requested change failed. Tell the user and offer to retry.', { contextId: 'kiwi-last-action' });
    } finally {
      if (this.talkAbort === controller) this.talkAbort = null;
      this.busy.set(false);
      this.planningCreation.set(false);
      const queued = this.queuedVoiceRequest;
      this.queuedVoiceRequest = '';
      if (queued) queueMicrotask(() => void this.send(queued, true));
    }
  }

  async apply(): Promise<void> {
    const proposal = this.proposal();
    if (!proposal || this.applying() || !this.functions) return;
    if (proposal.kind === 'create_board' && this.imageLoading()) {
      this.error.set('Kiwi is still adding photos. Wait until the board draft is ready.');
      return;
    }
    this.voiceTranscript.set('');
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
      let draft = creatingBoard ? this.studioDraft() : null;
      if (creatingBoard && (!draft || !draft.title.trim() || !draft.cards.length || draft.cards.some((card) => !card.title.trim()))) {
        this.error.set('Give the board and at least one card a title before creating it.');
        return;
      }
      if (creatingBoard && !draft?.cards.some((card) => !!card.imageUrl)) {
        this.error.set('Add at least one image before creating this board.');
        return;
      }
      let boardId = this.boardAwaitingOpen();
      if (!boardId) {
        if (draft) {
          draft = await this.persistStudioImages(draft, proposal.id);
          this.studioDraft.set(draft);
        }
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
      if (this.conversation) this.conversation.sendContextualUpdate(
        confirmation, { contextId: 'kiwi-last-action' });
    } catch (error) {
      this.error.set(this.errorText(error, 'The change could not be saved. Ask Kiwi to review it again.'));
    } finally {
      this.applying.set(false);
    }
  }

  private async persistStudioImages(draft: KiwiBoardDraft, proposalId: string): Promise<KiwiBoardDraft> {
    const uid = this.auth.uid();
    if (!uid || !this.storage) throw new Error('Sign in again before saving board images.');
    const cards = await Promise.all(draft.cards.map(async (card, index) => {
      const dataUrl = card.imageUrl || '';
      if (!dataUrl.startsWith('data:')) return card;
      const type = dataUrl.match(/^data:image\/(png|jpeg|webp);base64,/i)?.[1]?.toLowerCase();
      if (!type) throw new Error('One generated image was invalid. Try generating it again.');
      const blob = await (await fetch(dataUrl)).blob();
      if (!blob.size || blob.size > 10 * 1024 * 1024)
        throw new Error('One generated image was too large to save. Choose another image.');
      const extension = type === 'jpeg' ? 'jpg' : type;
      const reference = storageRef(this.storage!, `users/${uid}/boards/kiwi-drafts/${proposalId}/${index}.${extension}`);
      await uploadBytes(reference, blob, { contentType: blob.type, cacheControl: 'public,max-age=31536000,immutable' });
      return { ...card, imageUrl: await getDownloadURL(reference), imageSource: 'generated' as const };
    }));
    return { ...draft, cards };
  }

  dismissProposal(): void {
    this.imageRun++;
    this.imageLoading.set(false);
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
    if (!this.signedIn() || !this.voiceAvailable) return;
    this.error.set('');
    this.voiceActive.set(true);
    this.voicePhase.set('thinking');
    void this.startVoiceSession(++this.voiceAttempt);
  }

  private async startVoiceSession(attempt: number): Promise<void> {
    if (!this.functions) return;
    try {
      const [session, client] = await Promise.all([
        httpsCallable<{ voiceId: string }, { signedUrl: string; providerVoiceId: string }>(
          this.functions, 'kiwiVoiceSession')({ voiceId: this.voiceId() }),
        import('@elevenlabs/client'),
      ]);
      if (attempt !== this.voiceAttempt || !this.voiceActive()) return;
      const conversation = await client.Conversation.startSession({
        signedUrl: session.data.signedUrl,
        connectionType: 'websocket',
        textOnly: false,
        overrides: { tts: { voiceId: session.data.providerVoiceId } },
        dynamicVariables: { assistant_name: this.name() },
        clientTools: {
          kiwi_request: (parameters: { request?: string }) => {
            const request = String(parameters?.request || '').trim().slice(0, 4000);
            if (!request) return 'Please ask what the user wants to change.';
            if (/^(?:please\s+)?(?:create|make|build)(?:\s+me)?\s+(?:a\s+|an\s+)?(?:new\s+)?(?:(?:public|private|unlisted)\s+)?board(?:\s+please)?[.!?]?$/i.test(request))
              return 'Ask what the board should contain. Describe it is the default; Real Estate listing and More board types are other choices.';
            const creating = /\b(create|make|build|design|draft)\b/i.test(request)
              && /\b(board|menu|list|wiki|listing|tour)\b/i.test(request);
            const specialized = /\b(real estate|property listing|home listing|rental property|sell my (?:home|house)|listing board|walking tour)\b/i.test(request);
            if (creating && !specialized && !this.scope().teamId && !/\b(public|unlisted|private)\b/i.test(request))
              return 'Ask the user whether this new board should be Public, Unlisted, or Private before starting the draft.';
            void this.send(request, true);
            return 'The request is being prepared on screen. The user will review it before it is saved.';
          },
          kiwi_apply: () => {
            if (this.busy()) return 'The proposal is still being prepared. Ask the user to approve after it appears.';
            if (this.imageLoading()) return 'The board photos are still arriving. Ask the user to review and approve after they appear.';
            if (this.proposal()?.kind === 'create_board' && !this.studioHasImage())
              return 'The board needs at least one image. Ask the user to choose a photo or wait for an illustration.';
            if (!this.proposal()) return 'There is no ready proposal to save. Ask the user what to make or change.';
            if (this.voiceUserSequence <= this.proposalReadyVoiceSequence
              || !/\b(yes|yeah|yep|go ahead|do it|create|save|apply|send|publish)\b/i.test(this.voiceTranscript()))
              return 'The user has not explicitly approved this ready proposal. Ask them to review it and say to save it.';
            void this.apply();
            return 'Saving the approved change now.';
          },
        },
        onConnect: () => {
          if (attempt !== this.voiceAttempt) return;
          this.voicePhase.set('listening');
          this.listening.set(true);
        },
        onDisconnect: () => {
          if (attempt !== this.voiceAttempt) return;
          this.conversation = null;
          this.voiceActive.set(false);
          this.voicePhase.set('idle');
          this.listening.set(false);
          this.speaking.set(false);
        },
        onModeChange: ({ mode }) => {
          if (attempt !== this.voiceAttempt) return;
          const speaking = mode === 'speaking';
          this.speaking.set(speaking);
          this.listening.set(!speaking);
          this.voicePhase.set(speaking ? 'speaking' : 'listening');
        },
        onMessage: ({ role, message }) => {
          if (attempt !== this.voiceAttempt) return;
          const text = String(message || '').trim();
          if (!text) return;
          this.messages.update((items) => [...items, {
            id: this.nextMessageId++, role: role === 'agent' ? 'assistant' : 'user', text,
          }]);
          if (role === 'user') {
            this.voiceUserSequence++;
            this.voiceTranscript.set(text);
          }
        },
        onError: (message) => {
          if (attempt !== this.voiceAttempt) return;
          this.error.set(String(message || 'Kiwi voice was interrupted. Please try again.'));
        },
      });
      if (attempt !== this.voiceAttempt || !this.voiceActive()) {
        await conversation.endSession();
        return;
      }
      this.conversation = conversation;
      const { teamId, boardId } = this.scope();
      conversation.sendContextualUpdate(`The user is in ${teamId ? 'team workspace ' + teamId : 'their personal workspace'}${boardId ? ', viewing board ' + boardId : ''}. The user calls you ${this.name()}. Use kiwi_request for board/card operations and kiwi_apply only after explicit approval.`,
        { contextId: 'kiwi-current-workspace' });
    } catch (error) {
      if (attempt !== this.voiceAttempt) return;
      this.stopVoiceSession();
      this.error.set(this.errorText(error, 'Kiwi voice could not start. Check microphone access and try again.'));
    }
  }

  stopVoiceSession(): void {
    this.voiceAttempt++;
    const conversation = this.conversation;
    this.conversation = null;
    this.voiceActive.set(false);
    this.voicePhase.set('idle');
    this.voiceTranscript.set('');
    this.listening.set(false);
    this.speaking.set(false);
    this.queuedVoiceRequest = '';
    if (conversation) void conversation.endSession().catch(() => {});
    this.stopSpeaking();
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
