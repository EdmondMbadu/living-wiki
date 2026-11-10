import { Component, DestroyRef, ElementRef, computed, inject, input, output, signal, viewChildren } from '@angular/core';
import { CONTENT_LANGUAGES, type ContentLanguage } from '../../../functions/src/content-language';
import { PersonalVoiceService, type PersonalVoice, type PersonalVoiceLibrary, type StudioVoiceDesign } from '../personal-voice.service';

@Component({
  selector: 'app-studio-voice-designer',
  templateUrl: './studio-voice-designer.html',
  styleUrl: './studio-voice-designer.css',
})
export class StudioVoiceDesigner {
  private readonly voiceService = inject(PersonalVoiceService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly players = viewChildren<ElementRef<HTMLAudioElement>>('player');
  readonly defaultLanguage = input<ContentLanguage>('en');
  readonly canAddVoice = input(true);
  readonly voiceSaved = output<PersonalVoiceLibrary>();
  readonly useVoice = output<PersonalVoice>();
  readonly previewStarted = output<void>();
  readonly languages = CONTENT_LANGUAGES;
  readonly examples = [
    {
      name: $localize`Flamingo`,
      description: $localize`A friendly flamingo character with a bright, higher register, a light, lilting rhythm, and playful emphasis. Speak clearly at an easy pace for young visitors.`,
    },
    {
      name: $localize`Lion`,
      description: $localize`A warm lion character with a deep, resonant chest voice, a measured pace, gentle authority, and crisp pronunciation. Speak as if welcoming visitors into your home.`,
    },
    {
      name: $localize`Museum guide`,
      description: $localize`A curious museum guide with a warm mid-range voice, a conversational rhythm, and a hint of wonder. Give the listener time to picture the details.`,
    },
  ];
  readonly description = signal('');
  readonly languageChoice = signal<ContentLanguage | null>(null);
  readonly language = computed(() => this.languageChoice() ?? this.defaultLanguage());
  readonly name = signal('');
  readonly selectedIndex = signal<number | null>(null);
  readonly design = signal<StudioVoiceDesign | null>(null);
  readonly saved = signal<PersonalVoice | null>(null);
  readonly working = signal<'generate' | 'save' | null>(null);
  readonly error = signal('');
  readonly previews = computed(() => this.design()?.previews.map((preview) => ({
    ...preview,
    // The design endpoint requests MP3. Keep the playback type fixed.
    url: `data:audio/mpeg;base64,${preview.audioBase64}`,
  })) ?? []);

  setDescription(description: string): void {
    this.description.set(description);
    this.clearPreviews();
  }

  setLanguage(language: ContentLanguage): void {
    this.languageChoice.set(language);
    this.clearPreviews();
  }

  useExample(example: typeof this.examples[number]): void {
    this.name.set(example.name);
    this.setDescription(example.description);
  }

  pausePreviews(except?: HTMLAudioElement): void {
    for (const player of this.players()) {
      if (player.nativeElement !== except) player.nativeElement.pause();
    }
  }

  onPreviewPlay(player: HTMLAudioElement): void {
    this.pausePreviews(player);
    this.previewStarted.emit();
  }

  async generate(): Promise<void> {
    if (this.working() || !this.canAddVoice() || !this.description().trim()) return;
    this.clearPreviews();
    this.working.set('generate');
    try {
      this.design.set(await this.voiceService.designStudioVoice(this.description().trim(), this.language()));
    } catch (error) {
      this.error.set(this.errorMessage(error, $localize`Voice previews could not be generated. Try again.`));
    } finally {
      this.working.set(null);
    }
  }

  async save(): Promise<void> {
    const design = this.design();
    const index = this.selectedIndex();
    const name = this.name().trim();
    if (this.working() || !this.canAddVoice() || !design || index === null || !name) return;
    this.pausePreviews();
    this.error.set('');
    this.working.set('save');
    try {
      const library = await this.voiceService.saveStudioVoice(design.sessionId, index, name);
      if (this.destroyRef.destroyed) return;
      this.clearPreviews();
      this.saved.set(library.voice);
      this.voiceSaved.emit(library);
    } catch (error) {
      this.error.set(this.errorMessage(error, $localize`The voice could not be saved. Try again.`));
    } finally {
      this.working.set(null);
    }
  }

  private clearPreviews(): void {
    this.pausePreviews();
    this.error.set('');
    this.saved.set(null);
    this.design.set(null);
    this.selectedIndex.set(null);
  }

  private errorMessage(error: unknown, fallback: string): string {
    const message = error instanceof Error ? error.message.trim() : '';
    return !message || /^(internal|unavailable|deadline-exceeded)$/i.test(message) ? fallback : message;
  }
}
