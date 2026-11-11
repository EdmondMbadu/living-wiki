import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  eventDates, eventDisplayDate, eventDisplayTime, type EventGuideSettings, type EventPlan, type EventPreferences,
} from '../../../functions/src/event-guide-model';
import type { ContentLanguage } from '../../../functions/src/content-language';
import { EventGuideService } from './event-guide.service';

@Component({
  selector: 'app-event-guide-guest',
  imports: [FormsModule],
  templateUrl: './event-guide-guest.html',
  styleUrl: './event-guide.css',
})
export class EventGuideGuest {
  private readonly events = inject(EventGuideService);
  readonly boardId = input.required<string>();
  readonly cardId = input.required<string>();
  readonly settings = input.required<EventGuideSettings>();
  readonly language = input.required<ContentLanguage>();
  readonly preferences = signal<EventPreferences>({
    days: [], interests: '', mustSee: '', constraints: '', pace: 'curated', firstTimer: false,
  });
  readonly dates = computed(() => eventDates(this.settings().startDate, this.settings().endDate));
  readonly plan = signal<EventPlan | null>(null);
  readonly expanded = signal(false);
  private readonly building = signal(false);
  readonly sending = signal(false);
  readonly busy = computed(() => this.building() || this.sending());
  readonly error = signal('');
  readonly email = signal('');
  readonly sent = signal(false);
  readonly consent = signal(false);

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

  async build(overrides?: Partial<EventPreferences>): Promise<EventPlan | null> {
    if (this.busy()) return null;
    this.expanded.set(true);
    if (overrides) this.preferences.update((preferences) => ({ ...preferences, ...overrides }));
    const preferences = this.preferences();
    if (!preferences.days.length) {
      this.error.set($localize`Choose at least one day you’ll attend.`);
      return null;
    }
    this.building.set(true);
    this.error.set('');
    try {
      const plan = await this.events.plan({ boardId: this.boardId(), cardId: this.cardId() }, preferences, this.language());
      this.plan.set(plan);
      this.sent.set(false);
      this.consent.set(false);
      return plan;
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : $localize`Your itinerary could not be built.`);
      return null;
    } finally {
      this.building.set(false);
    }
  }

  async send(event: Event): Promise<void> {
    event.preventDefault();
    const plan = this.plan();
    if (!plan || this.busy() || !this.consent() || !this.email().trim() || this.sent()) return;
    this.sending.set(true);
    this.error.set('');
    try {
      const result = await this.events.send({ boardId: this.boardId(), cardId: this.cardId() }, plan, this.email().trim(), this.language());
      if (!result.sent) throw new Error($localize`The itinerary could not be sent.`);
      this.sent.set(true);
      this.email.set('');
      this.consent.set(false);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : $localize`The itinerary could not be sent.`);
    } finally {
      this.sending.set(false);
    }
  }
}
