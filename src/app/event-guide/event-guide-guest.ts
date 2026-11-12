import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  eventDates, eventDisplayDate, eventDisplayTime, type EventGuideSettings, type EventPlan, type EventPreferences,
} from '../../../functions/src/event-guide-model';
import type { ContentLanguage } from '../../../functions/src/content-language';
import { EventGuideService, type EventRecapSessions } from './event-guide.service';

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
  readonly recapMode = input(false);
  readonly conversationActive = input(false);
  readonly recap = input<EventRecapSessions | null>(null);
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
  readonly itinerarySent = signal(false);
  readonly includeItinerary = signal(false);
  readonly consent = signal(false);
  readonly emailPlan = computed(() => !this.itinerarySent() && (!this.recapMode() || !this.recap() || this.includeItinerary())
    ? this.plan() : null);
  private recapRequestId = '';

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
    this.consent.set(false);
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
    this.building.set(true);
    this.error.set('');
    try {
      const plan = await this.events.plan({ boardId: this.boardId(), cardId: this.cardId() }, preferences, this.language());
      this.plan.set(plan);
      this.sent.set(false);
      this.itinerarySent.set(false);
      this.includeItinerary.set(false);
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
    const plan = this.emailPlan();
    const recap = this.recapMode() ? this.recap() : null;
    if ((!plan && !recap) || this.busy() || !this.consent() || !this.email().trim() || this.sent()) return;
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
      if (plan) this.itinerarySent.set(true);
      this.sent.set(true);
      this.email.set('');
      this.consent.set(false);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : $localize`The event email could not be sent.`);
    } finally {
      this.sending.set(false);
    }
  }
}
