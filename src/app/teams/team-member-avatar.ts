import { Component, computed, inject, input, signal } from '@angular/core';
import { AuthService } from '../auth.service';
import { profileIconByCode, profileIconForSeed } from '../profile/profile-icons';
import type { TeamMember } from './team.models';

@Component({
  selector: 'app-team-member-avatar',
  template: `
    @if (photoUrl() && failedUrl() !== photoUrl()) {
      <img
        [src]="photoUrl()"
        [alt]="member().name + ' profile picture'"
        (error)="failedUrl.set(photoUrl())"
      />
    } @else {
      <span
        class="profile-icon"
        role="img"
        [attr.aria-label]="member().name + ' profile picture'"
        [style.background]="'linear-gradient(135deg, ' + icon().from + ', ' + icon().to + ')'"
      >
        <span class="material-symbols-outlined" [style.color]="icon().ink">{{ icon().icon }}</span>
      </span>
    }
  `,
  styles: `
    :host,
    img,
    .profile-icon {
      display: flex;
      width: 100%;
      height: 100%;
      border-radius: inherit;
    }
    img {
      object-fit: cover;
    }
    .profile-icon {
      align-items: center;
      justify-content: center;
    }
    .material-symbols-outlined {
      font-size: 1.3em;
    }
  `,
})
export class TeamMemberAvatarComponent {
  private readonly auth = inject(AuthService);
  readonly member =
    input.required<
      Pick<TeamMember, 'uid' | 'name' | 'photoUrl' | 'profileIcon' | 'profilePictureType'>
    >();
  readonly failedUrl = signal('');
  private readonly ownProfile = computed(() =>
    this.auth.uid() === this.member().uid ? this.auth.profile() : null,
  );
  readonly photoUrl = computed(() => {
    const profile = this.ownProfile();
    if (profile) return profile.profilePictureType === 'image' ? profile.photoURL || '' : '';
    return this.member().profilePictureType === 'icon' ? '' : this.member().photoUrl;
  });
  readonly icon = computed(() => {
    const profile = this.ownProfile();
    return (
      profileIconByCode(profile ? profile.profileIcon : this.member().profileIcon) ??
      profileIconForSeed(this.member().uid)
    );
  });
}
