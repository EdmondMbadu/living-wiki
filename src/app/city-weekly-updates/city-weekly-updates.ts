import { isPlatformBrowser } from '@angular/common';
import { Component, effect, inject, PLATFORM_ID, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../auth.service';
import { CityWeeklyUpdatesService, type CityWeeklySettings } from './city-weekly-updates.service';

@Component({
  selector: 'app-city-weekly-updates',
  imports: [RouterLink],
  templateUrl: './city-weekly-updates.html',
  styleUrl: './city-weekly-updates.css',
})
export class CityWeeklyUpdatesComponent {
  readonly cityText = $localize`city`;
  readonly onText = $localize`On`;
  readonly offText = $localize`Off`;
  readonly savingText = $localize`Saving…`;
  readonly savedText = $localize`Preference saved.`;
  private readonly auth = inject(AuthService);
  private readonly service = inject(CityWeeklyUpdatesService);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  readonly settings = signal<CityWeeklySettings | null>(null);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly saved = signal(false);
  private requestId = 0;

  constructor() {
    effect(() => {
      const uid = this.auth.uid();
      const city = this.auth.profile()?.preferredCitySlug ?? null;
      untracked(() => {
        this.settings.set(null);
        this.busy.set(false);
        this.error.set(null);
        this.saved.set(false);
        ++this.requestId;
        if (uid && this.browser) void this.load();
      });
      // Tracking the saved account city refreshes the setting after a successful
      // Home city change; browsing and local display fallbacks do not affect it.
      void city;
    });
  }

  async load(): Promise<void> { await this.request(); }

  async toggle(): Promise<void> {
    const current = this.settings();
    if (!current || this.busy()) return;
    await this.request(!current.enabled);
  }

  private async request(enabled?: boolean): Promise<void> {
    const id = ++this.requestId;
    this.busy.set(true);
    this.error.set(null);
    this.saved.set(false);
    try {
      const settings = await this.service.preference(enabled);
      if (id !== this.requestId) return;
      this.settings.set(settings);
      this.saved.set(enabled !== undefined);
    } catch {
      if (id === this.requestId) this.error.set(enabled === undefined
        ? $localize`Could not load your weekly city update setting.`
        : $localize`Could not confirm your change. Reload the setting before trying again.`);
    } finally {
      if (id === this.requestId) this.busy.set(false);
    }
  }
}
