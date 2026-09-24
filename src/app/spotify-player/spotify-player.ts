import { Component, computed, inject, signal } from '@angular/core';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import { spotifyTrackEmbedUrl, spotifyTrackIdFromTrack } from '../spotify-embed';
import { SpotifyPlaybackService } from '../spotify-playback.service';

@Component({
  selector: 'app-spotify-player',
  templateUrl: './spotify-player.html',
  styleUrl: './spotify-player.css',
})
export class SpotifyPlayerComponent {
  readonly templateText = {
    message1: $localize`Opening Spotify…`,
    message2: $localize`Approve playlist access`,
    message3: $localize`Connect Spotify`,
    message4: $localize`Spotify listener`,
    message5: $localize`Preparing player…`,
    message6: $localize`Play complete board`,
    message7: $localize` artwork`,
    message8: $localize`Expand official Spotify player`,
    message9: $localize`Minimize official Spotify player`,
  };
  readonly spotify = inject(SpotifyPlaybackService);
  private readonly sanitizer = inject(DomSanitizer);
  readonly officialCompact = signal(false);
  readonly officialEmbedUrl = computed<SafeResourceUrl | null>(() => {
    const track = this.spotify.embeddedTrack();
    const trackId = track ? spotifyTrackIdFromTrack(track) : '';
    const embedUrl = spotifyTrackEmbedUrl(trackId);
    return embedUrl ? this.sanitizer.bypassSecurityTrustResourceUrl(embedUrl) : null;
  });
}
