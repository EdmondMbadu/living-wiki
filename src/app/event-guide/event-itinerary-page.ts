import { isPlatformBrowser } from '@angular/common';
import { Component, inject, PLATFORM_ID, signal, type OnInit } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { contentLanguageDetails } from '../../../functions/src/content-language';
import type { EventItineraryDraft } from '../../../functions/src/event-guide-model';
import { AuthService } from '../auth.service';
import { EventGuideGuest } from './event-guide-guest';
import { EventGuideService } from './event-guide.service';

@Component({
  selector: 'app-event-itinerary-page',
  imports: [EventGuideGuest, RouterLink],
  templateUrl: './event-itinerary-page.html',
  styles: `
    .itinerary-page { width: min(100% - 2rem, 46rem); margin: 2rem auto 3rem; }
    .brand { display: inline-block; color: var(--text); font-size: 1rem; font-weight: 750; }
    h1 { margin: 1rem 0 .3rem; font-size: clamp(1.55rem, 5vw, 2.2rem); }
    p { margin: 0 0 1rem; color: var(--muted); }
    button { margin-inline-start: .65rem; }
  `,
})
export class EventItineraryPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly events = inject(EventGuideService);
  private readonly auth = inject(AuthService);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  readonly languageDetails = contentLanguageDetails;
  readonly draft = signal<EventItineraryDraft | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly accessRequired = signal(false);
  readonly signedIn = this.auth.isAuthenticated;

  ngOnInit(): void {
    if (this.browser) void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.accessRequired.set(false);
    try {
      const link = /^([A-Za-z0-9_-]{1,180})\.([a-f0-9]{64})$/.exec(this.route.snapshot.fragment ?? '');
      if (!link) throw new Error($localize`This itinerary link is incomplete.`);
      await this.auth.waitForReady();
      this.draft.set(await this.events.itinerary(link[1], link[2]));
    } catch (error) {
      this.accessRequired.set(error instanceof Error && 'code' in error && error.code === 'functions/permission-denied');
      this.error.set(this.accessRequired()
        ? $localize`Sign in with an account that has access to this event, then try again.`
        : error instanceof Error ? error.message : $localize`Your itinerary could not be loaded.`);
    } finally {
      this.loading.set(false);
    }
  }
}
