import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import type { AtlasItem } from '../atlas.models';
import { AtlasService } from '../atlas.service';
import { DocumentsService } from '../documents.service';
import { STACK_NARRATOR_VOICES, STACK_STUDIO_NARRATOR_VOICES } from '../boards/stack-voice';
import { TalkingCardDraftStore, type TalkingCardDraftRecord } from './talking-card-draft.store';
import { EventGuideSetup } from '../event-guide/event-guide-setup';
import { EventGuideService } from '../event-guide/event-guide.service';
import { By } from '@angular/platform-browser';
import { TalkingCardEditorComponent } from './talking-card-editor';
import { TalkingCardKnowledgeService } from './talking-card-knowledge.service';
import { PersonalVoiceService, type PersonalVoiceLibrary } from '../personal-voice.service';

describe('TalkingCardEditorComponent', () => {
  const makeAtlas = (id: string, name: string, isPublic: boolean): AtlasItem => ({
    id,
    user_id: 'owner-1',
    name,
    slug: name.toLowerCase().replace(/\s+/g, '-'),
    description: `${name} conversational guide`,
    landing_summary: null,
    is_public: isPublic,
    logo_url: null,
    hero_url: null,
    video_url: null,
    cover_color: null,
    wiki_type: 'person',
    response_perspective: 'first_person',
    persona_prompt: null,
    chat_guide: { name, label: 'Historical guide', banner_url: null, image_url: null },
  });
  const atlases = signal<AtlasItem[]>([
    makeAtlas('george', 'George Washington', true),
    makeAtlas('james', 'James Madison', false),
    makeAtlas('philadelphia', 'Philadelphia', true),
  ]);
  const publicGlover: AtlasItem = {
    ...makeAtlas('john-glover', 'Colonel John Glover', true),
    user_id: 'public-avatar-owner',
    description: 'Marblehead commander and maritime guide',
  };
  const personalLibrary: PersonalVoiceLibrary = {
    libraryVersion: 2,
    eligible: true,
    paid: false,
    admin: false,
    voiceLimit: 1,
    voiceCount: 1,
    canAddVoice: false,
    defaultVoiceId: 'voice-1',
    voice: {
      id: 'voice-1', narratorVoiceId: 'personal-voice:voice-1', name: 'Edmond', status: 'ready',
      createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
      sampleDurationSeconds: 72, voiceRevision: 1,
    },
    voices: [],
  };
  personalLibrary.voices = [personalLibrary.voice!];
  const atlasService = {
    atlases,
    canAdminAtlas: jasmine.createSpy('canAdminAtlas').and.callFake((atlas: AtlasItem) => atlas.user_id === 'owner-1'),
    isAtlasOwner: jasmine.createSpy('isAtlasOwner').and.callFake((atlas: AtlasItem) => atlas.user_id === 'owner-1'),
    getAccessibleAtlasById: jasmine.createSpy('getAccessibleAtlasById').and.callFake(async (atlasId: string) =>
      [...atlases(), publicGlover].find((atlas) => atlas.id === atlasId) ?? null),
    listPublicAtlases: jasmine.createSpy('listPublicAtlases').and.resolveTo([publicGlover]),
    getAtlasSpeechVoiceConfig: jasmine.createSpy('getAtlasSpeechVoiceConfig').and.resolveTo({
      source: 'default', provider: 'elevenlabs', catalogVoiceId: null, personalVoiceId: null, name: 'Default voice',
      description: null, previewUrl: null, designModel: null, createdAt: null, updatedAt: null,
    }),
    previewAtlasSpeechVoice: jasmine.createSpy('previewAtlasSpeechVoice').and.resolveTo({ audioUrl: 'data:audio/mpeg;base64,SUQz' }),
    selectAtlasCatalogVoice: jasmine.createSpy('selectAtlasCatalogVoice').and.resolveTo({
      source: 'catalog', provider: 'elevenlabs', catalogVoiceId: 'warm-storyteller', personalVoiceId: null, name: 'Warm Storyteller',
      description: null, previewUrl: null, designModel: null, createdAt: null, updatedAt: null,
    }),
    selectAtlasPersonalVoice: jasmine.createSpy('selectAtlasPersonalVoice').and.resolveTo({
      source: 'personal', provider: 'elevenlabs', catalogVoiceId: null, personalVoiceId: 'voice-1', name: 'Edmond',
      description: null, previewUrl: null, designModel: null, createdAt: null, updatedAt: null,
    }),
    resetAtlasSpeechVoice: jasmine.createSpy('resetAtlasSpeechVoice'),
    createTalkingCardAtlas: jasmine.createSpy('createTalkingCardAtlas').and.resolveTo('new-avatar'),
    updatePersonaSettings: jasmine.createSpy('updatePersonaSettings'),
    updatePersonaPrompt: jasmine.createSpy('updatePersonaPrompt'),
    updateAtlas: jasmine.createSpy('updateAtlas'),
    updateChatGuideConfig: jasmine.createSpy('updateChatGuideConfig'),
    uploadTalkingCardAvatarImage: jasmine.createSpy('uploadTalkingCardAvatarImage').and.resolveTo('https://example.com/avatar.png'),
  };
  const documentsService = {
    uploadError: signal<string | null>(null),
    uploadFiles: jasmine.createSpy('uploadFiles').and.resolveTo(),
    deleteDocument: jasmine.createSpy('deleteDocument').and.resolveTo(),
  };
  const talkingCardKnowledgeService = {
    listOwnedAtlasDocuments: jasmine.createSpy('listOwnedAtlasDocuments').and.resolveTo([]),
  };
  const draftStore = {
    load: jasmine.createSpy('load').and.resolveTo(null),
    save: jasmine.createSpy('save').and.resolveTo(),
    delete: jasmine.createSpy('delete').and.resolveTo(),
  };
  const personalVoiceService = {
    loadLibrary: jasmine.createSpy('loadLibrary').and.resolveTo(personalLibrary),
    createVoice: jasmine.createSpy('createVoice').and.resolveTo(personalLibrary),
    deleteVoice: jasmine.createSpy('deleteVoice').and.resolveTo({ ...personalLibrary, voices: [], voice: null }),
    renameVoice: jasmine.createSpy('renameVoice').and.resolveTo(personalLibrary),
  };
  const router = { navigate: jasmine.createSpy('navigate').and.resolveTo(true) };

  beforeEach(async () => {
    Object.values(atlasService).forEach((value) => {
      if (jasmine.isSpy(value)) value.calls.reset();
    });
    Object.values(draftStore).forEach((value) => {
      if (jasmine.isSpy(value)) value.calls.reset();
    });
    Object.values(personalVoiceService).forEach((value) => {
      if (jasmine.isSpy(value)) value.calls.reset();
    });
    Object.values(documentsService).forEach((value) => {
      if (jasmine.isSpy(value)) value.calls.reset();
    });
    talkingCardKnowledgeService.listOwnedAtlasDocuments.calls.reset();
    documentsService.uploadError.set(null);
    router.navigate.calls.reset();
    atlasService.listPublicAtlases.and.resolveTo([publicGlover]);
    draftStore.load.and.resolveTo(null);
    await TestBed.configureTestingModule({
      imports: [TalkingCardEditorComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: AtlasService, useValue: atlasService },
        { provide: DocumentsService, useValue: documentsService },
        { provide: TalkingCardKnowledgeService, useValue: talkingCardKnowledgeService },
        { provide: TalkingCardDraftStore, useValue: draftStore },
        { provide: PersonalVoiceService, useValue: personalVoiceService },
        { provide: Router, useValue: router },
      ],
    }).compileComponents();
  });

  it('shows the program first and preserves a manual session when moving to the avatar step', async () => {
    const fixture = TestBed.createComponent(TalkingCardEditorComponent);
    const page = fixture.componentInstance;
    fixture.componentRef.setInput('boardId', 'event-board');
    fixture.componentRef.setInput('prefill', { experience: 'event', personaPrompt: 'Guide attendees through the event.' });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const program = fixture.debugElement.query(By.directive(EventGuideSetup)).componentInstance as EventGuideSetup;
    const nav: HTMLElement = fixture.nativeElement.querySelector('.talking-editor__event-nav');
    const next: HTMLButtonElement = fixture.nativeElement.querySelector('.talking-editor__footer .talking-editor__primary');
    expect(nav.querySelector('[aria-current]')?.textContent).toContain('Event setup');
    expect(next.disabled).toBeFalse();
    next.click();
    fixture.detectChanges();
    expect(page.eventStep()).toBe('event');
    expect(fixture.nativeElement.querySelector('#event-editor-status')?.textContent).toContain('Enter the event name.');
    expect(fixture.nativeElement.querySelector('#event-name')?.getAttribute('aria-invalid')).toBe('true');
    expect(fixture.nativeElement.querySelector('.event-setup__validation')?.textContent).toContain('Enter the event name.');
    program.setField('name', 'Robotics Day');
    program.openSession();
    program.updateSession('title', 'Opening keynote');
    program.updateSession('date', '2027-01-05');
    program.updateSession('start', '10:00');
    program.updateSession('end', '11:00');
    program.saveManual();
    fixture.detectChanges();
    expect(next.disabled).toBeFalse();
    next.click();
    fixture.detectChanges();
    expect(page.eventStep()).toBe('avatar');
    expect(nav.querySelector('[aria-current]')?.textContent).toContain('Avatar & card');
    page.setMode('existing');
    fixture.detectChanges();
    const add: HTMLButtonElement = fixture.nativeElement.querySelector('.talking-editor__footer .talking-editor__primary');
    expect(add.disabled).toBeFalse();
    expect(fixture.nativeElement.querySelector('#event-editor-status')?.textContent).toContain('Select an avatar');
    expect(fixture.nativeElement.querySelectorAll('#talking-avatar-results [role="option"]').length).toBeGreaterThan(0);
    add.click();
    fixture.detectChanges();
    expect(document.activeElement?.id).toBe('talking-avatar-search');
    program.setField('informationUrl', 'http://example.org');
    fixture.detectChanges();
    add.click();
    fixture.detectChanges();
    expect(page.eventStep()).toBe('event');
    const link = fixture.nativeElement.querySelector('#event-information-url') as HTMLInputElement;
    expect(link.closest('details')?.open).toBeTrue();
    expect(document.activeElement).toBe(link);
    expect(fixture.nativeElement.querySelector('#event-editor-status')?.textContent).toContain('official event link starting with https://');
    program.setField('informationUrl', 'https://example.org');
    page.showEventStep('avatar');
    fixture.detectChanges();
    fixture.nativeElement.querySelector('#talking-avatar-results [role="option"]').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(page.canSave()).toBeTrue();
    const portrait: HTMLLabelElement = fixture.nativeElement.querySelector('.talking-editor__event-portrait');
    expect(portrait.textContent).toContain('Add profile photo');
    expect(portrait.querySelector('input')?.accept).toBe('image/*');
    const photo = new File(['image bytes'], 'amy.webp', { type: 'image/webp' });
    page.imageFile.set(photo);
    page.imagePreviewUrl.set('/amy-preview.webp');
    fixture.detectChanges();
    expect(portrait.querySelector('img')?.getAttribute('src')).toBe('/amy-preview.webp');
    expect(portrait.textContent).toContain('Replace profile photo');
    const voice = STACK_STUDIO_NARRATOR_VOICES.at(-1)!;
    expect(fixture.nativeElement.querySelector('.talking-editor__voice-library-label').textContent)
      .toContain(`All ${STACK_STUDIO_NARRATOR_VOICES.length} voices`);
    page.voiceSearch.set(voice.name);
    fixture.detectChanges();
    const option = Array.from<HTMLButtonElement>(fixture.nativeElement.querySelectorAll('.talking-editor__voice-select'))
      .find((button) => button.querySelector('strong')?.textContent === voice.name);
    expect(option).toBeDefined();
    option?.click();
    page.showEventStep('event');
    fixture.detectChanges();
    expect(program.sessions()[0]?.title).toBe('Opening keynote');

    const eventSave = spyOn(TestBed.inject(EventGuideService), 'save').and.resolveTo({
      ...page.eventSettingsDraft(), datasetId: 'a'.repeat(64),
    });
    const saved = spyOn(page.saved, 'emit');
    page.showEventStep('avatar');
    fixture.detectChanges();
    fixture.nativeElement.querySelector('.talking-editor__event-sponsor-link').click();
    fixture.detectChanges();
    expect(document.activeElement?.id).toBe('sponsor-settings-title');
    const sponsorPanel: HTMLElement = fixture.nativeElement.querySelector('.talking-editor__sponsorship');
    sponsorPanel.querySelectorAll<HTMLButtonElement>('.talking-editor__sponsor-options button')[1].click();
    fixture.detectChanges();
    expect(document.activeElement?.id).toBe('talking-sponsor-name');
    expect(sponsorPanel.querySelector('#talking-sponsor-name')?.getAttribute('aria-invalid')).toBe('true');
    expect(sponsorPanel.querySelector('#talking-sponsor-message')?.getAttribute('aria-invalid')).toBe('true');
    expect(sponsorPanel.querySelector('#talking-sponsor-name-error')?.textContent).toContain('Complete the sponsor');
    expect(fixture.nativeElement.querySelector('#event-editor-status').classList).toContain('is-error');
    fixture.nativeElement.querySelector('.talking-editor__footer .talking-editor__primary').click();
    fixture.detectChanges();
    expect(document.activeElement?.id).toBe('talking-sponsor-name');
    expect(eventSave).not.toHaveBeenCalled();
    sponsorPanel.querySelectorAll<HTMLButtonElement>('.talking-editor__sponsor-options button')[0].click();
    fixture.detectChanges();
    fixture.nativeElement.querySelector('.talking-editor__footer .talking-editor__primary').click();
    await fixture.whenStable();
    expect(eventSave).toHaveBeenCalledTimes(1);
    expect(atlasService.selectAtlasCatalogVoice).toHaveBeenCalledOnceWith('george', voice.id);
    expect(atlasService.uploadTalkingCardAvatarImage).toHaveBeenCalledOnceWith('george', photo);
    expect(saved).toHaveBeenCalledWith(jasmine.objectContaining({
      atlasId: 'george',
      imageUrl: 'https://example.com/avatar.png',
      event: jasmine.objectContaining({ name: 'Robotics Day', informationUrl: 'https://example.org' }),
    }));
  });

  it('shows only Off or Add a sponsor when creating an avatar, with no board settings', async () => {
    const fixture = TestBed.createComponent(TalkingCardEditorComponent), page = fixture.componentInstance;
    fixture.componentRef.setInput('boardId', 'new-avatar-board');
    fixture.componentRef.setInput('boardSponsorship', { name: 'Existing board sponsor', message: 'An existing acknowledgement.' });
    fixture.detectChanges(); await fixture.whenStable(); await new Promise(resolve => setTimeout(resolve, 0));
    const panel = fixture.nativeElement.querySelector('.talking-editor__sponsorship') as HTMLElement;
    expect(panel.textContent).toContain('Off'); expect(panel.textContent).toContain('Add a sponsor');
    expect(panel.textContent?.toLowerCase()).not.toContain('board acknowledgement');
    expect(panel.querySelector('select')).toBeNull(); expect(panel.querySelector('input')).toBeNull();
    expect(page.sponsorMode()).toBe('off'); expect(page.effectiveSponsor()).toBeNull();
    panel.querySelectorAll<HTMLButtonElement>('.talking-editor__sponsor-options button')[1].click();
    fixture.detectChanges(); await fixture.whenStable();
    const name = panel.querySelector<HTMLInputElement>('#talking-sponsor-name')!;
    name.value = 'William Penn Foundation'; name.dispatchEvent(new Event('input'));
    fixture.detectChanges(); await fixture.whenStable();
    expect(panel.querySelector<HTMLTextAreaElement>('#talking-sponsor-message')?.value).toBe('Our conversation today has been generously supported by a grant from William Penn Foundation.');
    expect(panel.querySelector('details')).toBeNull();
    expect(panel.querySelector<HTMLTextAreaElement>('#talking-sponsor-message')?.value).toContain('William Penn Foundation.');
    expect(page.sponsorValid()).toBeTrue();
    panel.querySelectorAll<HTMLButtonElement>('.talking-editor__sponsor-options button')[0].click(); fixture.detectChanges();
    expect(panel.querySelector('input')).toBeNull(); expect(page.effectiveSponsor()).toBeNull();
    expect(page.sponsorValid()).toBeTrue(); fixture.destroy();
  });

  it('saves a new avatar sponsorship as an explicit choice without changing a shared board default', async () => {
    const fixture = TestBed.createComponent(TalkingCardEditorComponent), page = fixture.componentInstance;
    fixture.componentRef.setInput('boardId', 'new-avatar-board');
    fixture.componentRef.setInput('boardSponsorship', { name: 'Board sponsor', message: 'Keep this board setting.' });
    fixture.detectChanges(); await fixture.whenStable();
    page.selectedAtlasId.set('george');
    const saved = spyOn(page.saved, 'emit');
    await page.save(); expect(saved.calls.mostRecent().args[0].sponsorship).toEqual({ mode: 'off' });
    expect(saved.calls.mostRecent().args[0].boardSponsorship).toBeUndefined();
    await page.completeSave('Retry fixture');
    page.setSponsorEnabled(true); page.updateSponsorName('William Penn Foundation');
    await page.save();
    expect(saved.calls.mostRecent().args[0].sponsorship).toEqual({ mode: 'custom', name: 'William Penn Foundation', message: 'Our conversation today has been generously supported by a grant from William Penn Foundation.' });
    expect(saved.calls.mostRecent().args[0].boardSponsorship).toBeUndefined(); fixture.destroy();
  });

  it('restores older creation drafts without enabling inherited sponsorship or changing board settings', async () => {
    draftStore.load.and.resolveTo({ key: 'board:older-draft', version: 1, boardId: 'older-draft', mode: 'existing',
      selectedAtlasId: 'george', createdAtlasId: '', name: 'George Washington', role: '', personaPrompt: '',
      openingMessage: 'Ask me about history.', ctaLabel: 'Talk to me', placement: 'end', actions: [], catalogVoiceId: '',
      voiceChoice: 'default', publishAvatar: false, imageFile: null, uploadedImageUrl: '', documentFiles: [], updatedAt: '',
      sponsorDraft: { mode: 'inherit', name: '', message: '', boardEdited: true, boardEnabled: true, boardName: 'Old draft sponsor', boardMessage: 'Do not apply this shared draft setting.' } });
    const fixture = TestBed.createComponent(TalkingCardEditorComponent), page = fixture.componentInstance;
    fixture.componentRef.setInput('boardId', 'older-draft'); fixture.detectChanges(); await fixture.whenStable();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(page.sponsorMode()).toBe('off'); expect(page.effectiveSponsor()).toBeNull();
    expect(page.sponsorChoice()).toEqual({ mode: 'off' }); fixture.destroy();
  });

  it('waits for saved settings before allowing sponsorship edits or saves', async () => {
    let finish!: (value: null) => void;
    draftStore.load.and.returnValue(new Promise(resolve => finish = resolve));
    const fixture = TestBed.createComponent(TalkingCardEditorComponent), page = fixture.componentInstance;
    fixture.componentRef.setInput('boardId', 'loading-board'); fixture.detectChanges();
    page.selectedAtlasId.set('george');
    const fields = fixture.nativeElement.querySelector('.talking-editor__sponsor-fields') as HTMLFieldSetElement;
    expect(fields.disabled).toBeTrue(); expect(page.canSave()).toBeFalse();
    finish(null); await fixture.whenStable(); fixture.detectChanges();
    expect(fields.disabled).toBeFalse(); expect(page.canSave()).toBeTrue(); fixture.destroy();
  });

  it('prefills actual editable wording without enabling sponsorship or accepting an unfinished sentence', async () => {
    const fixture = TestBed.createComponent(TalkingCardEditorComponent), page = fixture.componentInstance;
    fixture.detectChanges(); await fixture.whenStable();
    const prefix = 'Our conversation today has been generously supported by a grant from ';
    expect(page.sponsorMessage()).toBe(prefix);
    expect(page.sponsorMode()).toBe('off');
    expect(page.effectiveSponsor()).toBeNull(); expect(page.sponsorValid()).toBeTrue();
    page.sponsorMode.set('custom'); fixture.detectChanges(); await fixture.whenStable();
    const textarea = fixture.nativeElement.querySelector('.talking-editor__sponsorship textarea') as HTMLTextAreaElement;
    expect(textarea.value).toBe(prefix); expect(page.sponsorValid()).toBeFalse();
    textarea.value += 'William Penn Foundation of Philadelphia'; textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges(); await fixture.whenStable();
    expect(page.sponsorMode()).toBe('custom'); expect(page.sponsorName()).toBe('William Penn Foundation of Philadelphia');
    expect(page.sponsorMessage()).toBe(prefix + 'William Penn Foundation of Philadelphia');
    expect(page.sponsorValid()).toBeTrue(); fixture.destroy();
  });

  it('completes the default sentence from a name while preserving custom wording', async () => {
    const fixture = TestBed.createComponent(TalkingCardEditorComponent), page = fixture.componentInstance;
    fixture.detectChanges(); await fixture.whenStable(); page.sponsorMode.set('custom');
    page.updateSponsorName('William Penn Foundation');
    expect(page.sponsorMessage()).toBe('Our conversation today has been generously supported by a grant from William Penn Foundation.');
    page.updateSponsorName('Another sponsor'); expect(page.sponsorMessage()).toContain('from Another sponsor.');
    const expandedMessage = page.sponsorMessage() + ' Thank you for joining this educational conversation.';
    page.updateSponsorMessage(expandedMessage);
    expect(page.sponsorName()).toBe('Another sponsor'); expect(page.sponsorMessage()).toBe(expandedMessage);
    page.updateSponsorMessage('Thank you to our local supporters.'); page.updateSponsorName('A new name');
    expect(page.sponsorMessage()).toBe('Thank you to our local supporters.');
    expect(page.sponsorValid()).toBeTrue(); fixture.destroy();
  });




  for (const editing of [false, true]) {
    it(`shows a directly editable default message in the ${editing ? 'edit' : 'creation'} form and saves custom wording`, async () => {
      const fixture = TestBed.createComponent(TalkingCardEditorComponent), page = fixture.componentInstance;
      fixture.componentRef.setInput('boardId', 'historic-board');
      if (editing) fixture.componentRef.setInput('editingCard', { id: 'guide-card', title: 'George Washington', subtitle: '', imageUrl: '', placement: 'keep', conversation: { version: 1, provider: 'atlas', atlasId: 'george', openingMessage: 'Ask me about history.', sponsorship: { mode: 'off' } } });
      fixture.detectChanges(); await fixture.whenStable(); await new Promise(resolve => setTimeout(resolve, 0));
      page.selectedAtlasId.set('george'); if (editing) page.setEditorSection('sponsorship'); fixture.detectChanges();
      const panel = fixture.nativeElement.querySelector('.talking-editor__sponsorship') as HTMLElement;
      expect(panel.querySelector('select')).toBeNull(); expect(panel.querySelector('details')).toBeNull();
      expect(panel.textContent?.toLowerCase()).not.toContain('board acknowledgement');
      page.setSponsorEnabled(true); fixture.detectChanges(); await fixture.whenStable();
      const name = panel.querySelector<HTMLInputElement>('#talking-sponsor-name')!;
      name.value = 'William Penn'; name.dispatchEvent(new Event('input')); fixture.detectChanges(); await fixture.whenStable();
      const message = panel.querySelector<HTMLTextAreaElement>('#talking-sponsor-message')!;
      expect(message.value).toBe('Our conversation today has been generously supported by a grant from William Penn.');
      expect(message.closest('details')).toBeNull(); expect(message.disabled).toBeFalse();
      message.value = 'This educational conversation is made possible by William Penn.'; message.dispatchEvent(new Event('input'));
      fixture.detectChanges(); await fixture.whenStable();
      page.updateSponsorName('William Penn Foundation');
      expect(page.sponsorMessage()).toBe(message.value);
      const saved = spyOn(page.saved, 'emit'); await page.save();
      expect(saved.calls.mostRecent().args[0].sponsorship).toEqual({ mode: 'custom', name: 'William Penn Foundation', message: message.value });
      expect(saved.calls.mostRecent().args[0].boardSponsorship).toBeUndefined(); fixture.destroy();
    });
  }

  it('preserves an existing inherited acknowledgement as editable text without exposing shared settings', async () => {
    const fixture = TestBed.createComponent(TalkingCardEditorComponent), page = fixture.componentInstance;
    const sponsor = { name: 'William Penn Foundation', message: 'An existing approved sponsor message.' };
    fixture.componentRef.setInput('boardId', 'historic-board'); fixture.componentRef.setInput('boardSponsorship', sponsor);
    fixture.componentRef.setInput('editingCard', { id: 'guide-card', title: 'George Washington', subtitle: '', imageUrl: '', placement: 'keep', conversation: { version: 1, provider: 'atlas', atlasId: 'george', openingMessage: 'Ask me about history.' } });
    fixture.detectChanges(); await fixture.whenStable(); await new Promise(resolve => setTimeout(resolve, 0));
    page.setEditorSection('sponsorship'); fixture.detectChanges(); await fixture.whenStable();
    expect(page.sponsorMode()).toBe('custom'); expect(page.effectiveSponsor()).toEqual(sponsor);
    const panel = fixture.nativeElement.querySelector('.talking-editor__sponsorship') as HTMLElement;
    expect(panel.querySelector<HTMLTextAreaElement>('#talking-sponsor-message')?.value).toBe(sponsor.message);
    expect(panel.textContent?.toLowerCase()).not.toContain('board acknowledgement');
    page.setSponsorEnabled(false); expect(page.effectiveSponsor()).toBeNull(); expect(page.sponsorValid()).toBeTrue();
    const saved = spyOn(page.saved, 'emit'); await page.save();
    expect(saved.calls.mostRecent().args[0].sponsorship).toEqual({ mode: 'off' });
    expect(saved.calls.mostRecent().args[0].boardSponsorship).toBeUndefined(); fixture.destroy();
  });

  it('does not overwrite a board default changed elsewhere when only card settings are saved', async () => {
    const fixture = TestBed.createComponent(TalkingCardEditorComponent), page = fixture.componentInstance;
    fixture.componentRef.setInput('boardId', 'historic-board');
    fixture.componentRef.setInput('boardSponsorship', { name: 'Original', message: 'Original acknowledgement.' });
    fixture.detectChanges(); await fixture.whenStable();
    page.selectedAtlasId.set('george');
    fixture.componentRef.setInput('boardSponsorship', { name: 'Updated elsewhere', message: 'New approved acknowledgement.' });
    fixture.detectChanges();
    const saved = spyOn(page.saved, 'emit'); await page.save();
    expect(saved.calls.mostRecent().args[0].boardSponsorship).toBeUndefined(); fixture.destroy();
  });

  it('searches existing avatars without rendering a long select menu', () => {
    const fixture = TestBed.createComponent(TalkingCardEditorComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#talking-avatar-search')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.talking-editor__avatar-search select')).toBeNull();

    fixture.componentInstance.avatarSearch.set('george');
    fixture.detectChanges();
    const results = fixture.nativeElement.querySelectorAll('#talking-avatar-results [role="option"]');
    expect(results.length).toBe(1);
    expect(results[0].textContent).toContain('George Washington');
  });

  it('prefills the real-estate guide and isolates its draft from the generic editor', async () => {
    const fixture = TestBed.createComponent(TalkingCardEditorComponent);
    fixture.componentRef.setInput('boardId', 'listing-board');
    fixture.componentRef.setInput('prefill', {
      draftKey: 'listing-agent-setup',
      name: 'Jenny Morgan',
      role: 'North Star Realty · Listing agent',
      personaPrompt: 'Answer from the supplied property context.',
      openingMessage: 'Hi, I’m Jenny. Ask me about this home.',
      ctaLabel: 'Ask Jenny',
    });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance.name()).toBe('Jenny Morgan');
    expect(fixture.componentInstance.role()).toContain('Listing agent');
    expect(fixture.componentInstance.openingMessage()).toContain('Ask me about this home');
    expect(fixture.componentInstance.ctaLabel()).toBe('Ask Jenny');
    expect(draftStore.load).toHaveBeenCalledWith('board:listing-board:listing-agent-setup');
  });

  it('shows the focused real-estate setup with the profile photo and default personal voice', async () => {
    const fixture = TestBed.createComponent(TalkingCardEditorComponent);
    fixture.componentRef.setInput('boardId', 'listing-board-focused');
    fixture.componentRef.setInput('boardTitle', '12 Garden Lane');
    fixture.componentRef.setInput('prefill', {
      experience: 'real-estate',
      draftKey: 'listing-agent-setup',
      propertyTitle: '12 Garden Lane',
      imageUrl: 'https://example.com/jenny-profile.jpg',
      contactEmail: 'jenny@example.com',
      contactPhone: '702-555-0102',
      name: 'Jenny Morgan',
      role: 'North Star Realty · Listing agent',
      personaPrompt: 'Prepared real-estate prompt.',
      openingMessage: 'Hi, I’m Jenny. Ask me about 12 Garden Lane.',
      ctaLabel: 'Ask Jenny',
    });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.mode()).toBe('new');
    expect(fixture.componentInstance.voiceChoice()).toBe('personal');
    expect(fixture.componentInstance.personalVoiceId()).toBe('voice-1');
    expect(fixture.componentInstance.imagePreviewUrl()).toBe('https://example.com/jenny-profile.jpg');
    expect((fixture.nativeElement.querySelector('.talking-editor__real-estate-portrait img') as HTMLImageElement).src)
      .toContain('jenny-profile.jpg');
    expect(fixture.nativeElement.textContent).toContain('Create your property guide');
    expect(fixture.nativeElement.textContent).toContain('Contact details already connected');
    expect(fixture.nativeElement.textContent).toContain('Create my Talking Card');
    expect(fixture.nativeElement.textContent).not.toContain('System prompt');
    expect(fixture.nativeElement.querySelector('.talking-editor__tabs')).toBeNull();
  });

  it('reuses an owned agent avatar without replacing its saved voice with the personal default', async () => {
    const fixture = TestBed.createComponent(TalkingCardEditorComponent);
    fixture.componentRef.setInput('boardId', 'listing-board-reuse');
    fixture.componentRef.setInput('prefill', {
      experience: 'real-estate',
      draftKey: 'listing-agent-setup',
      preferredAtlasId: 'george',
      imageUrl: 'https://example.com/profile-fallback.jpg',
      name: 'George Washington',
      role: 'Listing agent',
      personaPrompt: 'Prepared real-estate prompt.',
      openingMessage: 'Ask me about this property.',
    });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance.mode()).toBe('existing');
    expect(fixture.componentInstance.selectedAtlasId()).toBe('george');
    expect(fixture.componentInstance.voiceChoice()).toBe('default');
    expect(fixture.componentInstance.imagePreviewUrl()).toBe('https://example.com/profile-fallback.jpg');
  });

  it('turns the optional showing URL into one concise scheduling action', async () => {
    const fixture = TestBed.createComponent(TalkingCardEditorComponent);
    fixture.componentRef.setInput('boardId', 'listing-board-scheduling');
    fixture.componentRef.setInput('prefill', {
      experience: 'real-estate',
      draftKey: 'listing-agent-setup',
      name: 'Jenny Morgan',
      personaPrompt: 'Prepared real-estate prompt.',
      openingMessage: 'Ask me about this property.',
    });
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.updateRealEstateScheduleUrl('https://cal.example.com/jenny');
    expect(fixture.componentInstance.actions()).toEqual([jasmine.objectContaining({
      kind: 'schedule',
      label: 'Schedule a showing',
      url: 'https://cal.example.com/jenny',
    })]);
    fixture.componentInstance.updateRealEstateScheduleUrl('');
    expect(fixture.componentInstance.actions()).toEqual([]);
  });

  it('creates the real-estate guide with its prepared prompt, profile photo, and personal voice', async () => {
    const fixture = TestBed.createComponent(TalkingCardEditorComponent);
    fixture.componentRef.setInput('boardId', 'listing-board-save');
    fixture.componentRef.setInput('prefill', {
      experience: 'real-estate',
      draftKey: 'listing-agent-setup',
      imageUrl: 'https://example.com/jenny-profile.jpg',
      name: 'Jenny Morgan',
      role: 'North Star Realty · Listing agent',
      personaPrompt: 'Prepared real-estate prompt with property safeguards.',
      openingMessage: 'Hi, I’m Jenny. Ask me about this home.',
      ctaLabel: 'Ask Jenny',
    });
    const saved = spyOn(fixture.componentInstance.saved, 'emit');
    fixture.detectChanges();
    await fixture.whenStable();

    await fixture.componentInstance.save();

    expect(atlasService.createTalkingCardAtlas).toHaveBeenCalledOnceWith({
      name: 'Jenny Morgan',
      role: 'North Star Realty · Listing agent',
      personaPrompt: 'Prepared real-estate prompt with property safeguards.',
      imageUrl: 'https://example.com/jenny-profile.jpg',
      isPublic: false,
    });
    expect(atlasService.updateAtlas).not.toHaveBeenCalled();
    expect(atlasService.updateChatGuideConfig).not.toHaveBeenCalled();
    expect(atlasService.selectAtlasPersonalVoice).toHaveBeenCalledWith('new-avatar', 'voice-1');
    expect(saved).toHaveBeenCalledWith(jasmine.objectContaining({
      atlasId: 'new-avatar',
      title: 'Jenny Morgan',
      imageUrl: 'https://example.com/jenny-profile.jpg',
      personaPrompt: 'Prepared real-estate prompt with property safeguards.',
      ctaLabel: 'Ask Jenny',
      placement: 'end',
    }));
    expect(fixture.componentInstance.saving()).toBeTrue();
    expect(draftStore.delete).not.toHaveBeenCalled();

    await fixture.componentInstance.completeSave();

    expect(fixture.componentInstance.saving()).toBeFalse();
    expect(draftStore.delete).toHaveBeenCalledWith('board:listing-board-save:listing-agent-setup');
  });

  for (const visibility of ['public', 'unlisted', 'private'] as const) {
    for (const realEstate of [false, true]) {
      it(`creates a private ${realEstate ? 'property guide' : 'avatar'} on a ${visibility} board without directory publication`, async () => {
        const fixture = TestBed.createComponent(TalkingCardEditorComponent);
        fixture.componentRef.setInput('boardId', 'board-private-avatar');
        fixture.componentRef.setInput('boardVisibility', visibility);
        if (realEstate) fixture.componentRef.setInput('prefill', {
          experience: 'real-estate', name: 'Edmond Mbadu',
          personaPrompt: 'Answer from the property context.', openingMessage: 'Ask me about this home.',
        });
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.componentInstance.setMode('new');
        fixture.componentInstance.name.set('Edmond Mbadu');
        fixture.componentInstance.personaPrompt.set('Answer from the property context.');
        fixture.detectChanges();
        expect(fixture.componentInstance.publishAvatar()).toBeFalse();
        expect(fixture.componentInstance.canSave()).toBeTrue();
        await fixture.componentInstance.save();
        expect(atlasService.createTalkingCardAtlas).toHaveBeenCalledWith(jasmine.objectContaining({ isPublic: false }));
        expect(atlasService.updateAtlas).not.toHaveBeenCalledWith('new-avatar', { is_public: true });
      });
    }
  }

  it('allows optional directory publication on an unlisted board', async () => {
    const fixture = TestBed.createComponent(TalkingCardEditorComponent);
    fixture.componentRef.setInput('boardVisibility', 'unlisted');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentInstance.setMode('new');
    fixture.componentInstance.name.set('New guide');
    fixture.componentInstance.personaPrompt.set('Answer from the documents.');
    fixture.componentInstance.publishAvatar.set(true);
    await fixture.componentInstance.save();
    expect(atlasService.updateAtlas).toHaveBeenCalledWith('new-avatar', { is_public: true });
  });

  it('reuses a private property guide without automatically publishing it', async () => {
    const fixture = TestBed.createComponent(TalkingCardEditorComponent);
    fixture.componentRef.setInput('boardId', 'public-listing');
    fixture.componentRef.setInput('boardVisibility', 'public');
    fixture.componentRef.setInput('prefill', {
      experience: 'real-estate', preferredAtlasId: 'james', name: 'James Madison',
      personaPrompt: 'Answer from the property context.', openingMessage: 'Ask me about this home.',
    });
    fixture.detectChanges();
    await new Promise(resolve => setTimeout(resolve, 0));
    await fixture.whenStable();
    expect(fixture.componentInstance.mode()).toBe('existing');
    expect(fixture.componentInstance.canSave()).toBeTrue();
    await fixture.componentInstance.save();
    expect(atlasService.updateAtlas).not.toHaveBeenCalledWith('james', { is_public: true });
  });

  it('clears optional publication when switching to a new avatar', async () => {
    const fixture = TestBed.createComponent(TalkingCardEditorComponent);
    fixture.componentRef.setInput('boardVisibility', 'public');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentInstance.selectExistingAtlas('george');
    await fixture.whenStable();
    fixture.componentInstance.publishAvatar.set(true);
    fixture.componentInstance.setMode('new');
    fixture.componentInstance.personaPrompt.set('A new private avatar.');
    expect(fixture.componentInstance.publishAvatar()).toBeFalse();
    expect(fixture.componentInstance.canSave()).toBeTrue();
  });

  it('does not reupload successful knowledge documents when the board save is retried', async () => {
    const fixture = TestBed.createComponent(TalkingCardEditorComponent);
    fixture.componentRef.setInput('boardId', 'retry-documents');
    fixture.detectChanges();
    await fixture.whenStable();
    const component = fixture.componentInstance;
    component.setMode('new');
    component.name.set('Guide');
    component.personaPrompt.set('Answer from the uploaded guide.');
    component.documentFiles.set([new File(['A short document'], 'guide.docx')]);
    await component.save();
    await component.completeSave('Firebase denied the board save.');
    await component.save();
    expect(documentsService.uploadFiles).toHaveBeenCalledTimes(1);
    expect(atlasService.createTalkingCardAtlas).toHaveBeenCalledTimes(1);
    expect(component.documentFiles()).toEqual([]);
  });

  it('keeps the editor retryable and preserves its draft when board persistence fails', async () => {
    const fixture = TestBed.createComponent(TalkingCardEditorComponent);
    fixture.componentRef.setInput('boardId', 'listing-board-failed-save');
    fixture.componentRef.setInput('prefill', {
      experience: 'real-estate',
      draftKey: 'listing-agent-setup',
      name: 'Jenny Morgan',
      personaPrompt: 'Prepared real-estate prompt.',
      openingMessage: 'Ask me about this property.',
    });
    fixture.detectChanges();
    await fixture.whenStable();

    await fixture.componentInstance.save();
    await fixture.componentInstance.completeSave('Your Talking Card could not be saved.');
    fixture.detectChanges();

    expect(fixture.componentInstance.saving()).toBeFalse();
    expect(fixture.componentInstance.errorMessage()).toContain('could not be saved');
    expect(draftStore.save).toHaveBeenCalled();
    expect(draftStore.delete).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('could not be saved');
  });

  it('cleans a legacy real-estate draft without restoring its automatic publication choice', async () => {
    draftStore.load.and.resolveTo({
      key: 'board:listing-board-legacy-draft:listing-agent-setup',
      version: 1,
      boardId: 'listing-board-legacy-draft',
      mode: 'new',
      selectedAtlasId: '',
      createdAtlasId: '',
      name: 'Edmond Mbadu',
      role: 'Edmond Mbadu Executive Realty Services Phone: · Listing agent',
      personaPrompt: 'Old prompt.',
      openingMessage: 'Ask me about this property.',
      ctaLabel: 'Ask Edmond',
      placement: 'end',
      actions: [],
      catalogVoiceId: '',
      personalVoiceId: '',
      voiceChoice: 'default',
      publishAvatar: true,
      imageFile: null,
      uploadedImageUrl: '',
      documentFiles: [],
      updatedAt: '2026-09-07T00:00:00.000Z',
    });
    const fixture = TestBed.createComponent(TalkingCardEditorComponent);
    fixture.componentRef.setInput('boardId', 'listing-board-legacy-draft');
    fixture.componentRef.setInput('boardVisibility', 'public');
    fixture.componentRef.setInput('prefill', {
      experience: 'real-estate',
      draftKey: 'listing-agent-setup',
      name: 'Edmond Mbadu',
      role: 'Executive Realty Services · Listing agent',
      personaPrompt: 'Prepared prompt.',
      openingMessage: 'Ask me about this property.',
    });

    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance.role()).toBe('Executive Realty Services · Listing agent');
    expect(fixture.componentInstance.personaPrompt()).toContain('Executive Realty Services');
    expect(fixture.componentInstance.personaPrompt()).not.toContain('Phone:');
    expect(fixture.componentInstance.publishAvatar()).toBeFalse();
    expect(fixture.componentInstance.canSave()).toBeTrue();
    await fixture.componentInstance.save();
    expect(atlasService.createTalkingCardAtlas).toHaveBeenCalledWith(jasmine.objectContaining({ isPublic: false }));
    expect(atlasService.updateAtlas).not.toHaveBeenCalled();
  });

  it('selects a searched avatar and clears the result list', () => {
    const fixture = TestBed.createComponent(TalkingCardEditorComponent);
    fixture.detectChanges();
    fixture.componentInstance.avatarSearch.set('madison');
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('#talking-avatar-results [role="option"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(fixture.componentInstance.selectedAtlasId()).toBe('james');
    expect(fixture.componentInstance.avatarSearch()).toBe('');
    expect(fixture.nativeElement.textContent).toContain('Selected avatar');
  });

  it('includes public avatars in search without allowing their voice configuration to be changed', async () => {
    const fixture = TestBed.createComponent(TalkingCardEditorComponent);
    fixture.componentRef.setInput('boardId', 'board-public-avatar');
    fixture.detectChanges();
    await draftStore.load.calls.mostRecent().returnValue;
    fixture.componentInstance.onAvatarSearchChange('glover');
    await atlasService.listPublicAtlases.calls.mostRecent().returnValue;
    await fixture.whenStable();
    fixture.detectChanges();

    const result = fixture.nativeElement.querySelector('#talking-avatar-results [role="option"]') as HTMLButtonElement;
    expect(result.textContent).toContain('Colonel John Glover');
    expect(result.textContent).toContain('Public library');
    result.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.selectedAtlasEditable()).toBeFalse();
    expect(fixture.nativeElement.textContent).toContain('keeps the persona and voice chosen by its creator');
    await fixture.componentInstance.save();
    expect(atlasService.selectAtlasCatalogVoice).not.toHaveBeenCalled();
  });

  it('does not load the public avatar library until the user searches', async () => {
    const fixture = TestBed.createComponent(TalkingCardEditorComponent);
    fixture.componentRef.setInput('boardId', 'board-lazy-avatar-search');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(atlasService.listPublicAtlases).not.toHaveBeenCalled();

    fixture.componentInstance.onAvatarSearchChange('glover');
    await fixture.whenStable();

    expect(atlasService.listPublicAtlases).toHaveBeenCalledOnceWith(true);
    expect(fixture.componentInstance.publicAtlases()).toEqual([publicGlover]);
  });

  it('shows the full included voice catalog before the user searches', () => {
    const fixture = TestBed.createComponent(TalkingCardEditorComponent);
    fixture.detectChanges();
    fixture.componentInstance.setMode('new');
    fixture.detectChanges();

    const options = fixture.nativeElement.querySelectorAll('.talking-editor__voice-results [role="radio"]');
    const label = fixture.nativeElement.querySelector('.talking-editor__voice-library-label') as HTMLElement;

    expect(options.length).toBe(STACK_STUDIO_NARRATOR_VOICES.length);
    expect(options[options.length - 1].textContent).toContain(STACK_STUDIO_NARRATOR_VOICES.at(-1)!.name);
    expect(label.textContent).toContain(`All ${STACK_STUDIO_NARRATOR_VOICES.length} voices`);
  });

  it('previews an included voice without changing the avatar selection', async () => {
    const play = spyOn(HTMLMediaElement.prototype, 'play').and.resolveTo();
    spyOn(HTMLMediaElement.prototype, 'pause');
    const fixture = TestBed.createComponent(TalkingCardEditorComponent);
    fixture.detectChanges();
    fixture.componentInstance.selectExistingAtlas('george');
    await fixture.whenStable();
    const voice = STACK_STUDIO_NARRATOR_VOICES.at(-1)!;

    await fixture.componentInstance.toggleVoicePreview(`catalog:${voice.id}`, voice);

    expect(atlasService.previewAtlasSpeechVoice).toHaveBeenCalledWith('', voice.sampleText, voice.id);
    expect(play).toHaveBeenCalled();
    expect(fixture.componentInstance.voicePreviewPlayingKey()).toBe(`catalog:${voice.id}`);
  });

  it('saves a newly selected catalog voice to an existing avatar', async () => {
    const fixture = TestBed.createComponent(TalkingCardEditorComponent);
    fixture.detectChanges();
    fixture.componentInstance.selectExistingAtlas('george');
    await fixture.whenStable();
    const voice = STACK_NARRATOR_VOICES[0];
    fixture.componentInstance.selectCatalogVoice(voice);

    await fixture.componentInstance.save();

    expect(atlasService.selectAtlasCatalogVoice).toHaveBeenCalledWith('george', voice.id);
  });

  it('saves a selected catalog voice to a newly created avatar', async () => {
    const fixture = TestBed.createComponent(TalkingCardEditorComponent);
    fixture.detectChanges();
    await new Promise(resolve => setTimeout(resolve, 0));
    fixture.componentInstance.setMode('new');
    fixture.componentInstance.name.set('Maya Chen');
    fixture.componentInstance.personaPrompt.set('You are Maya. Speak in the first person.');
    const voice = STACK_STUDIO_NARRATOR_VOICES.at(-1)!;
    fixture.componentInstance.selectCatalogVoice(voice);

    await fixture.componentInstance.save();

    expect(atlasService.createTalkingCardAtlas).toHaveBeenCalled();
    expect(atlasService.selectAtlasCatalogVoice).toHaveBeenCalledWith('new-avatar', voice.id);
  });

  it('loads My voices and shows the server-authoritative free account limit', async () => {
    const fixture = TestBed.createComponent(TalkingCardEditorComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentInstance.setMode('new');
    fixture.detectChanges();

    expect(personalVoiceService.loadLibrary).toHaveBeenCalled();
    expect(fixture.componentInstance.personalVoices()).toEqual(personalLibrary.voices);
    expect(fixture.nativeElement.querySelector('.talking-editor__personal-library').textContent).toContain('1 of 1');
    expect(fixture.nativeElement.querySelector('.talking-editor__personal-add').textContent).toContain('Upgrade');
  });

  it('previews a personal voice through its authenticated narrator id', async () => {
    spyOn(HTMLMediaElement.prototype, 'play').and.resolveTo();
    spyOn(HTMLMediaElement.prototype, 'pause');
    const fixture = TestBed.createComponent(TalkingCardEditorComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const voice = personalLibrary.voices[0];

    await fixture.componentInstance.toggleVoicePreview(
      `personal:${voice.id}:${voice.voiceRevision}`,
      undefined,
      voice.narratorVoiceId,
    );

    expect(atlasService.previewAtlasSpeechVoice).toHaveBeenCalledWith(
      '',
      jasmine.stringContaining('LivingWiki guide'),
      'personal-voice:voice-1',
    );
  });

  it('saves a personal voice to an existing editable avatar', async () => {
    const fixture = TestBed.createComponent(TalkingCardEditorComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentInstance.selectExistingAtlas('george');
    await fixture.whenStable();
    fixture.componentInstance.selectPersonalVoice(personalLibrary.voices[0]);

    await fixture.componentInstance.save();

    expect(atlasService.selectAtlasPersonalVoice).toHaveBeenCalledWith('george', 'voice-1');
  });

  it('saves a personal voice after creating a new avatar', async () => {
    const fixture = TestBed.createComponent(TalkingCardEditorComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentInstance.setMode('new');
    fixture.componentInstance.name.set('Maya Chen');
    fixture.componentInstance.personaPrompt.set('You are Maya.');
    fixture.componentInstance.selectPersonalVoice(personalLibrary.voices[0]);

    await fixture.componentInstance.save();

    expect(atlasService.createTalkingCardAtlas).toHaveBeenCalled();
    expect(atlasService.selectAtlasPersonalVoice).toHaveBeenCalledWith('new-avatar', 'voice-1');
  });

  it('routes a full free voice library to upgrade while replacement remains available', async () => {
    const fixture = TestBed.createComponent(TalkingCardEditorComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.openPersonalVoiceSetup();
    expect(router.navigate).toHaveBeenCalledWith(['/pricing'], { queryParams: { feature: 'personal-voice' } });

    fixture.componentInstance.openPersonalVoiceSetup(personalLibrary.voices[0]);
    expect(fixture.componentInstance.personalVoiceSetupOpen()).toBeTrue();
    expect(fixture.componentInstance.personalVoiceSetupVoiceId()).toBe('voice-1');
  });

  it('replaces a personal voice through the shared Stack Studio voice service', async () => {
    const fixture = TestBed.createComponent(TalkingCardEditorComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const voice = personalLibrary.voices[0];
    const recording = new File(['recording'], 'voice.webm', { type: 'audio/webm' });
    fixture.componentInstance.openPersonalVoiceSetup(voice);
    fixture.componentInstance.personalVoiceFile.set(recording);
    fixture.componentInstance.personalVoiceDurationSeconds.set(72);
    fixture.componentInstance.personalVoiceOwnVoiceConfirmed.set(true);
    fixture.componentInstance.personalVoiceConsentConfirmed.set(true);

    await fixture.componentInstance.createPersonalVoice();

    expect(personalVoiceService.createVoice).toHaveBeenCalledWith({
      file: recording,
      durationSeconds: 72,
      name: 'Edmond',
      replacingVoiceId: 'voice-1',
      onUploadProgress: jasmine.any(Function),
    });
    expect(fixture.componentInstance.voiceChoice()).toBe('personal');
    expect(fixture.componentInstance.personalVoiceId()).toBe('voice-1');
  });

  it('uploads a new avatar image through the user-owned avatar path', async () => {
    const fixture = TestBed.createComponent(TalkingCardEditorComponent);
    fixture.componentRef.setInput('boardId', 'board-image-upload');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentInstance.setMode('new');
    fixture.componentInstance.name.set('Colonel John Glover');
    fixture.componentInstance.personaPrompt.set('You are Colonel John Glover.');
    const image = new File(['portrait'], 'glover.png', { type: 'image/png' });
    fixture.componentInstance.imageFile.set(image);

    await fixture.componentInstance.save();

    expect(atlasService.uploadTalkingCardAvatarImage).toHaveBeenCalledWith('new-avatar', image);
    expect(atlasService.updateAtlas).toHaveBeenCalledWith('new-avatar', {
      logo_url: 'https://example.com/avatar.png',
    });
    expect(atlasService.updateChatGuideConfig).toHaveBeenCalled();
  });

  it('downscales a large portrait before previewing or uploading it', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 2400;
    canvas.height = 1600;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#315f4c';
    context.fillRect(0, 0, canvas.width, canvas.height);
    const sourceBlob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not create test portrait.'));
    }, 'image/png'));
    const source = new File([sourceBlob], 'large-portrait.png', { type: 'image/png' });
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', { value: [source] });
    const fixture = TestBed.createComponent(TalkingCardEditorComponent);
    fixture.componentRef.setInput('boardId', 'board-large-portrait');
    fixture.detectChanges();

    await fixture.componentInstance.onImageSelected({ target: input } as unknown as Event);

    const optimized = fixture.componentInstance.imageFile();
    expect(optimized).not.toBeNull();
    expect(optimized?.type).toBe('image/webp');
    expect(optimized!.size).toBeLessThan(source.size);
    const bitmap = await createImageBitmap(optimized!);
    expect(Math.max(bitmap.width, bitmap.height)).toBe(1200);
    bitmap.close();
  });

  it('restores and saves a board-scoped local draft, including selected files', async () => {
    const image = new File(['portrait'], 'glover.png', { type: 'image/png' });
    const document = new File(['facts'], 'glover-facts.txt', { type: 'text/plain' });
    const restored: TalkingCardDraftRecord = {
      key: 'board:board-draft',
      version: 1,
      boardId: 'board-draft',
      mode: 'new',
      selectedAtlasId: '',
      createdAtlasId: 'partially-created-atlas',
      name: 'Colonel John Glover',
      role: 'Marblehead commander',
      personaPrompt: 'You are Colonel John Glover.',
      openingMessage: 'We have an army to move before daylight.',
      ctaLabel: 'Talk to Glover',
      placement: 'end',
      actions: [{ id: 'schedule-1', kind: 'schedule', label: 'Book a tour', url: 'https://cal.com/glover' }],
      catalogVoiceId: '',
      personalVoiceId: 'voice-1',
      voiceChoice: 'personal',
      publishAvatar: false,
      imageFile: image,
      uploadedImageUrl: '',
      documentFiles: [document],
      updatedAt: '2026-08-31T00:00:00.000Z',
    };
    draftStore.load.and.resolveTo(restored);
    const fixture = TestBed.createComponent(TalkingCardEditorComponent);
    fixture.componentRef.setInput('boardId', 'board-draft');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance.name()).toBe('Colonel John Glover');
    expect(fixture.componentInstance.imageFile()?.name).toBe('glover.png');
    expect(fixture.componentInstance.documentFiles()[0]?.name).toBe('glover-facts.txt');
    expect(fixture.componentInstance.voiceChoice()).toBe('personal');
    expect(fixture.componentInstance.personalVoiceId()).toBe('voice-1');
    expect(fixture.componentInstance.actions()[0]?.url).toBe('https://cal.com/glover');
    await fixture.componentInstance.close();

    expect(draftStore.save).toHaveBeenCalledWith(jasmine.objectContaining({
      key: 'board:board-draft',
      createdAtlasId: 'partially-created-atlas',
      name: 'Colonel John Glover',
      personalVoiceId: 'voice-1',
      voiceChoice: 'personal',
      actions: [jasmine.objectContaining({ kind: 'schedule', url: 'https://cal.com/glover' })],
    }));
  });

  it('edits the card presentation, shared persona, and conversation actions in one flow', async () => {
    const fixture = TestBed.createComponent(TalkingCardEditorComponent);
    fixture.componentRef.setInput('boardId', 'board-edit');
    fixture.componentRef.setInput('editingCard', {
      id: 'card-1',
      title: 'George Washington',
      subtitle: 'Historical guide',
      imageUrl: 'https://example.com/george.png',
      placement: 'keep',
      conversation: {
        version: 1,
        provider: 'atlas',
        atlasId: 'george',
        openingMessage: 'Welcome to Mount Vernon.',
        ctaLabel: 'Talk to George',
        actions: [{
          id: 'schedule-1',
          kind: 'schedule',
          label: 'Book a tour',
          url: 'https://cal.com/mount-vernon',
          description: 'Choose a time for a private tour.',
        }],
      },
    });
    let emitted: unknown;
    fixture.componentInstance.saved.subscribe((value) => { emitted = value; });
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Edit Talking Card');
    expect(fixture.componentInstance.name()).toBe('George Washington');
    expect(talkingCardKnowledgeService.listOwnedAtlasDocuments).toHaveBeenCalledOnceWith('george');

    fixture.componentInstance.name.set('George at Mount Vernon');
    fixture.componentInstance.personaPrompt.set('Answer as George Washington and cite the supplied documents.');
    fixture.componentInstance.updateAction(0, 'label', 'Schedule a private tour');
    fixture.componentInstance.addAction('link');
    fixture.componentInstance.updateAction(1, 'label', 'View the property guide');
    fixture.componentInstance.updateAction(1, 'url', 'https://example.com/property-guide');

    await fixture.componentInstance.save();

    expect(atlasService.updatePersonaPrompt).toHaveBeenCalledWith(
      'george',
      'Answer as George Washington and cite the supplied documents.',
    );
    expect(atlasService.updateChatGuideConfig).toHaveBeenCalled();
    expect(emitted).toEqual(jasmine.objectContaining({
      cardId: 'card-1',
      atlasId: 'george',
      title: 'George at Mount Vernon',
      placement: 'keep',
      actions: [
        jasmine.objectContaining({ kind: 'schedule', label: 'Schedule a private tour' }),
        jasmine.objectContaining({ kind: 'link', url: 'https://example.com/property-guide' }),
      ],
    }));
  });

  it('keeps a public library avatar locked while allowing card-only presentation and actions', async () => {
    const fixture = TestBed.createComponent(TalkingCardEditorComponent);
    fixture.componentRef.setInput('editingCard', {
      id: 'card-public',
      title: 'Colonel John Glover',
      subtitle: 'Marblehead commander',
      imageUrl: '',
      placement: 'keep',
      conversation: {
        version: 1,
        provider: 'atlas',
        atlasId: publicGlover.id,
        openingMessage: 'How can I help?',
        ctaLabel: 'Talk to Glover',
      },
    });
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.componentInstance.setEditorSection('knowledge');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('avatar creator manages its system prompt and knowledge');
    expect(talkingCardKnowledgeService.listOwnedAtlasDocuments).not.toHaveBeenCalled();

    await fixture.componentInstance.save();

    expect(atlasService.updatePersonaPrompt).not.toHaveBeenCalled();
    expect(atlasService.updateChatGuideConfig).not.toHaveBeenCalled();
  });

  it('presents the full avatar deep editor when editing a Talking Card', async () => {
    const fixture = TestBed.createComponent(TalkingCardEditorComponent);
    fixture.componentRef.setInput('editingCard', {
      id: 'listing-guide-card',
      title: 'Jenny Morgan',
      subtitle: 'North Star Realty · Listing agent',
      imageUrl: 'https://example.com/jenny.jpg',
      placement: 'keep',
      conversation: {
        version: 1,
        provider: 'atlas',
        atlasId: 'george',
        openingMessage: 'Ask me about this home.',
        ctaLabel: 'Ask Jenny',
      },
    });
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Edit Talking Card & avatar');
    expect(fixture.nativeElement.textContent).toContain('Deep-edit the card, avatar prompt, documents, voice, and visitor actions.');
    const tabs = Array.from(fixture.nativeElement.querySelectorAll('[role="tab"]'))
      .map((element: unknown) => (element as HTMLElement).textContent?.trim());
    expect(tabs).toEqual(['Card', 'Prompt & documents', 'Voice', 'Sponsorship', 'Actions']);

    fixture.componentInstance.setEditorSection('knowledge');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Avatar prompt & documents');
    expect(fixture.nativeElement.textContent).toContain('System prompt');
    expect(fixture.nativeElement.textContent).toContain('Knowledge documents');
    expect(talkingCardKnowledgeService.listOwnedAtlasDocuments).toHaveBeenCalledWith('george');
  });
});
