import { Component, input, output, provideZonelessChangeDetection, signal } from '@angular/core';
import { DeferBlockState, TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { By } from '@angular/platform-browser';
import { BehaviorSubject } from 'rxjs';
import { AuthService } from '../auth.service';
import { AtlasService } from '../atlas.service';
import { PersonalVoiceService } from '../personal-voice.service';
import { TeamsComponent } from './teams';
import { TeamsService } from './teams.service';
import { teamsServiceStub } from './teams.testing';
import { BoardsComponent } from '../boards/boards';
import { publicBoardQrUrl } from '../board-qr-code';
import type { TeamDashboard, TeamListing, TeamReport } from './team.models';

function reportFixture(days = 30): TeamReport {
  return {
    days,
    trackingSince: '2026-09-01T00:00:00Z',
    totals: { views: 8, participants: 3, chats: 2, messages: 5, contacts: 1, voiceSeconds: 90 },
    listings: {
      'listing-0': {
        views: 8,
        participants: 3,
        chats: 2,
        messages: 5,
        contacts: 1,
        voiceSeconds: 90,
      },
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

@Component({
  selector: 'app-boards',
  template: '<input type="url" aria-label="Property listing URL" />',
})
class TeamWizardStub {
  teamWizardOnly = input(false);
  teamWizardReady = output<void>();
  teamWizardDismissed = output<void>();
  teamWizardLaunchError = output<string>();
}

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
  // Router tests can replace the URL before afterAll runs.
  const qrPreview = location.search.includes('team-qr-preview=1');
  // Optional read-only visual fixture, served only by Karma's local debug page.
  // Open /debug.html?team-preview=1 after running this spec in watch mode.
  let preview: HTMLElement | null = null;
  let previewStyles: HTMLElement[] = [];
  afterAll(async () => {
    if (
      location.search.includes('team-settings-preview=1') ||
      location.search.includes('team-preview=1') || qrPreview
    ) {
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
    // An interactive, isolated fixture for checking the native OS file picker.
    if (location.search.includes('team-settings-preview=1')) {
      TestBed.resetTestingModule();
      await configureFixture();
      const page = await render();
      page.showModal('settings');
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.nativeElement.setAttribute('data-team-settings-preview-ready', 'true');
      return;
    }
    if (preview) {
      preview.setAttribute('data-team-preview-ready', 'true');
      document.body.replaceChildren(preview);
      document.head.append(...previewStyles);
      document.body.style.margin = '0';
      if (qrPreview) {
        const dialog = preview.querySelector('dialog');
        dialog?.removeAttribute('open');
        dialog?.showModal();
      }
    }
  });
  let fixture: ComponentFixture<TeamsComponent>;
  let data: TeamDashboard;
  let teams: ReturnType<typeof teamsServiceStub> &
    Record<string, any> & {
      report: jasmine.Spy;
      command: jasmine.Spy;
      uploadBranding: jasmine.Spy;
    };
  let route: any;
  const uid = signal('owner');
  const authenticated = signal(true);

  async function configureFixture() {
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
      uploadBranding: jasmine
        .createSpy('uploadBranding')
        .and.resolveTo('https://example.com/cover.jpg'),
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
    TestBed.overrideComponent(TeamsComponent, {
      remove: { imports: [BoardsComponent] },
      add: { imports: [TeamWizardStub] },
    });
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
  }
  beforeEach(configureFixture);
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
        .querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
          'input, select, textarea',
        )
        .forEach((control, index) => (control.value = controls[index].value));
    }
    expect(host.querySelector('app-workspace-sidebar')).not.toBeNull();
    expect(host.textContent).toContain('Marchese Real Estate');
    expect(host.textContent).toContain('30 members');
    expect(host.textContent).toContain('New TalkThru');
    expect(host.textContent).toContain('Invite members');
    expect(host.querySelector('[aria-label="Team settings"]')).not.toBeNull();
    expect(page.pageRows().length).toBe(10);
    expect(host.textContent).toContain('Not tracked yet');
    page.setTab('members');
    fixture.detectChanges();
    expect(host.querySelectorAll('.member-card').length).toBe(30);
  });
  it('counts a new private draft as one total listing, not one published listing', async () => {
    data.listings = [data.listings[0]];
    // The loaded listing collection is authoritative, not a stale cached team counter.
    data.team.listing_count = 99;
    const page = await render();
    const card = fixture.nativeElement.querySelector('.kpi-strip article');
    expect(card.querySelector('strong').textContent).toBe('1');
    expect(card.textContent).toContain('0 published · 1 draft');
    expect(page.publishedCount()).toBe(0);
    expect(fixture.nativeElement.textContent).toContain('No listings are public yet');
    expect(teams.command).not.toHaveBeenCalled();
  });
  it('opens and closes New TalkThru over the same team without navigating to personal boards', async () => {
    const page = await render();
    const router = TestBed.inject(Router);
    const navigate = spyOn(router, 'navigate');
    const navigateByUrl = spyOn(router, 'navigateByUrl');
    const host = fixture.nativeElement as HTMLElement;
    const button = Array.from(host.querySelectorAll('button')).find((node) =>
      node.textContent?.includes('New TalkThru'),
    )!;
    expect(button).toBeDefined();
    expect(host.querySelector('.setup-strip')).toBeNull();
    button.click();
    fixture.detectChanges();
    expect(page.listingWizardOpen()).toBeTrue();
    expect(host.querySelector('.team-workspace')!.hasAttribute('inert')).toBeTrue();
    expect(host.querySelector('.listing-table')).not.toBeNull();
    const [block] = await fixture.getDeferBlocks();
    await block.render(DeferBlockState.Complete);
    fixture.detectChanges();
    const child = fixture.debugElement.query(By.directive(TeamWizardStub))
      .componentInstance as TeamWizardStub;
    // The deferred host receives an explicit modal-only mode, not a gallery route.
    const builder = host.querySelector('app-boards');
    expect(builder).not.toBeNull();
    expect(child.teamWizardOnly()).toBeTrue();
    child.teamWizardReady.emit();
    fixture.detectChanges();
    expect(host.querySelector('.team-wizard-loading')).toBeNull();
    child.teamWizardDismissed.emit();
    fixture.detectChanges();
    expect(host.querySelector('app-boards')).toBeNull();
    expect(host.querySelector('.team-workspace')!.hasAttribute('inert')).toBeFalse();
    page.openListingWizard();
    fixture.detectChanges();
    expect(page.listingWizardReady()).toBeFalse();
    expect(host.querySelector('app-boards')).not.toBeNull();
    expect(page.teamId()).toBe('team-a');
    expect(navigate).not.toHaveBeenCalled();
    expect(navigateByUrl).not.toHaveBeenCalled();
  });
  it('supports the direct team creation link and does not open the wizard for an archived team', async () => {
    route.snapshot.routeConfig.path = 'teams/:teamId/create-listing';
    const page = await render();
    expect(page.mode()).toBe('workspace');
    expect(page.listingWizardOpen()).toBeTrue();
    data.team.status = 'archived';
    await page.reload();
    expect(page.listingWizardOpen()).toBeFalse();
    page.openListingWizard();
    expect(page.listingWizardOpen()).toBeFalse();
  });
  it('keeps team-wide status counts independent of filters, pagination, and analytics dates', async () => {
    data.listings[2].status = 'unpublished';
    data.listings[4].status = 'archived';
    const page = await render();
    page.search.set('Home 30');
    page.page.set(3);
    page.days.set(7);
    fixture.detectChanges();
    expect(page.listingStatusSummary()).toBe(
      '15 published · 14 drafts · 1 unpublished · 1 archived',
    );
    expect(fixture.nativeElement.querySelector('.kpi-strip strong').textContent).toBe('31');
  });
  it('renders the actual report totals and per-listing counts, with verified seconds converted to minutes', async () => {
    teams.report.and.resolveTo(reportFixture());
    const page = await render();
    page.metricsExpanded.set(true);
    fixture.detectChanges();
    expect(
      Array.from(fixture.nativeElement.querySelectorAll('.kpi-strip strong')).map((node: any) =>
        node.textContent.trim(),
      ),
    ).toEqual(['31', '8', '1.5', '1']);
    expect(
      Array.from(fixture.nativeElement.querySelectorAll('.extended-metrics strong')).map(
        (node: any) => node.textContent.trim(),
      ),
    ).toEqual(['3', '2', '5']);
    page.search.set('Home 0');
    fixture.detectChanges();
    expect(
      Array.from(fixture.nativeElement.querySelectorAll('td.metric-cell')).map((node: any) =>
        node.textContent.trim(),
      ),
    ).toEqual(['8', '1.5 min', '1']);
    expect(fixture.nativeElement.textContent).toContain('Checked');
  });
  it('distinguishes pending, failed, and confirmed zero analytics and supports retry', async () => {
    const page = await render();
    const pending = deferred<TeamReport>();
    teams.report.and.returnValue(pending.promise);
    const request = page.loadMetrics();
    fixture.detectChanges();
    expect(page.reportLoading()).toBeTrue();
    expect(fixture.nativeElement.querySelectorAll('.kpi-strip strong')[1].textContent).toBe('—');
    expect(fixture.nativeElement.textContent).toContain('Loading activity');
    pending.reject(new Error('Offline'));
    await request;
    fixture.detectChanges();
    expect(page.report()).toBeNull();
    expect(page.reportCheckedAt()).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Retry analytics');
    expect(fixture.nativeElement.textContent).toContain('Activity unavailable');
    const empty = reportFixture();
    empty.totals = {
      views: 0,
      participants: 0,
      chats: 0,
      messages: 0,
      contacts: 0,
      voiceSeconds: null,
    };
    empty.listings = {};
    teams.report.and.resolveTo(empty);
    await page.loadMetrics();
    fixture.detectChanges();
    expect(page.reportLoading()).toBeFalse();
    expect(page.reportError()).toBe('');
    expect(fixture.nativeElement.querySelectorAll('.kpi-strip strong')[1].textContent).toBe('0');
    expect(fixture.nativeElement.querySelectorAll('.kpi-strip strong')[2].textContent).toBe('—');
  });
  it('rejects incomplete analytics rather than substituting invented zero counts', async () => {
    const page = await render();
    teams.report.and.resolveTo({ ...reportFixture(), totals: { views: 0 } });
    await page.loadMetrics();
    expect(page.report()).toBeNull();
    expect(page.reportError()).toContain('unavailable');
  });
  it('ignores an older report or failure even when the same date range is requested again', async () => {
    const page = await render();
    const old = deferred<TeamReport>();
    teams.report.and.returnValue(old.promise);
    const first = page.loadMetrics();
    teams.report.and.resolveTo(reportFixture());
    await page.loadMetrics();
    old.reject(new Error('Late failure'));
    await first;
    expect(page.report()?.totals.views).toBe(8);
    expect(page.reportError()).toBe('');
    const stale = deferred<TeamReport>();
    teams.report.and.returnValue(stale.promise);
    const second = page.loadMetrics();
    teams.report.and.resolveTo(reportFixture());
    await page.loadMetrics();
    stale.resolve({ ...reportFixture(), totals: { ...reportFixture().totals, views: 999 } });
    await second;
    expect(page.report()?.totals.views).toBe(8);
  });
  it('reloads analytics alongside listing changes and when returning to the window', async () => {
    const page = await render();
    data.listings = [data.listings[0]];
    data.listings[0].status = 'published';
    teams.report.calls.reset();
    teams.report.and.resolveTo(reportFixture());
    await page.refresh();
    expect(page.publishedCount()).toBe(1);
    expect(page.report()?.totals.views).toBe(8);
    expect(teams.report).toHaveBeenCalledOnceWith('team-a', 30);
    spyOnProperty(document, 'hidden', 'get').and.returnValue(false);
    page.refreshMetricsOnFocus();
    await fixture.whenStable();
    expect(teams.report.calls.count()).toBe(2);
  });
  it('does not apply a report after leaving the workspace or losing access', async () => {
    const page = await render();
    const pending = deferred<TeamReport>();
    teams.report.and.returnValue(pending.promise);
    const request = page.loadMetrics();
    page.dashboard.set(null);
    pending.resolve(reportFixture());
    await request;
    expect(page.report()).toBeNull();
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
  it('automatically renders the same QR as the public board without a canvas', async () => {
    const page = await render();
    const listing = data.listings[1];
    const canvas = spyOn(HTMLCanvasElement.prototype, 'getContext').and.throwError('Canvas unavailable');
    page.showModal('qr', listing);
    fixture.detectChanges();
    await fixture.whenStable();

    const dialog = fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;
    const image = dialog.querySelector('.qr-preview') as HTMLImageElement;
    const download = dialog.querySelector('a[download]') as HTMLAnchorElement;
    expect(page.modalError()).toBe('');
    expect(image).not.toBeNull();
    expect(image.src).toMatch(/^data:image\/svg\+xml/);
    expect(image.src).toBe(BoardsComponent.prototype.stackQrImageUrl({
      ...listing, visibility: 'public',
    } as any));
    expect(image.src).toBe(BoardsComponent.prototype.stackQrImageUrl({
      ...listing, visibility: 'private', teamId: 'team-a', teamDraft: true,
    } as any));
    expect(download.href).toBe(image.src);
    expect(download.download).toBe(`${listing.id}-qr.svg`);
    expect(dialog.querySelector('a[target="_blank"]')?.getAttribute('href')).toBe(publicBoardQrUrl(listing.id));
    expect(dialog.textContent).not.toContain('Preparing QR code');
    expect(canvas).not.toHaveBeenCalled();

    await image.decode();
    expect(image.naturalWidth).toBeGreaterThan(0);
    expect(image.naturalHeight).toBeGreaterThan(0);

    if (qrPreview) {
      preview = fixture.nativeElement.cloneNode(true) as HTMLElement;
      preview.removeAttribute('id');
      previewStyles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]')).map(
        (style) => style.cloneNode(true) as HTMLElement,
      );
    }

    const original = image.src;
    page.closeModal();
    page.showModal('qr', { ...listing, updatedAt: '2026-09-14T12:00:00Z', revision: 2 });
    expect(page.qrUrl()).toBe(original);
    page.showModal('qr', data.listings[3]);
    expect(page.qrUrl()).not.toBe(original);
  });

  it('copies the public QR destination instead of the local development address', async () => {
    const page = await render();
    const clipboard = spyOn(navigator.clipboard, 'writeText').and.resolveTo();
    await page.copyLink(data.listings[1]);
    expect(clipboard).toHaveBeenCalledOnceWith(
      'https://www.livingwiki.com/boards/listing-1',
    );
  });

  it('keeps sharing links available after a QR failure and lets the user retry', async () => {
    const page = await render();
    const listing = { ...data.listings[1], id: 'x'.repeat(5000) };
    page.showModal('qr', listing);
    fixture.detectChanges();
    await fixture.whenStable();

    const dialog = fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;
    expect(dialog.textContent).toContain('The QR code could not be created');
    expect(dialog.textContent).not.toContain('Preparing QR code');
    expect(dialog.textContent).toContain('Copy link');
    expect(dialog.textContent).toContain('View listing');
    expect(dialog.querySelector('.qr-preview')).toBeNull();
    expect(dialog.querySelector('a[download]')).toBeNull();
    const retry = Array.from(dialog.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Try again',
    );
    expect(retry).toBeDefined();

    listing.id = data.listings[1].id;
    retry!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(page.modalError()).toBe('');
    expect(dialog.querySelector('.qr-preview')).not.toBeNull();
    expect(dialog.textContent).not.toContain('Try again');
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
  it('preserves the invitation link through sign-in, account creation, and email verification', async () => {
    route.snapshot.routeConfig.path = 'teams/invitations';
    route.snapshot.paramMap = convertToParamMap({});
    const destination = '/teams/invitations?invite=chosen&token=secret-token';
    spyOnProperty(TestBed.inject(Router), 'url', 'get').and.returnValue(destination);
    authenticated.set(false);
    await render();
    for (const path of ['/sign-in', '/create-account']) {
      const link = fixture.nativeElement.querySelector(`a[href^="${path}?"]`) as HTMLAnchorElement;
      expect(new URL(link.href).searchParams.get('redirectTo')).toBe(destination);
    }
    authenticated.set(true);
    (TestBed.inject(AuthService).emailVerified as any).set(false);
    fixture.detectChanges();
    const verify = fixture.nativeElement.querySelector(
      'a[href^="/verify-email?"]',
    ) as HTMLAnchorElement;
    expect(new URL(verify.href).searchParams.get('redirectTo')).toBe(destination);
  });
  it('highlights the requested invitation first without accepting from a link', async () => {
    route.snapshot.routeConfig.path = 'teams/invitations';
    route.snapshot.paramMap = convertToParamMap({});
    route.snapshot.queryParamMap = convertToParamMap({ invite: 'chosen' });
    (teams as any).invitationPreview = jasmine
      .createSpy()
      .and.resolveTo({
        teamName: 'Selected team',
        role: 'member',
        expiresAt: '2099-01-01',
        status: 'pending',
        matchesAccount: true,
      });
    const invitation = {
      id: 'other',
      teamId: 'team-b',
      teamName: 'Another team',
      email: 'owner@example.com',
      role: 'member' as const,
      status: 'pending' as const,
      expiresAt: '2099-01-01',
      delivery: 'submitted' as const,
    };
    teams.invitations.set([invitation, { ...invitation, id: 'chosen', teamName: 'Selected team' }]);
    await render();
    const first = fixture.nativeElement.querySelector('.invitation-card');
    expect(first.textContent).toContain('Selected team');
    expect(first.classList.contains('invitation-card--focused')).toBeTrue();
    expect(teams.command).not.toHaveBeenCalled();
  });
  it('switches the signed-in account without losing the exact invitation destination', async () => {
    const page = await render();
    const destination = '/teams/invitations?invite=chosen&token=token';
    const router = TestBed.inject(Router);
    spyOnProperty(router, 'url', 'get').and.returnValue(destination);
    const navigate = spyOn(router, 'navigate').and.resolveTo(true);
    const auth = TestBed.inject(AuthService);
    auth.signOut = jasmine.createSpy('signOut').and.resolveTo();
    await page.switchInvitationAccount();
    expect(auth.signOut).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(['/sign-in'], {
      queryParams: { redirectTo: destination },
    });
    expect(page.busy()).toBeFalse();
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
  it('allows pointer and keyboard access to the cover settings controls', async () => {
    const page = await render();
    const trigger = fixture.nativeElement.querySelector('.hero-edit') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();
    await fixture.whenStable();
    const dialog = fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;
    expect(dialog.matches(':modal')).toBeTrue();
    for (const selector of ['button[aria-label="Close dialog"]', '.image-upload--hero button']) {
      const control = dialog.querySelector(selector) as HTMLElement;
      control.scrollIntoView({ block: 'center' });
      const rect = control.getBoundingClientRect();
      expect(control.matches(':disabled')).toBeFalse();
      expect(
        control.contains(
          document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2),
        ),
      )
        .withContext(`${selector} must receive pointer events`)
        .toBeTrue();
    }
    const name = dialog.querySelector('input[name="name"]') as HTMLInputElement;
    name.focus();
    expect(document.activeElement).toBe(name);
    for (const kind of ['hero', 'logo']) {
      const upload = dialog.querySelector(
        kind === 'hero' ? '.image-upload--hero' : '.image-upload',
      )!;
      const fileInput = upload.querySelector('input')!;
      const picker = spyOn(fileInput, 'showPicker');
      upload.querySelector('button')!.click();
      expect(picker).toHaveBeenCalledTimes(1);
      expect(page.modal()).toBe('settings');
      expect(teams.command).not.toHaveBeenCalled();
    }
    dialog.querySelector<HTMLButtonElement>('[aria-label="Close dialog"]')!.click();
    fixture.detectChanges();
    expect(page.modal()).toBeNull();
  });
  function chooseCover(dialog: HTMLDialogElement) {
    const input = dialog.querySelector('.image-upload--hero input') as HTMLInputElement;
    const selection = new DataTransfer();
    selection.items.add(new File(['test-image'], 'cover.png', { type: 'image/png' }));
    input.files = selection.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    fixture.detectChanges();
    return input;
  }
  it('keeps cover editing available after a cover has been uploaded', async () => {
    data.team.hero_url = '/existing-cover.jpg';
    await render();
    const hero = fixture.nativeElement.querySelector('.team-hero') as HTMLElement;
    expect(parseFloat(getComputedStyle(hero).height)).toBeGreaterThanOrEqual(112);
    expect(hero.querySelector('img')?.getAttribute('src')).toBe('/existing-cover.jpg');
    expect(hero.querySelector('button')?.textContent).toContain('Change cover photo');
  });
  it('reports a blocked picker and falls back when the native picker API is unavailable', async () => {
    const page = await render();
    const input = document.createElement('input');
    input.type = 'file';
    const picker = spyOn(input, 'showPicker').and.callFake(() => {
      throw new DOMException('No user activation', 'NotAllowedError');
    });
    page.chooseBrandingFile(input);
    expect(page.modalError()).toContain('could not open the file picker');
    expect(page.busy()).toBeFalse();
    picker.and.stub();
    page.chooseBrandingFile(input);
    expect(page.modalError()).toBe('');
    Object.defineProperty(input, 'showPicker', { value: undefined, configurable: true });
    const legacyPicker = spyOn(input, 'click');
    page.chooseBrandingFile(input);
    expect(legacyPicker).toHaveBeenCalledTimes(1);
  });
  it('previews an uploaded cover, then persists it only when settings are saved', async () => {
    const page = await render();
    page.showModal('settings');
    fixture.detectChanges();
    await fixture.whenStable();
    const pending = deferred<string>();
    teams.uploadBranding.and.returnValue(pending.promise);
    const dialog = fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;
    const input = chooseCover(dialog);
    expect(page.brandingUpload()).toBe('hero');
    expect(dialog.textContent).toContain('Uploading cover photo');
    expect(teams.uploadBranding).toHaveBeenCalledWith('team-a', 'hero', jasmine.any(File));
    pending.resolve('https://example.com/new-cover.jpg');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(input.value).toBe('');
    expect(page.busy()).toBeFalse();
    expect(page.brandingUpload()).toBeNull();
    expect(dialog.querySelector('.image-upload--hero img')?.getAttribute('src')).toBe(
      'https://example.com/new-cover.jpg',
    );
    expect(dialog.textContent).toContain('Replace cover photo');
    expect(teams.command).not.toHaveBeenCalled();
    page.saveSettings();
    await fixture.whenStable();
    expect(teams.command).toHaveBeenCalledWith(
      'update',
      jasmine.objectContaining({
        teamId: 'team-a',
        heroUrl: 'https://example.com/new-cover.jpg',
      }),
    );
  });
  it('saves only an uploaded cover through the submit button with every text field blank', async () => {
    data.team.description = '';
    data.team.about = '';
    const page = await render();
    page.showModal('settings');
    fixture.detectChanges();
    await fixture.whenStable();
    const dialog = fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;
    const name = dialog.querySelector<HTMLInputElement>('input[name="name"]')!;
    name.value = '';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    chooseCover(dialog);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(dialog.querySelector('[required]')).toBeNull();
    dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    await fixture.whenStable();
    expect(teams.command).toHaveBeenCalledOnceWith('update', {
      teamId: 'team-a',
      revision: 1,
      heroUrl: 'https://example.com/cover.jpg',
    });
    expect(page.modal()).toBeNull();
    expect(page.notice()).toBe('Team settings saved.');
  });
  it('can clear every optional text field and reset the accent without changing other settings', async () => {
    Object.assign(data.team, {
      website: 'https://example.com/',
      contact_email: 'team@example.com',
      contact_phone: '1234',
      accent: '#123456',
      public_enabled: true,
      logo_url: 'https://example.com/logo.png',
    });
    const page = await render();
    page.showModal('settings');
    fixture.detectChanges();
    await fixture.whenStable();
    const dialog = fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;
    for (const key of ['description', 'about', 'website', 'contactEmail', 'contactPhone']) {
      const control = dialog.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        `[name="${key}"]`,
      )!;
      control.value = '';
      control.dispatchEvent(new Event('input', { bubbles: true }));
    }
    dialog.querySelector<HTMLButtonElement>('.accent-setting button')!.click();
    dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    await fixture.whenStable();
    expect(teams.command).toHaveBeenCalledOnceWith('update', {
      teamId: 'team-a',
      revision: 1,
      description: '',
      about: '',
      website: '',
      contactEmail: '',
      contactPhone: '',
      accent: '#216b4c',
    });
    expect(page.modal()).toBeNull();
  });
  it('removes images only on save and restores the originals on cancel', async () => {
    Object.assign(data.team, {
      logo_url: 'https://example.com/logo.png',
      hero_url: 'https://example.com/hero.png',
      hero_position: 75,
    });
    const page = await render();
    for (const cancel of [true, false]) {
      page.showModal('settings');
      fixture.detectChanges();
      await fixture.whenStable();
      const dialog = fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;
      expect(dialog.querySelectorAll('.brand-image-preview img').length).toBe(2);
      dialog
        .querySelectorAll<HTMLButtonElement>('.image-upload .button--danger')
        .forEach((button) => button.click());
      fixture.detectChanges();
      expect(dialog.querySelector('.brand-image-preview img')).toBeNull();
      expect(dialog.querySelector('[name="heroPosition"]')).toBeNull();
      expect(dialog.querySelector('.image-upload .button--danger')).toBeNull();
      expect(teams.command).not.toHaveBeenCalled();
      expect(data.team.hero_url).toBe('https://example.com/hero.png');
      if (cancel) {
        page.closeModal();
        fixture.detectChanges();
      } else {
        dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
        await fixture.whenStable();
      }
    }
    expect(teams.command).toHaveBeenCalledOnceWith('update', {
      teamId: 'team-a',
      revision: 1,
      logoUrl: '',
      heroUrl: '',
      heroPosition: 50,
    });
  });
  it('validates edited optional details without requiring them, and accepts a bare website domain', async () => {
    const page = await render();
    page.showModal('settings');
    page.settingsForm.contactEmail = 'invalid';
    await page.saveSettings();
    expect(page.modalError()).toContain('business email');
    expect(teams.command).not.toHaveBeenCalled();
    page.settingsForm.contactEmail = '';
    page.settingsForm.website = 'javascript:alert(1)';
    await page.saveSettings();
    expect(page.modalError()).toContain('HTTPS');
    expect(teams.command).not.toHaveBeenCalled();
    page.settingsForm.website = 'example.com';
    await page.saveSettings();
    expect(teams.command).toHaveBeenCalledOnceWith('update', {
      teamId: 'team-a',
      revision: 1,
      website: 'https://example.com/',
    });
  });
  it('uses the revision from when settings opened and preserves edits on a conflict', async () => {
    const page = await render();
    page.showModal('settings');
    page.settingsForm.heroUrl = 'https://example.com/new.png';
    data.team.revision = 2;
    await page.refresh();
    teams.command.and.rejectWith(new Error('Team settings changed. Reload before saving.'));
    await page.saveSettings();
    expect(teams.command).toHaveBeenCalledOnceWith('update', {
      teamId: 'team-a',
      revision: 1,
      heroUrl: 'https://example.com/new.png',
    });
    expect(page.modal()).toBe('settings');
    expect(page.settingsForm.heroUrl).toBe('https://example.com/new.png');
    expect(page.modalError()).toContain('Reload');
  });
  it('does not submit or remove branding while an upload or save is in progress', async () => {
    data.team.logo_url = 'https://example.com/logo.png';
    const page = await render();
    page.showModal('settings');
    page.busy.set(true);
    page.removeBranding('logo');
    await page.saveSettings();
    expect(page.settingsForm.logoUrl).toBe(data.team.logo_url);
    expect(teams.command).not.toHaveBeenCalled();
    page.busy.set(false);
  });
  it('lets native checkbox actions reach the settings form without closing the dialog', async () => {
    const page = await render();
    page.showModal('settings');
    fixture.detectChanges();
    await fixture.whenStable();
    const dialog = fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;
    const checkbox = dialog.querySelector<HTMLInputElement>('[name="publicEnabled"]')!;
    checkbox.click();
    expect(checkbox.checked).toBeTrue();
    expect(page.settingsForm.publicEnabled).toBeTrue();
    expect(page.modal()).toBe('settings');
    dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    await fixture.whenStable();
    expect(teams.command).toHaveBeenCalledOnceWith('update', {
      teamId: 'team-a',
      revision: 1,
      publicEnabled: true,
    });
  });
  it('keeps the current name when blank and rejects only an invalid replacement name', async () => {
    const page = await render();
    page.showModal('settings');
    page.settingsForm.name = 'A';
    await page.saveSettings();
    expect(page.modalError()).toContain('two characters');
    expect(teams.command).not.toHaveBeenCalled();
    page.settingsForm.name = '';
    await page.saveSettings();
    expect(page.modal()).toBeNull();
    expect(page.notice()).toBe('No changes to save.');
    expect(teams.command).not.toHaveBeenCalled();
  });
  it('saves exactly once even if an ancestor cancels the native submit action', async () => {
    const page = await render();
    page.showModal('settings');
    page.settingsForm.description = 'Updated description';
    fixture.detectChanges();
    await fixture.whenStable();
    const dialog = fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;
    dialog.addEventListener('click', (event) => event.preventDefault());
    dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    await fixture.whenStable();
    expect(teams.command).toHaveBeenCalledOnceWith('update', {
      teamId: 'team-a',
      revision: 1,
      description: 'Updated description',
    });
    expect(page.modal()).toBeNull();
  });
  it('shows an actionable error instead of silently ignoring a stale form after hot reload', async () => {
    const page = await render();
    // Existing open views can survive a dev-server template replacement without
    // going through showModal, which normally captures the settings baseline.
    page.modal.set('settings');
    fixture.detectChanges();
    await fixture.whenStable();
    const dialog = fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;
    dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    await fixture.whenStable();
    fixture.detectChanges();
    const alert = dialog.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain('Close and reopen');
    expect(document.activeElement).toBe(alert);
    expect(teams.command).not.toHaveBeenCalled();
    expect(page.modal()).toBe('settings');
  });
  it('shows validation errors at the save controls and brings them into view', async () => {
    const page = await render();
    page.showModal('settings');
    page.settingsForm.website = 'javascript:alert(1)';
    fixture.detectChanges();
    await fixture.whenStable();
    const dialog = fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;
    const button = dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    button.scrollIntoView({ block: 'end' });
    button.click();
    await fixture.whenStable();
    fixture.detectChanges();
    const alert = dialog.querySelector<HTMLElement>('[role="alert"]')!;
    expect(alert.textContent).toContain('HTTPS');
    expect(document.activeElement).toBe(alert);
    expect(alert.nextElementSibling?.classList.contains('dialog-footer')).toBeTrue();
    const rect = alert.getBoundingClientRect();
    expect(rect.top).toBeGreaterThanOrEqual(0);
    expect(rect.bottom).toBeLessThanOrEqual(window.innerHeight);
    expect(teams.command).not.toHaveBeenCalled();
  });
  it('recovers from an upload failure and permits selecting the same file again', async () => {
    const page = await render();
    page.showModal('settings');
    fixture.detectChanges();
    await fixture.whenStable();
    const dialog = fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;
    teams.uploadBranding.and.rejectWith(new Error('Choose a JPG, PNG, or WebP image under 8 MB.'));
    const input = chooseCover(dialog);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(input.value).toBe('');
    expect(page.modal()).toBe('settings');
    expect(page.busy()).toBeFalse();
    expect(page.brandingUpload()).toBeNull();
    expect(dialog.querySelector('[role="alert"]')?.textContent).toContain('under 8 MB');
    expect(dialog.querySelector('.image-upload--hero button')?.matches(':disabled')).toBeFalse();
    teams.uploadBranding.and.resolveTo('https://example.com/retry.jpg');
    chooseCover(dialog);
    await fixture.whenStable();
    expect(teams.uploadBranding).toHaveBeenCalledTimes(2);
    expect(page.settingsForm.heroUrl).toBe('https://example.com/retry.jpg');
    expect(page.modalError()).toBe('');
  });
  it('uses an explicit unlisted publication operation so older servers cannot silently publish it publicly', async () => {
    const page = await render();
    const listing = data.listings[1];
    page.showModal('listing', listing);
    page.listingVisibility.set('unlisted');
    page.saveListingVisibility(listing);
    await fixture.whenStable();
    expect(teams.command).toHaveBeenCalledWith('listing', jasmine.objectContaining({
      operation: 'publishUnlisted', visibility: 'unlisted', boardId: listing.id,
    }));
  });

});
