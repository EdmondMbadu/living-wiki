import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { AuthService } from '../auth.service';
import { AtlasService } from '../atlas.service';
import { PersonalVoiceService } from '../personal-voice.service';
import { TeamsComponent } from './teams';
import { TeamsService } from './teams.service';
import { teamsServiceStub } from './teams.testing';
import type { TeamDashboard, TeamListing } from './team.models';

function dashboardFixture(): TeamDashboard {
  const members = Array.from({ length: 30 }, (_, index) => ({
    uid: index ? `member-${index}` : 'owner',
    name: index ? `Agent ${index}` : 'Team Owner',
    photoUrl: '',
    title: 'Real estate advisor',
    bio: '',
    contactEmail: '',
    contactPhone: '',
    publicVisible: false,
    role: index ? ('member' as const) : ('admin' as const),
    joinedAt: '2026-09-01T00:00:00Z',
    voice: null,
  }));
  const listings: TeamListing[] = Array.from({ length: 31 }, (_, index) => ({
    id: `listing-${index}`,
    title: `Home ${index}`,
    description: 'Real estate TalkThru',
    imageUrl: '',
    status: index % 2 ? 'published' : 'draft',
    representativeId: `member-${(index % 29) + 1}`,
    creatorId: 'owner',
    revision: 1,
    publishedRevision: index % 2 ? 1 : 0,
    hasUnpublishedChanges: false,
    voiceOwnerId: '',
    voiceId: '',
    voiceRevision: 0,
    voiceName: 'System voice',
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: `2026-09-${String((index % 12) + 1).padStart(2, '0')}T00:00:00Z`,
    lastEditorId: 'owner',
    cardCount: 8,
    videoUrl: '',
    videoUpdatedAt: '',
  }));
  return {
    team: {
      id: 'team-a',
      name: 'Marchese Real Estate',
      slug: 'marchese',
      description: 'Local expertise. Exceptional homes.',
      about: 'Our team helps you feel at home.',
      logo_url: '',
      hero_url: '',
      hero_position: 50,
      accent: '#216b4c',
      website: '',
      contact_email: '',
      contact_phone: '',
      owner_id: 'owner',
      created_by: 'owner',
      public_enabled: false,
      member_count: 30,
      listing_count: 31,
      status: 'active',
      revision: 1,
      tracking_since: '2026-09-01T00:00:00Z',
    },
    role: 'admin',
    members,
    listings,
    invitations: [],
    activity: [],
  };
}

