import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { AuthService } from '../auth.service';
import { AtlasService } from '../atlas.service';
import { TeamsService } from '../teams/teams.service';
import { teamsServiceStub } from '../teams/teams.testing';
import type { TeamInvitation, TeamNotification } from '../teams/team.models';
import { AccountMenuComponent } from '../account-menu/account-menu';
import { InvitationAlertComponent } from './invitation-alert';
import { NotificationsComponent } from './notifications';

const invite: TeamInvitation = {
  id: 'invite-one',
  teamId: 'team-one',
  teamName: 'Marchese Real Estate',
  email: 'agent@example.com',
  role: 'member',
  status: 'pending',
  expiresAt: '2099-09-20T00:00:00Z',
  sentAt: '2026-09-13T16:00:00Z',
  delivery: 'submitted',
  inviterName: 'Julia Marchese',
};
const update: TeamNotification = {
  id: 'update-one',
  teamId: 'team-one',
  message: 'Alex Chen joined Marchese Real Estate.',
  target: '',
  read: false,
  createdAt: '2026-09-13T15:00:00Z',
  type: 'team_update',
};

async function setup() {
  const teams = teamsServiceStub();
  const auth = {
    uid: signal('agent'),
    isAuthenticated: signal(true),
    isAdmin: signal(false),
    emailVerified: signal(true),
    profile: signal(null),
    displayName: signal('Morgan Reed'),
    email: signal('agent@example.com'),
  };
  const params = new BehaviorSubject(convertToParamMap({}));
  await TestBed.configureTestingModule({
    imports: [AccountMenuComponent, InvitationAlertComponent, NotificationsComponent],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      { provide: TeamsService, useValue: teams },
      { provide: AuthService, useValue: auth },
      { provide: AtlasService, useValue: { activeAtlasWikiLink: signal('/wiki') } },
      { provide: ActivatedRoute, useValue: { queryParamMap: params } },
    ],
  }).compileComponents();
  return { teams, auth, params };
}

describe('Shared notifications', () => {
  it('shows an actionable badge before the avatar menu opens, even without team membership', async () => {
    const { teams } = await setup();
    teams.invitations.set([invite]);
    teams.notifications.set([update]);
    const fixture = TestBed.createComponent(AccountMenuComponent);
    fixture.detectChanges();
    const bell = fixture.nativeElement.querySelector('a[href="/notifications"]');
    expect(bell.getAttribute('aria-label')).toContain('2 need your attention');
    expect(fixture.componentInstance.menuOpen()).toBeFalse();
    expect(fixture.nativeElement.querySelector('[role="menu"]')).toBeNull();
    teams.invitations.set([]);
    teams.notifications.set([{ ...update, read: true }]);
    fixture.detectChanges();
    expect(bell.getAttribute('aria-label')).toBe('Notifications');
  });

  it('does not count invitation projections twice or cap attention at fifty', async () => {
    const { teams } = await setup();
    teams.invitations.set([invite]);
    teams.notifications.set([
      ...Array.from({ length: 70 }, (_, i) => ({ ...update, id: String(i) })),
      { ...update, id: 'invite-projection', type: 'team_invitation', invitation: invite },
    ]);
    expect(teams.attentionCount()).toBe(71);
  });

  it('keeps pending invitations separate when marking updates read', async () => {
    const { teams } = await setup();
    teams.invitations.set([invite]);
    teams.notifications.set([update]);
    const mark = spyOn(teams, 'markAllNotificationsRead').and.callFake(async () =>
      teams.notifications.set([{ ...update, read: true }]),
    );
    const fixture = TestBed.createComponent(NotificationsComponent);
    fixture.detectChanges();
    await fixture.componentInstance.markAllRead();
    fixture.detectChanges();
    expect(mark).toHaveBeenCalledTimes(1);
    expect(teams.attentionCount()).toBe(1);
    expect(
      fixture.nativeElement.querySelector('a[href="/teams/invitations?invite=invite-one"]'),
    ).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Needs your response');
  });

  it('never replaces a loading/error state with a misleading caught-up message', async () => {
    const { teams } = await setup();
    teams.notificationsState.set('error');
    teams.invitationsState.set('error');
    const fixture = TestBed.createComponent(NotificationsComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('You’re up to date');
    expect(fixture.nativeElement.textContent).not.toContain('No pending invitations');
  });

  it('dismisses the reminder without resolving an invitation and reappears for a new one', async () => {
    const { teams, auth } = await setup();
    teams.invitations.set([invite]);
    const fixture = TestBed.createComponent(InvitationAlertComponent);
    fixture.detectChanges();
    fixture.componentInstance.dismiss();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('aside')).toBeNull();
    expect(teams.invitations().length).toBe(1);
    teams.invitations.set([invite, { ...invite, id: 'new-invitation' }]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('aside')).not.toBeNull();
    auth.isAuthenticated.set(false);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('aside')).toBeNull();
  });

  it('preserves the reminder for later pages but hides it on invitation review', async () => {
    const { teams } = await setup();
    teams.invitations.set([{ ...invite, id: 'review-invite' }]);
    const fixture = TestBed.createComponent(InvitationAlertComponent);
    fixture.detectChanges();
    fixture.componentInstance.route.set('/teams/invitations?invite=review-invite');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('aside')).toBeNull();
    fixture.componentInstance.route.set('/boards');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('aside')).not.toBeNull();
  });

  it('does not send a removed member to an inaccessible team from an update', async () => {
    const { teams } = await setup();
    const navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    const fixture = TestBed.createComponent(NotificationsComponent);
    await fixture.componentInstance.openUpdate(update);
    expect(navigate).not.toHaveBeenCalled();
    expect(fixture.componentInstance.error()).toContain('no longer have access');
  });

  it('shows operation errors without clearing notifications', async () => {
    const { teams } = await setup();
    teams.notifications.set([update]);
    spyOn(teams, 'markAllNotificationsRead').and.rejectWith(new Error('Offline'));
    const fixture = TestBed.createComponent(NotificationsComponent);
    await fixture.componentInstance.markAllRead();
    expect(fixture.componentInstance.error()).toBeTruthy();
    expect(teams.unreadUpdates().length).toBe(1);
    expect(fixture.componentInstance.busy()).toBeFalse();
  });
});

// Optional isolated visual fixture. No production account, email, or Firestore writes.
afterAll(async () => {
  if (!new URLSearchParams(location.search).has('notifications-preview')) return;
  const styles = document.createElement('style');
  styles.textContent = '.jasmine_html-reporter { display:none !important; }';
  document.head.append(styles);
  const icons = document.createElement('link');
  icons.rel = 'stylesheet';
  icons.href =
    'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap';
  document.head.append(icons);
  TestBed.resetTestingModule();
  const { teams } = await setup();
  teams.invitations.set([invite]);
  teams.notifications.set([
    update,
    { ...update, id: 'second-update', message: 'Your team role was updated to admin.', read: true },
  ]);
  const fixture = TestBed.createComponent(NotificationsComponent);
  fixture.detectChanges();
});
