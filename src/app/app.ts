import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SpotifyPlayerComponent } from './spotify-player/spotify-player';
import { ThemeService } from './theme.service';
import { WorkspaceNavigationOverlayComponent } from './workspace-navigation/workspace-navigation-overlay';
import { InvitationAlertComponent } from './notifications/invitation-alert';
import { KiwiComponent } from './kiwi/kiwi';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, SpotifyPlayerComponent, WorkspaceNavigationOverlayComponent, InvitationAlertComponent, KiwiComponent],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  protected readonly title = $localize`LivingWiki`;
  protected routeActive = false;
  private readonly themeService = inject(ThemeService);
}
