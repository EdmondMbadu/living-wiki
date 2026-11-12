import { Component, computed, inject, input, output, signal, type OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  eventDates, eventDisplayDate, eventDisplayTime, type EventGuideSettings, type EventItineraryDraft, type EventPlan, type EventPreferences,
} from '../../../functions/src/event-guide-model';
import type { ContentLanguage } from '../../../functions/src/content-language';
import { EventGuideService, type EventRecapSessions } from './event-guide.service';

@Component({
  selector: 'app-event-guide-guest',
  imports: [FormsModule],
  templateUrl: './event-guide-guest.html',
  styleUrl: './event-guide.css',
})
export class EventGuideGuest implements OnInit {
  private readonly events = inject(EventGuideService);
  readonly boardId = input('');
  readonly cardId = input('');
  readonly settings = input.required<EventGuideSettings>();
  readonly language = input.required<ContentLanguage>();
  readonly recapMode = input(false);
  readonly recap = input<EventRecapSessions | null>(null);
  readonly initialDraft = input<EventItineraryDraft | null>(null);
  readonly emailRequested = output<void>();
  readonly preferences = signal<EventPreferences>({
    days: [], interests: '', mustSee: '', constraints: '', pace: 'curated', firstTimer: false,
  });
  private readonly editSettings = signal<EventGuideSettings | null>(null);
  readonly displaySettings = computed(() => this.editSettings() ?? this.settings());
  readonly dates = computed(() => eventDates(this.displaySettings().startDate, this.displaySettings().endDate));
  readonly plan = signal<EventPlan | null>(null);
  readonly expanded = signal(false);
  private readonly building = signal(false);
  readonly sending = signal(false);
  readonly busy = computed(() => this.building() || this.sending());
  readonly error = signal('');
  readonly email = signal('');
  readonly sent = signal(false);
  readonly saved = signal(false);
  private revision = 0;
  private recapRequestId = '';

  ngOnInit(): void {
    const draft = this.initialDraft();
    if (draft) this.applyDraft(draft);
  }

  setPreference<K extends keyof EventPreferences>(key: K, value: EventPreferences[K]): void {
    this.preferences.update((preferences) => ({ ...preferences, [key]: value }));
  }

  toggleDay(date: string, selected: boolean): void {
    this.preferences.update((preferences) => ({
      ...preferences, days: selected ? [...preferences.days, date] : preferences.days.filter((day) => day !== date),
    }));
  }

  formatDate(date: string): string { return eventDisplayDate(date, this.language()); }
  formatTime(minutes: number): string { return eventDisplayTime(minutes, this.language()); }

  openRecap(email: string): void {
    this.email.set(email);
    this.sent.set(false);
    this.error.set('');
  }

  async build(overrides?: Partial<EventPreferences>): Promise<EventPlan | null> {
    if (this.busy()) return null;
    this.expanded.set(true);
    if (overrides) this.preferences.update((preferences) => ({ ...preferences, ...overrides }));
    const preferences = this.preferences();
    if (!preferences.days.length) {
      this.error.set($localize`Choose at least one day you’ll attend.`);
      return null;
    }
    if (this.initialDraft()) return this.saveEdit({ preferences });
    this.building.set(true);
    this.error.set('');
    try {
      const plan = await this.events.plan({ boardId: this.boardId(), cardId: this.cardId() }, preferences, this.language());
      this.plan.set(plan);
      this.sent.set(false);
      return plan;
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : $localize`Your itinerary could not be built.`);
      return null;
    } finally {
      this.building.set(false);
    }
  }

  async removeItem(date: string, index: number): Promise<void> {
    if (this.initialDraft()) await this.saveEdit({ remove: { date, index } });
  }

  private async saveEdit(change: { preferences: EventPreferences } | { remove: { date: string; index: number } }): Promise<EventPlan | null> {
    const plan = this.plan();
    if (!plan || this.busy()) return null;
    this.building.set(true);
    this.error.set('');
    this.saved.set(false);
    try {
      const draft = await this.events.updateItinerary(plan, this.revision, change);
      this.applyDraft(draft, 'remove' in change);
      this.saved.set(true);
      return draft.plan;
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : $localize`Your itinerary could not be saved.`);
      return null;
    } finally {
      this.building.set(false);
    }
  }

  private applyDraft(draft: EventItineraryDraft, preservePreferences = false): void {
    if (!preservePreferences) this.preferences.set(draft.preferences);
    this.plan.set(draft.plan);
    this.editSettings.set(draft.settings);
    this.revision = draft.revision;
    this.expanded.set(true);
  }

  async send(event: Event): Promise<void> {
    event.preventDefault();
    const plan = this.plan();
    const recap = this.recap();
    if (!this.recapMode() || (!plan && !recap) || this.busy() || !this.email().trim() || this.sent()) return;
    this.sending.set(true);
    this.error.set('');
    try {
      const target = { boardId: this.boardId(), cardId: this.cardId() };
      const result = recap
        ? await this.events.send(target, plan, this.email().trim(), this.language(), {
          ...recap, requestId: this.recapRequestId ||= crypto.randomUUID(),
        })
        : await this.events.send(target, plan, this.email().trim(), this.language());
      if (!result.sent) throw new Error($localize`The event email could not be sent.`);
      this.sent.set(true);
      this.email.set('');
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : $localize`The event email could not be sent.`);
    } finally {
      this.sending.set(false);
    }
  }
}