describe('TeamsComponent', () => {
  // Optional read-only visual fixture, served only by Karma's local debug page.
  // Open /debug.html?team-preview=1 after running this spec in watch mode.
  let preview: HTMLElement | null = null;
  let previewStyles: HTMLElement[] = [];
  afterAll(() => {
    if (preview) {
      document.body.replaceChildren(preview);
      document.head.append(...previewStyles);
      document.body.style.margin = '0';
      for (const href of [
        'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap',
        'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap',
      ]) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        document.head.append(link);
      }
    }
  });
  let fixture: ComponentFixture<TeamsComponent>;
  let data: TeamDashboard;
  let teams: ReturnType<typeof teamsServiceStub> & Record<string, any>;
  let route: any;
  const uid = signal('owner');
  const authenticated = signal(true);

  beforeEach(async () => {
    uid.set('owner');
    authenticated.set(true);
    data = dashboardFixture();
    const params = new BehaviorSubject(convertToParamMap({ teamId: 'team-a' }));
    const query = new BehaviorSubject(convertToParamMap({}));
    route = {
      paramMap: params,
      queryParamMap: query,
      snapshot: {
        paramMap: params.value,
        queryParamMap: query.value,
        routeConfig: { path: 'teams/:teamId' },
      },
    };
    teams = {
      ...teamsServiceStub(),
      dashboard: jasmine.createSpy('dashboard').and.callFake(async () => structuredClone(data)),
      command: jasmine.createSpy('command').and.resolveTo({ ok: true }),
      watchTeam: () => () => {},
      report: jasmine.createSpy('report').and.resolveTo({
        totals: {
          views: 0,
          participants: 0,
          chats: 0,
          messages: 0,
          contacts: 0,
          voiceSeconds: null,
        },
        listings: {},
        trackingSince: data.team.tracking_since,
        days: 30,
      }),
      publicPage: jasmine.createSpy('publicPage').and.resolveTo({
        page: {
          id: 'team-a',
          name: 'Public team',
          slug: 'public-team',
          description: '',
          about: '',
          logoUrl: '',
          heroUrl: '',
          heroPosition: 50,
          accent: '#216b4c',
          website: '',
          contactEmail: '',
          contactPhone: '',
          members: [],
        },
        listings: [],
      }),
    };
    teams.memberships.set([
      {
        teamId: 'team-a',
        name: data.team.name,
        logoUrl: '',
        slug: 'marchese',
        role: 'admin',
        status: 'active',
        creatorId: 'owner',
        ownerId: 'owner',
      },
    ]);
    await TestBed.configureTestingModule({
      imports: [TeamsComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: route },
        { provide: TeamsService, useValue: teams },
        { provide: PersonalVoiceService, useValue: { loadLibrary: async () => ({ voices: [] }) } },
        { provide: AtlasService, useValue: { activeAtlasWikiLink: signal('/wiki') } },
        {
          provide: AuthService,
          useValue: {
            uid,
            isAuthenticated: authenticated,
            isAdmin: signal(false),
            profile: signal(null),
            displayName: signal('Team Owner'),
            email: signal('owner@example.com'),
            emailVerified: signal(true),
            waitForReady: async () => {},
            signOut: async () => {},
          },
        },
      ],
    }).compileComponents();
  });
  async function render() {
    fixture = TestBed.createComponent(TeamsComponent);
    fixture.detectChanges();
    await fixture.componentInstance.reload();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  it('renders the branded 30-person management workspace inside the existing sidebar', async () => {
    const page = await render();
    const host = fixture.nativeElement as HTMLElement;
    if (location.search.includes('team-preview=1')) {
      preview = host.cloneNode(true) as HTMLElement;
      previewStyles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]')).map(
        (style) => style.cloneNode(true) as HTMLElement,
      );
      const controls = host.querySelectorAll<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >('input, select, textarea');
      preview
        .querySelectorAll<
          HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
        >('input, select, textarea')
        .forEach((control, index) => (control.value = controls[index].value));
    }
    expect(host.querySelector('app-workspace-sidebar')).not.toBeNull();
    expect(host.textContent).toContain('Marchese Real Estate');
    expect(host.textContent).toContain('30 members');
    expect(host.textContent).toContain('New TalkThru');
    expect(host.textContent).toContain('Invite members');
    expect(host.querySelector('[aria-label="Team settings"]')).not.toBeNull();
    expect(page.pageRows().length).toBe(10);
    expect(host.textContent).toContain('Verified duration not yet available');
    page.setTab('members');
    fixture.detectChanges();
    expect(host.querySelectorAll('.member-card').length).toBe(30);
  });
  it('searches and filters the entire collection before pagination', async () => {
    const page = await render();
    page.search.set('Home 30');
    fixture.detectChanges();
    expect(page.filtered().map((listing) => listing.id)).toEqual(['listing-30']);
    expect(page.pageRows().length).toBe(1);
    expect(page.pageCount()).toBe(1);
    page.search.set('');
    page.representative.set('member-2');
    page.status.set('published');
    fixture.detectChanges();
    expect(
      page
        .filtered()
        .every(
          (listing) => listing.representativeId === 'member-2' && listing.status === 'published',
        ),
    ).toBeTrue();
  });
  it('keeps member collaboration visible without exposing admin controls', async () => {
    data.role = 'member';
    uid.set('member-1');
    const page = await render();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain('New TalkThru');
    expect(host.textContent).not.toContain('Invite members');
    expect(host.querySelector('[aria-label="Team settings"]')).toBeNull();
    expect(page.mayPublish(data.listings[0])).toBeTrue();
    expect(page.mayPublish(data.listings[1])).toBeFalse();
    page.showModal('listing', data.listings[1]);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(host.textContent).toContain('Open working listing');
    expect(host.textContent).not.toContain('Private contacts');
  });
  it('public pages use only the public projection and do not load the workspace or analytics', async () => {
    authenticated.set(false);
    uid.set('');
    route.snapshot.routeConfig.path = 'team/:slug';
    route.snapshot.paramMap = convertToParamMap({ slug: 'public-team' });
    await render();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain('Public team');
    expect(teams['dashboard']).not.toHaveBeenCalled();
    expect(teams['report']).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain('VR chat minutes');
    expect(host.textContent).not.toContain('Invite members');
    expect(host.querySelector('app-workspace-sidebar')).toBeNull();
  });
  it('shows the creation allowance without presenting a second-team form', async () => {
    teams.canCreate.set(false);
    route.snapshot.routeConfig.path = 'teams/new';
    route.snapshot.paramMap = convertToParamMap({});
    await render();
    expect(fixture.nativeElement.textContent).toContain('already has a created team');
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
  });
  it('shows a retryable invitation failure, then the confirmed empty inbox after retry', async () => {
    route.snapshot.routeConfig.path = 'teams/invitations';
    route.snapshot.paramMap = convertToParamMap({});
    teams.invitationsState.set('error');
    await render();
    expect(fixture.nativeElement.textContent).toContain('We couldn’t load your invitations');
    expect(fixture.nativeElement.textContent).not.toContain('You’re all caught up');
    const refresh = spyOn(teams, 'refreshAccount').and.callFake(async () => {
      teams.invitationsState.set('ready');
    });
    const retry = Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
    ).find((button) => button.textContent?.trim() === 'Try again');
    retry!.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(refresh).toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('You’re all caught up');
    expect(fixture.nativeElement.querySelector('a[href="/teams/new"]')).not.toBeNull();
  });
  it('does not report an empty inbox while invitations are still loading', async () => {
    route.snapshot.routeConfig.path = 'teams/invitations';
    route.snapshot.paramMap = convertToParamMap({});
    teams.invitationsState.set('loading');
    await render();
    expect(fixture.nativeElement.textContent).toContain('Checking your invitations');
    expect(fixture.nativeElement.textContent).not.toContain('You’re all caught up');
  });
  it('explains an unavailable creation check without claiming the user hit their limit', async () => {
    route.snapshot.routeConfig.path = 'teams/new';
    route.snapshot.paramMap = convertToParamMap({});
    teams.canCreate.set(null);
    teams.allowanceState.set('error');
    await render();
    expect(fixture.nativeElement.textContent).toContain(
      'We couldn’t check team creation availability',
    );
    expect(fixture.nativeElement.textContent).not.toContain('already has a created team');
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
  });
  it('preserves settings and the accessible modal when the server reports a conflict', async () => {
    const page = await render();
    page.showModal('settings');
    page.settingsForm.description = 'Unsaved work';
    fixture.detectChanges();
    await fixture.whenStable();
    const dialog = fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;
    expect(dialog.open).toBeTrue();
    expect(dialog.getAttribute('aria-labelledby')).toBe('team-dialog-title');
    teams['command'].and.rejectWith(new Error('Team settings changed. Reload before saving.'));
    await page.run('update', {}, 'Saved');
    fixture.detectChanges();
    expect(page.modal()).toBe('settings');
    expect(page.settingsForm.description).toBe('Unsaved work');
    expect(page.modalError()).toContain('Reload');
    expect(page.busy()).toBeFalse();
    page.closeModal();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('dialog')).toBeNull();
  });
});
