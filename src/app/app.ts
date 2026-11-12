import { isPrivateLinkPath } from './analytics-report-route';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { Router, NavigationEnd } from '@angular/router';
import { DOCUMENT } from '@angular/common';
import { applyDocumentLocale } from './i18n/locales';
import { Component, inject, LOCALE_ID } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SpotifyPlayerComponent } from './spotify-player/spotify-player';
import { ThemeService } from './theme.service';
import { WorkspaceNavigationOverlayComponent } from './workspace-navigation/workspace-navigation-overlay';
import { InvitationAlertComponent } from './notifications/invitation-alert';
import { KiwiComponent } from './kiwi/kiwi';
import { GuestTermsDialogComponent } from './guest-terms/guest-terms-dialog';
import { GuestTermsService } from './guest-terms/guest-terms.service';
import { TalkThruPlanDialogComponent } from './talkthru-billing/talkthru-plan-dialog';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, SpotifyPlayerComponent, WorkspaceNavigationOverlayComponent, InvitationAlertComponent, KiwiComponent, TalkThruPlanDialogComponent, GuestTermsDialogComponent],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  readonly guestTerms = inject(GuestTermsService);
  private readonly router=inject(Router);
  readonly privateLink = toSignal(this.router.events.pipe(
    filter((event): event is NavigationEnd => event instanceof NavigationEnd),
    map(event => isPrivateLinkPath(event.urlAfterRedirects)),
  ), { initialValue: typeof window !== 'undefined' && isPrivateLinkPath(window.location.pathname) });
  constructor() { applyDocumentLocale(inject(DOCUMENT), inject(LOCALE_ID)); }

  protected readonly title = $localize`LivingWiki`;
  protected routeActive = false;
  private readonly themeService = inject(ThemeService);
}
