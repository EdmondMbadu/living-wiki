import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../auth.service';
import { TeamMemberAvatarComponent } from './team-member-avatar';
import { profileIconByCode, profileIconForSeed } from '../profile/profile-icons';

describe('Team member profile pictures', () => {
  const profile = signal<any>(null);
  beforeEach(async () => {
    profile.set(null);
    await TestBed.configureTestingModule({
      imports: [TeamMemberAvatarComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: AuthService, useValue: { uid: () => 'me', profile } },
      ],
    }).compileComponents();
  });
  function render(uid = 'another-member') {
    const fixture = TestBed.createComponent(TeamMemberAvatarComponent);
    fixture.componentRef.setInput('member', {
      uid,
      name: 'Agent',
      photoUrl: '/profile-before.jpg',
    });
    fixture.detectChanges();
    return fixture;
  }
  it('uses the current signed-in profile photo rather than a stale join snapshot', () => {
    profile.set({ profilePictureType: 'image', photoURL: '/profile-now.jpg' });
    const fixture = render('me');
    expect(fixture.nativeElement.querySelector('img').getAttribute('src')).toBe('/profile-now.jpg');
    profile.set({ profilePictureType: 'image', photoURL: '/profile-new.jpg' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('img').getAttribute('src')).toBe('/profile-new.jpg');
  });
  it('uses teammates’ returned pictures without substituting the signed-in user', () => {
    profile.set({ profilePictureType: 'image', photoURL: '/mine.jpg' });
    const fixture = render();
    expect(fixture.nativeElement.querySelector('img').getAttribute('src')).toBe(
      '/profile-before.jpg',
    );
  });
  it('honors icon changes and removal instead of resurrecting an old photo or icon', () => {
    profile.set({ profilePictureType: 'icon', profileIcon: 'city-scribe' });
    const fixture = render('me');
    expect(fixture.nativeElement.querySelector('img')).toBeNull();
    expect(fixture.componentInstance.icon()).toEqual(profileIconByCode('city-scribe')!);
    profile.set({ profilePictureType: null, profileIcon: null, photoURL: null });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('img')).toBeNull();
    expect(fixture.componentInstance.icon()).toEqual(profileIconForSeed('me'));
  });
  it('falls back cleanly for a broken image and tries again when the photo changes', () => {
    const fixture = render();
    fixture.nativeElement.querySelector('img').dispatchEvent(new Event('error'));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('img')).toBeNull();
    expect(fixture.nativeElement.querySelector('[role=img]').getAttribute('aria-label')).toBe(
      'Agent profile picture',
    );
    fixture.componentRef.setInput('member', {
      uid: 'another-member',
      name: 'Agent',
      photoUrl: '/fixed.jpg',
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('img').getAttribute('src')).toBe('/fixed.jpg');
  });
});
