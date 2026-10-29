import { DecimalPipe, isPlatformBrowser } from '@angular/common';
import { Component, DestroyRef, PLATFORM_ID, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PlatformAnalyticsService, type PlatformInventory } from '../platform-analytics.service';
@Component({
  selector: 'app-platform-analytics-entry',
  imports: [RouterLink, DecimalPipe],
  templateUrl: './platform-analytics-entry.html',
  styleUrl: './platform-analytics-entry.css',
})
export class PlatformAnalyticsEntryComponent {
  private readonly api = inject(PlatformAnalyticsService);
  private readonly destroy = inject(DestroyRef);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  readonly inventory = signal<PlatformInventory | null>(null);
  readonly error = signal(false);
  constructor() {
    this.destroy.onDestroy(() => {
      this.disposed = true;
      if (this.timer) clearTimeout(this.timer);
    });
    if (isPlatformBrowser(inject(PLATFORM_ID))) void this.load();
  }
  private async load(): Promise<void> {
    try {
      const value = await this.api.inventory();
      if (this.disposed) return;
      this.inventory.set(value.inventory);
      if (value.preparing) this.timer = setTimeout(() => void this.load(), 5000);
    } catch {
      if (!this.disposed) this.error.set(true);
    }
  }
}
