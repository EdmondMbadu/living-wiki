import { DOCUMENT } from '@angular/common';
import { applyDocumentLocale } from './i18n/locales';
import { Component, inject, LOCALE_ID } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SpotifyPlayerComponent } from './spotify-player/spotify-player';
import { ThemeService } from './theme.service';
import { WorkspaceNavigationOverlayComponent } from './workspace-navigation/workspace-navigation-overlay';
import { InvitationAlertComponent } from './notifications/invitation-alert';
import { KiwiComponent } from './kiwi/kiwi';
import { TalkThruPlanDialogComponent } from './talkthru-billing/talkthru-plan-dialog';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, SpotifyPlayerComponent, WorkspaceNavigationOverlayComponent, InvitationAlertComponent, KiwiComponent, TalkThruPlanDialogComponent],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  constructor() { applyDocumentLocale(inject(DOCUMENT), inject(LOCALE_ID)); }

  protected readonly title = $localize`LivingWiki`;
  protected routeActive = false;
  private readonly themeService = inject(ThemeService);
}
