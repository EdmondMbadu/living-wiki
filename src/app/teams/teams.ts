import { BoardVisibilityControlComponent } from '../board-visibility-control';
import type { BoardVisibility } from '../board-visibility';
import { DatePipe, DecimalPipe, NgTemplateOutlet, isPlatformBrowser } from '@angular/common';
import {
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  PLATFORM_ID,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { combineLatest } from 'rxjs';
import { AuthService } from '../auth.service';
import { AccountMenuComponent } from '../account-menu/account-menu';
import { WorkspaceSidebarComponent } from '../workspace-sidebar/workspace-sidebar';
import { MobileMenuComponent } from '../mobile-menu/mobile-menu';
import { ThemeToggleComponent } from '../theme-toggle/theme-toggle';
import { PersonalVoiceService, type PersonalVoice } from '../personal-voice.service';
import { TeamsService } from './teams.service';
import { TeamContactComponent } from './team-contact';
import { TeamMemberAvatarComponent } from './team-member-avatar';
import { BoardsComponent } from '../boards/boards';
import { publicBoardQrImageUrl, publicBoardQrUrl } from '../board-qr-code';
import { httpsCallable } from 'firebase/functions';
import { getFirebaseFunctions } from '../firebase.client';
import {
  filterTeamListings,
  teamError,
  teamInitials,
  teamSlugInput,
  validateTeamReport,
  type PublicTeamPage,
  type TeamDashboard,
  type TeamInvitation,
  type TeamListing,
  type TeamMember,
  type TeamReport,
  type TeamConversation,
} from './team.models';

@Component({
  selector: 'app-teams',
  imports: [
    BoardVisibilityControlComponent,
    RouterLink,
    FormsModule,
    DatePipe,
    DecimalPipe,
    NgTemplateOutlet,
    AccountMenuComponent,
    WorkspaceSidebarComponent,
    MobileMenuComponent,
    ThemeToggleComponent,
    TeamContactComponent,
    TeamMemberAvatarComponent,
    BoardsComponent,
  ],
  templateUrl: './teams.html',
  styleUrl: './teams.css',
})
export class TeamsComponent {
  readonly templateText = {
    message1: $localize`Creating your team…`,
    message2: $localize`Create team`,
    message3: $localize`As a platform admin, you can create multiple teams.`,
    message4: $localize`One created team per account. You can join other teams.`,
    message5: $localize`Team admin`,
    message6: $localize`Team member`,
    message7: $localize`Archived`,
    message8: $localize`Private workspace`,
    message9: $localize`Invitation already accepted`,
    message10: $localize`This invitation has expired`,
    message11: $localize`Invitation declined`,
    message12: $localize`This invitation is no longer available`,
    message13: $localize`You’re invited to `,
    message14: $localize`Sign in to review your invitations`,
    message15: $localize`Change cover photo`,
    message16: $localize`Add a cover photo`,
    message17: $localize`Real estate listings and virtual tours, brought together.`,
    message18: $localize`Meet the team`,
    message19: $localize`Members`,
    message20: $localize`Refreshing…`,
    message21: $localize`Retry analytics`,
    message22: $localize`Refresh analytics`,
    message23: $localize`Less detail`,
    message24: $localize`Participants & chats`,
    message25: $localize`Voice unavailable · select another`,
    message26: $localize`Unlisted`,
    message27: $localize`Public`,
    message28: $localize` min`,
    message29: $localize`No listings match these filters`,
    message30: $localize`Your first team listing starts here`,
    message31: $localize`Try another search, status, or team member.`,
    message32: $localize`Create a real estate TalkThru. Everyone on the team can help refine its cards before it goes public.`,
    message33: $localize`Meet our team`,
    message34: $localize`Team members`,
    message35: $localize`Local expertise. Personal attention.`,
    message36: $localize`Everyone here can access and collaborate on the team’s listings.`,
    message37: $localize`Owner · Admin`,
    message38: $localize`Admin`,
    message39: $localize`Member`,
    message40: $localize`No voice shared`,
    message41: $localize`Visible on public page`,
    message42: $localize`Private team profile`,
    message43: $localize`Edit my team profile`,
    message44: $localize`Manage member`,
    message45: $localize`The team hasn’t added a description yet.`,
    message46: $localize`Add an existing listing`,
    message47: $localize`Team settings`,
    message48: $localize`Invite your team`,
    message49: $localize`Share this listing`,
    message50: $localize`Your voice, your choice`,
    message51: $localize`The listing leaves My Boards. Its existing link becomes unavailable until the team publishes it again.`,
    message52: $localize`A separate team-owned copy gets a new link. Your original stays unchanged.`,
    message53: $localize`Adding listing…`,
    message54: $localize`Copy to team`,
    message55: $localize`Move to team`,
    message56: $localize`Replace logo`,
    message57: $localize`Choose logo`,
    message58: $localize`Replace cover photo`,
    message59: $localize`Choose cover photo`,
    message60: $localize`cover photo`,
    message61: $localize`Uploading photo…`,
    message62: $localize`Saving…`,
    message63: $localize`Save team settings`,
    message64: $localize`Sending invitations…`,
    message65: $localize`Send invitations`,
    message66: $localize`Save profile`,
    message67: $localize`Make member`,
    message68: $localize`Make team admin`,
    message69: $localize`Make private`,
    message70: $localize`Publish `,
    message71: $localize` version`,
    message72: $localize`Publish changes`,
    message73: $localize`Share unlisted listing`,
    message74: $localize`Publish listing`,
    message75: $localize`Mark contacted`,
    message76: $localize`Contacted · mark new`,
    message77: $localize`Loading conversations…`,
    message78: $localize`View conversations`,
    message79: $localize`Visitor`,
    message80: $localize`Assistant`,
    message81: $localize`member`,
    message82: $localize`members`,
    message83: $localize`logo`,
    message84: $localize`unlisted`,
    message85: $localize`public`,
    message86: $localize`Manage `,
    message87: $localize`Team name`,
  };
  readonly auth = inject(AuthService);
  readonly teams = inject(TeamsService);
  private readonly voices = inject(PersonalVoiceService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroy = inject(DestroyRef);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private stopWatching: (() => void) | null = null;
  private loadSequence = 0;
  private reportSequence = 0;
  private refreshSequence = 0;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private createRequestId = '';
  private previousFocus: HTMLElement | null = null;
  private listingWizardTrigger: HTMLElement | null = null;
  @ViewChild('listingWizardHost') listingWizardHost?: ElementRef<HTMLElement>;
  readonly listingWizardOpen = signal(false);
  readonly listingWizardReady = signal(false);
  readonly listingWizardError = signal('');
  @ViewChild('modalDialog') set modalDialog(element: ElementRef<HTMLDialogElement> | undefined) {
    if (element && this.browser)
      queueMicrotask(() => {
        if (element.nativeElement.isConnected && !element.nativeElement.open)
          element.nativeElement.showModal();
      });
  }
  @ViewChild('settingsSaveError') set settingsSaveError(
    element: ElementRef<HTMLElement> | undefined,
  ) {
    if (element && this.browser)
      queueMicrotask(() => {
        if (!element.nativeElement.isConnected) return;
        element.nativeElement.scrollIntoView({ block: 'nearest' });
        element.nativeElement.focus({ preventScroll: true });
      });
  }
  readonly mode = signal<'workspace' | 'directory' | 'create' | 'invitations' | 'public'>(
    'directory',
  );
  readonly teamId = signal('');
  readonly dashboard = signal<TeamDashboard | null>(null);
  readonly publicPage = signal<PublicTeamPage | null>(null);
  readonly publicListings = signal<TeamListing[]>([]);
  readonly report = signal<TeamReport | null>(null);
  readonly reportError = signal('');
  readonly reportLoading = signal(false);
  readonly reportCheckedAt = signal<Date | null>(null);
  readonly busy = signal(false);
  readonly brandingUpload = signal<'logo' | 'hero' | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly notice = signal('');
  readonly tab = signal<'listings' | 'members' | 'about'>('listings');
  readonly search = signal('');
  readonly status = signal('');
  readonly representative = signal('');
  readonly days = signal(30);
  readonly page = signal(1);
  readonly grid = signal(false);
  readonly modal = signal<
    'settings' | 'invite' | 'member' | 'listing' | 'qr' | 'voice' | 'import' | null
  >(null);
  readonly importListings = signal<Array<{ id: string; title: string; updatedAt: string }>>([]);
  readonly importLoading = signal(false);
  importId = '';
  importOperation = 'copy';
  private importRequestId = '';
  readonly modalError = signal('');
  readonly selectedListing = signal<TeamListing | null>(null);
  readonly selectedMember = signal<TeamMember | null>(null);
  readonly personalVoices = signal<PersonalVoice[]>([]);
  readonly qrUrl = signal('');
  readonly invitationPreview = signal<{
    teamName: string;
    role: string;
    expiresAt: string;
    status?: string;
    matchesAccount?: boolean | null;
    teamId?: string;
  } | null>(null);
  readonly metricsExpanded = signal(false);
  readonly contacts = signal<
    Array<{
      id: string;
      name: string;
      email: string;
      phone: string;
      message: string;
      status: string;
      last_at: string;
    }>
  >([]);
  readonly contactsLoading = signal(false);
  readonly contactsError = signal('');
  readonly contactsCursor = signal<string | null>(null);
  readonly conversations = signal<TeamConversation[]>([]);
  readonly conversationsLoading = signal(false);
  readonly conversationsLoaded = signal(false);
  readonly conversationsError = signal('');
  readonly conversationsCursor = signal<string | null>(null);
  readonly currentTeam = computed(() => this.dashboard()?.team ?? null);
  readonly isAdmin = computed(() => this.dashboard()?.role === 'admin');
  readonly isOwner = computed(() => this.currentTeam()?.owner_id === this.auth.uid());
  readonly isPublic = computed(() => this.mode() === 'public');
  readonly members = computed(() => this.dashboard()?.members || []);
  readonly listings = computed(() => this.dashboard()?.listings || []);
  readonly filtered = computed(() =>
    filterTeamListings(
      this.listings(),
      this.members(),
      this.search(),
      this.status(),
      this.representative(),
    ),
  );
  readonly pageCount = computed(() => Math.max(1, Math.ceil(this.filtered().length / 10)));
  readonly pageRows = computed(() =>
    this.filtered().slice(
      (Math.min(this.page(), this.pageCount()) - 1) * 10,
      Math.min(this.page(), this.pageCount()) * 10,
    ),
  );
  readonly publishedCount = computed(
    () => this.listings().filter((listing) => listing.status === 'published').length,
  );
  readonly listingStatusSummary = computed(() => {
    const counts = this.listings().reduce(
      (result, listing) => {
        result[listing.status]++;
        return result;
      },
      { published: 0, draft: 0, unpublished: 0, archived: 0 },
    );
    return [
      `${counts.published} published`,
      ...(counts.draft ? [`${counts.draft} ${counts.draft === 1 ? 'draft' : 'drafts'}`] : []),
      ...(counts.unpublished ? [`${counts.unpublished} unpublished`] : []),
      ...(counts.archived ? [`${counts.archived} archived`] : []),
    ].join(' · ');
  });
  readonly activityPeriodLabel = computed(() =>
    this.reportLoading()
      ? $localize`Loading activity…`
      : this.reportError()
        ? $localize`Activity unavailable`
        : `Last ${this.days()} days · UTC`,
  );
  readonly voicePeriodLabel = computed(() =>
    this.report()?.totals.voiceSeconds == null
      ? this.reportLoading() || this.reportError()
        ? this.activityPeriodLabel()
        : $localize`Not tracked yet`
      : this.activityPeriodLabel(),
  );
  readonly pendingInvitations = computed(
    () =>
      this.dashboard()?.invitations.filter((invite) =>
        ['pending', 'expired'].includes(invite.status),
      ) || [],
  );
  readonly identity = computed(() => {
    const team = this.currentTeam();
    const page = this.publicPage();
    return team
      ? {
          name: team.name,
          description: team.description,
          logoUrl: team.logo_url,
          heroUrl: team.hero_url,
          heroPosition: team.hero_position,
          accent: team.accent,
          about: team.about,
          website: team.website,
          contactEmail: team.contact_email,
          contactPhone: team.contact_phone,
        }
      : page
        ? page
        : null;
  });
  readonly pageMembers = computed(() =>
    this.isPublic() ? this.publicPage()?.members || [] : this.members(),
  );
  readonly initials = teamInitials;
  createForm = { name: '', slug: '' };
  settingsForm = {
    name: '',
    description: '',
    about: '',
    logoUrl: '',
    heroUrl: '',
    heroPosition: 50,
    accent: '#216b4c',
    website: '',
    contactEmail: '',
    contactPhone: '',
    publicEnabled: false,
  };
  private settingsBaseline: typeof this.settingsForm | null = null;
  private settingsRevision: number | undefined;
  inviteForm = { emails: '', role: 'member' };
  memberForm = { title: '', bio: '', publicVisible: false, contactEmail: '', contactPhone: '' };
  selectedVoiceId = '';
  selectedRepId = '';
  readonly listingVisibility = signal<BoardVisibility>('private');

  saveListingVisibility(listing: TeamListing): void {
    const visibility = this.listingVisibility();
    if (visibility === 'private') this.listingAction('unpublish', listing);
    else this.listingAction('publish', listing, visibility);
  }

  constructor() {
    combineLatest([this.route.paramMap, this.route.queryParamMap])
      .pipe(takeUntilDestroyed())
      .subscribe(() => {
        void this.openRoute();
      });
    effect(() => {
      this.search();
      this.status();
      this.representative();
      this.page.set(1);
    });
    effect((onCleanup) => {
      if (!this.browser || !this.listingWizardOpen()) return;
      const previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      onCleanup(() => (document.body.style.overflow = previousOverflow));
    });
    this.destroy.onDestroy(() => {
      this.stopWatching?.();
      if (this.refreshTimer) clearTimeout(this.refreshTimer);
      this.loadSequence++;
    });
  }
  private async openRoute(): Promise<void> {
    if (!this.browser) return;
    const sequence = ++this.loadSequence;
    this.stopWatching?.();
    this.stopWatching = null;
    this.modal.set(null);
    this.listingWizardOpen.set(false);
    this.selectedListing.set(null);
    this.contacts.set([]);
    this.conversations.set([]);
    this.error.set('');
    this.notice.set('');
    this.invitationPreview.set(null);
    this.dashboard.set(null);
    this.publicPage.set(null);
    this.report.set(null);
    this.reportSequence++;
    this.reportError.set('');
    this.reportLoading.set(false);
    this.reportCheckedAt.set(null);
    this.loading.set(true);
    const path = this.route.snapshot.routeConfig?.path || '';
    const teamId = this.route.snapshot.paramMap.get('teamId') || '';
    this.teamId.set(teamId);
    this.mode.set(
      path === 'team/:slug'
        ? 'public'
        : path === 'teams/new'
          ? 'create'
          : path === 'teams/invitations'
            ? 'invitations'
            : teamId
              ? 'workspace'
              : 'directory',
    );
    const tab = this.route.snapshot.queryParamMap.get('tab');
    this.tab.set(tab === 'members' || tab === 'about' ? tab : 'listings');
    try {
      await this.auth.waitForReady();
      if (sequence !== this.loadSequence) return;
      if (this.isPublic()) {
        const result = await this.teams.publicPage(this.route.snapshot.paramMap.get('slug') || '');
        if (sequence !== this.loadSequence) return;
        this.publicPage.set(result.page);
        this.publicListings.set(result.listings);
      } else if (teamId) {
        const result = await this.teams.dashboard(teamId);
        if (sequence !== this.loadSequence) return;
        this.dashboard.set(result);
        if (path === 'teams/:teamId/create-listing' && result.team.status === 'active')
          this.openListingWizard();
        void this.loadMetrics();
        const requestedListing = this.route.snapshot.queryParamMap.get('listing');
        const selected = result.listings.find((listing) => listing.id === requestedListing);
        if (selected && !this.listingWizardOpen()) this.showModal('listing', selected);
        if (result.team.status === 'active')
          this.stopWatching = this.teams.watchTeam(
            teamId,
            () => this.scheduleRefresh(),
            () => {
              this.loadSequence++;
              this.teams.clearPrivateMedia();
              this.dashboard.set(null);
              this.report.set(null);
              this.reportSequence++;
              this.reportLoading.set(false);
              this.reportCheckedAt.set(null);
              this.modal.set(null);
              this.listingWizardOpen.set(false);
              this.selectedListing.set(null);
              this.selectedMember.set(null);
              this.contacts.set([]);
              this.conversations.set([]);
              this.error.set(
                $localize`Your access to this team has ended. Your personal boards are unchanged.`,
              );
            },
          );
      } else {
        await this.teams.refreshAccount();
        if (this.mode() === 'invitations') {
          const inviteId = this.route.snapshot.queryParamMap.get('invite');
          const token = this.route.snapshot.queryParamMap.get('token');
          if (inviteId && (token || this.auth.emailVerified())) {
            const preview = await this.teams.invitationPreview(inviteId, token || '');
            if (sequence === this.loadSequence) this.invitationPreview.set(preview);
          }
        }
      }
    } catch (error) {
      if (sequence === this.loadSequence) this.error.set(teamError(error));
    } finally {
      if (sequence === this.loadSequence) this.loading.set(false);
    }
  }
  async reload(): Promise<void> {
    await this.openRoute();
  }
  private scheduleRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      void this.refresh();
    }, 400);
  }
  async refresh(): Promise<void> {
    const teamId = this.teamId();
    const sequence = this.loadSequence;
    const refresh = ++this.refreshSequence;
    if (!teamId || !this.dashboard()) return;
    try {
      const result = await this.teams.dashboard(teamId);
      if (sequence === this.loadSequence && refresh === this.refreshSequence && this.dashboard()) {
        this.dashboard.set(result);
        await this.loadMetrics();
      }
    } catch (error) {
      if (sequence === this.loadSequence && refresh === this.refreshSequence)
        this.error.set(teamError(error));
    }
  }
  async loadMetrics(): Promise<void> {
    const teamId = this.teamId();
    const days = this.days();
    if (!teamId || !this.dashboard() || this.isPublic()) return;
    const sequence = ++this.reportSequence;
    const routeSequence = this.loadSequence;
    const uid = this.auth.uid();
    const isCurrent = () =>
      sequence === this.reportSequence &&
      routeSequence === this.loadSequence &&
      this.teamId() === teamId &&
      this.days() === days &&
      this.auth.uid() === uid &&
      !!this.dashboard();
    this.reportError.set('');
    this.report.set(null);
    this.reportCheckedAt.set(null);
    this.reportLoading.set(true);
    try {
      const result = validateTeamReport(await this.teams.report(teamId, days), days);
      if (isCurrent()) {
        this.report.set(result);
        this.reportCheckedAt.set(new Date());
      }
    } catch {
      if (isCurrent())
        this.reportError.set(
          $localize`Analytics are temporarily unavailable. No activity has been assumed.`,
        );
    } finally {
      if (isCurrent()) this.reportLoading.set(false);
    }
  }
  @HostListener('window:focus')
  @HostListener('document:visibilitychange')
  refreshMetricsOnFocus(): void {
    if (this.browser && !document.hidden && !this.reportLoading() && !this.listingWizardOpen())
      void this.refresh();
  }
  openListingWizard(): void {
    if (this.isPublic() || this.currentTeam()?.status !== 'active' || this.listingWizardOpen())
      return;
    this.listingWizardTrigger = document.activeElement as HTMLElement;
    this.listingWizardReady.set(false);
    this.listingWizardError.set('');
    this.listingWizardOpen.set(true);
    if (this.browser)
      requestAnimationFrame(() => {
        if (this.listingWizardOpen() && !this.listingWizardReady())
          this.listingWizardHost?.nativeElement.querySelector<HTMLElement>('button')?.focus();
      });
  }
  listingWizardLoaded(): void {
    this.listingWizardReady.set(true);
    if (this.browser)
      requestAnimationFrame(() => {
        this.listingWizardHost?.nativeElement
          .querySelector<HTMLElement>('input[type="url"]')
          ?.focus();
      });
  }
  closeListingWizard(): void {
    this.listingWizardOpen.set(false);
    if (this.route.snapshot.routeConfig?.path === 'teams/:teamId/create-listing') {
      void this.router.navigate(['/teams', this.teamId()], { replaceUrl: true });
    } else if (this.browser) {
      requestAnimationFrame(
        () => this.listingWizardTrigger?.isConnected && this.listingWizardTrigger.focus(),
      );
    }
  }
  @HostListener('document:keydown', ['$event'])
  handleListingWizardKey(event: KeyboardEvent): void {
    if (!this.listingWizardOpen()) return;
    if (event.key === 'Escape' && !this.listingWizardReady()) {
      event.preventDefault();
      this.closeListingWizard();
    }
    if (event.key !== 'Tab') return;
    const controls = Array.from(
      this.listingWizardHost?.nativeElement.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], summary, [tabindex="0"]',
      ) || [],
    ).filter((element) => element.getClientRects().length > 0);
    const first = controls[0];
    const last = controls.at(-1);
    if (
      first &&
      last &&
      (!this.listingWizardHost?.nativeElement.contains(document.activeElement) ||
        (event.shiftKey ? document.activeElement === first : document.activeElement === last))
    ) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  }
  setDays(value: string): void {
    const days = Number(value);
    if (![7, 30, 90].includes(days) || this.days() === days) return;
    this.days.set(days);
    void this.loadMetrics();
  }
  setTab(value: 'listings' | 'members' | 'about'): void {
    this.tab.set(value);
  }
  updateName(value: string): void {
    const wasAuto =
      !this.createForm.slug || this.createForm.slug === teamSlugInput(this.createForm.name);
    this.createForm.name = value;
    if (wasAuto) this.createForm.slug = teamSlugInput(value);
  }
  async create(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.createRequestId ||= crypto.randomUUID();
    try {
      const result = await this.teams.command<{ teamId: string }>('create', {
        ...this.createForm,
        requestId: this.createRequestId,
      });
      await this.teams.refreshAccount();
      await this.router.navigate(['/teams', result.teamId]);
    } catch (error) {
      this.error.set(teamError(error));
    } finally {
      this.busy.set(false);
    }
  }
  memberName(uid: string): string {
    return this.members().find((member) => member.uid === uid)?.name || 'Needs reassignment';
  }
  memberPhoto(uid: string): string {
    return this.members().find((member) => member.uid === uid)?.photoUrl || '';
  }
  memberAvatar(
    uid: string,
  ): Pick<TeamMember, 'uid' | 'name' | 'photoUrl' | 'profileIcon' | 'profilePictureType'> {
    return (
      this.members().find((member) => member.uid === uid) || {
        uid,
        name: 'Needs reassignment',
        photoUrl: '',
      }
    );
  }
  mayPublish(listing: TeamListing): boolean {
    return this.isAdmin() || listing.representativeId === this.auth.uid();
  }
  voiceAvailable(listing: TeamListing): boolean {
    return (
      !listing.voiceOwnerId ||
      this.members().some(
        (member) =>
          member.uid === listing.voiceOwnerId &&
          member.voice?.id === listing.voiceId &&
          member.voice?.revision === listing.voiceRevision,
      )
    );
  }
  editPath(listing: TeamListing): string[] {
    return ['/teams', this.teamId(), 'listings', listing.id, 'edit'];
  }
  publicPath(listing: TeamListing): string {
    return `/boards/${encodeURIComponent(listing.id)}`;
  }
  publicShareUrl(listing: TeamListing): string {
    return publicBoardQrUrl(listing.id);
  }
  async switchTeam(value: string): Promise<void> {
    if (value) await this.router.navigate(['/teams', value]);
  }
  showModal(
    kind: NonNullable<ReturnType<typeof this.modal>>,
    listing?: TeamListing,
    member?: TeamMember,
  ): void {
    this.previousFocus = document.activeElement as HTMLElement;
    this.modalError.set('');
    this.notice.set('');
    this.modal.set(kind);
    this.selectedListing.set(listing || null);
    this.selectedMember.set(member || null);
    this.qrUrl.set('');
    if (kind === 'settings' && this.currentTeam()) {
      const team = this.currentTeam()!;
      this.settingsForm = {
        name: team.name ?? '',
        description: team.description ?? '',
        about: team.about ?? '',
        logoUrl: team.logo_url ?? '',
        heroUrl: team.hero_url ?? '',
        heroPosition: team.hero_position ?? 50,
        accent: team.accent || '#216b4c',
        website: team.website ?? '',
        contactEmail: team.contact_email ?? '',
        contactPhone: team.contact_phone ?? '',
        publicEnabled: team.public_enabled ?? false,
      };
      this.settingsBaseline = { ...this.settingsForm };
      this.settingsRevision = team.revision;
    }
    if (kind === 'member' && member) {
      this.memberForm = {
        title: member.title,
        bio: member.bio,
        publicVisible: member.publicVisible,
        contactEmail: member.contactEmail,
        contactPhone: member.contactPhone,
      };
    }
    if (kind === 'listing' && listing) {
      this.selectedRepId = listing.representativeId;
      this.listingVisibility.set(listing.status === 'published'
        ? listing.publishedVisibility === 'unlisted' ? 'unlisted' : 'public' : 'private');
      this.contacts.set([]);
      this.contactsError.set('');
      this.contactsCursor.set(null);
      this.conversations.set([]);
      this.conversationsLoaded.set(false);
      this.conversationsError.set('');
      this.conversationsCursor.set(null);
      if (this.mayPublish(listing)) void this.loadContacts(listing);
    }
    if (kind === 'qr' && listing) this.makeQr(listing);
    if (kind === 'voice') {
      this.selectedVoiceId = '';
      void this.loadVoices();
    }
    if (kind === 'import') {
      this.importId = '';
      this.importOperation = 'copy';
      this.importRequestId = crypto.randomUUID();
      void this.loadImportListings();
    }
  }
  closeModal(event?: Event): void {
    if (this.busy()) {
      event?.preventDefault();
      return;
    }
    this.modal.set(null);
    queueMicrotask(() => this.previousFocus?.focus());
  }
  async loadImportListings(): Promise<void> {
    this.importLoading.set(true);
    this.importListings.set([]);
    try {
      this.importListings.set(
        (
          await this.teams.command<{
            listings: Array<{ id: string; title: string; updatedAt: string }>;
          }>('personalListings', { teamId: this.teamId() })
        ).listings,
      );
    } catch (error) {
      this.modalError.set(teamError(error));
    } finally {
      this.importLoading.set(false);
    }
  }
  async importListing(): Promise<void> {
    const listing = this.importListings().find((item) => item.id === this.importId);
    if (!listing || this.busy()) return;
    if (
      this.importOperation === 'move' &&
      !window.confirm(
        'Move this listing into the team? It will leave My Boards and become an unpublished team draft. All team members will be able to edit it.',
      )
    )
      return;
    this.busy.set(true);
    this.modalError.set('');
    try {
      await this.teams.command('transferListing', {
        teamId: this.teamId(),
        operation: this.importOperation,
        boardId: listing.id,
        updatedAt: listing.updatedAt,
        requestId: this.importRequestId,
      });
      await this.refresh();
      this.modal.set(null);
      this.notice.set(
        'Listing added as a private team draft. Choose its representative and voice before publishing.',
      );
    } catch (error) {
      this.modalError.set(teamError(error));
    } finally {
      this.busy.set(false);
    }
  }
  async leaveTeam(): Promise<void> {
    if (
      this.isOwner() ||
      this.busy() ||
      !window.confirm(
        'Leave this team? Your access and shared voice will be removed. Listings remain with the team.',
      )
    )
      return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.teams.command('member', {
        teamId: this.teamId(),
        operation: 'remove',
        memberId: this.auth.uid(),
      });
      await this.router.navigate(['/teams']);
    } catch (error) {
      this.error.set(teamError(error));
    } finally {
      this.busy.set(false);
    }
  }
  async run(
    action: string,
    data: Record<string, unknown>,
    message: string,
    close = true,
  ): Promise<boolean> {
    if (this.busy()) return false;
    this.busy.set(true);
    this.modalError.set('');
    this.error.set('');
    try {
      await this.teams.command(action, { teamId: this.teamId(), ...data });
      await this.refresh();
      this.notice.set(message);
      if (close) this.modal.set(null);
      return true;
    } catch (error) {
      (this.modal() ? this.modalError : this.error).set(teamError(error));
      return false;
    } finally {
      this.busy.set(false);
    }
  }
  onModalBackdropClick(event: MouseEvent): void {
    // A false return from an Angular event binding cancels native form/button actions.
    if (event.target === event.currentTarget) this.closeModal();
  }
  async saveSettings(): Promise<void> {
    if (this.busy()) return;
    if (!this.settingsBaseline || this.settingsRevision === undefined) {
      this.modalError.set(
        $localize`This settings form is out of date. Close and reopen Team settings before saving. Your existing saved team details have not changed.`,
      );
      return;
    }
    this.modalError.set('');
    const baseline = this.settingsBaseline;
    const values = {
      ...this.settingsForm,
      // Branding-only updates should never require re-entering the team's name.
      name: this.settingsForm.name.trim() || baseline.name,
    };
    const changes: Record<string, unknown> = {};
    for (const key of Object.keys(values) as Array<keyof typeof values>) {
      if (values[key] !== baseline[key])
        changes[key] = typeof values[key] === 'string' ? values[key].trim() : values[key];
    }
    if (typeof changes['name'] === 'string' && changes['name'].length < 2) {
      this.modalError.set(
        $localize`Use at least two characters for a new team name, or leave it blank to keep the current name.`,
      );
      return;
    }
    if (changes['website']) {
      try {
        const value = changes['website'] as string;
        const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`);
        if (url.protocol !== 'https:' || !url.hostname) throw new Error('Invalid website');
        changes['website'] = url.href;
      } catch {
        this.modalError.set(
          $localize`Enter a valid HTTPS website address, or leave Website blank to remove it.`,
        );
        return;
      }
    }
    if (
      changes['contactEmail'] &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(changes['contactEmail'] as string)
    ) {
      this.modalError.set($localize`Enter a valid business email address, or leave it blank to remove it.`);
      return;
    }
    if (!Object.keys(changes).length) {
      this.closeModal();
      this.notice.set('No changes to save.');
      return;
    }
    await this.run(
      'update',
      { ...changes, revision: this.settingsRevision },
      'Team settings saved.',
    );
  }
  onSaveSettingsClick(event: MouseEvent): void {
    // Invoke saving from the gesture itself. Ancestor handlers/extensions may cancel
    // the browser's native submit action; do not depend on that action to save.
    event.preventDefault();
    void this.saveSettings();
  }
  removeBranding(kind: 'logo' | 'hero'): void {
    if (this.busy()) return;
    if (kind === 'logo') this.settingsForm.logoUrl = '';
    else {
      this.settingsForm.heroUrl = '';
      this.settingsForm.heroPosition = 50;
    }
    this.modalError.set('');
  }
  chooseBrandingFile(input: HTMLInputElement): void {
    if (this.busy()) return;
    this.modalError.set('');
    try {
      // Open synchronously from the button gesture; never defer a native picker.
      if (typeof input.showPicker === 'function') input.showPicker();
      else input.click();
    } catch {
      this.modalError.set(
        $localize`Your browser could not open the file picker. Try the photo button again, or reload this page.`,
      );
    }
  }
  async uploadBranding(event: Event, kind: 'logo' | 'hero'): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || this.busy()) return;
    this.busy.set(true);
    this.brandingUpload.set(kind);
    this.modalError.set('');
    try {
      const url = await this.teams.uploadBranding(this.teamId(), kind, file);
      if (kind === 'logo') this.settingsForm.logoUrl = url;
      else this.settingsForm.heroUrl = url;
    } catch (error) {
      this.modalError.set(teamError(error));
    } finally {
      input.value = '';
      this.brandingUpload.set(null);
      this.busy.set(false);
    }
  }
  async invite(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.modalError.set('');
    try {
      const result = await this.teams.command<{
        invitations: Array<{ email: string; delivery: string }>;
        alreadyMembers: number;
      }>('invite', { teamId: this.teamId(), ...this.inviteForm });
      const failed = result.invitations.filter((item) => item.delivery === 'failed').length;
      await this.refresh();
      this.inviteForm.emails = '';
      this.modal.set(null);
      this.notice.set(
        failed
          ? `Invitations saved, but ${failed} email${failed === 1 ? '' : 's'} could not be delivered. Use Resend in Members. Invitees can also find them in their account menu.`
          : `${result.invitations.length} invitation${result.invitations.length === 1 ? '' : 's'} created. Emails are queued for delivery; check their status in Members.${result.alreadyMembers ? ` ${result.alreadyMembers} already on the team.` : ''}`,
      );
    } catch (error) {
      this.modalError.set(teamError(error));
    } finally {
      this.busy.set(false);
    }
  }
  resend(invite: TeamInvitation): void {
    this.inviteForm = { emails: invite.email, role: invite.role };
    void this.invite();
  }
  revoke(invite: TeamInvitation): void {
    void this.run('revokeInvitation', { inviteId: invite.id }, 'Invitation revoked.', false);
  }
  async respond(invite: TeamInvitation, accept: boolean): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.teams.command('respondInvitation', { inviteId: invite.id, accept });
      await this.teams.refreshAccount();
      if (accept) await this.router.navigate(['/teams', invite.teamId]);
      else this.notice.set('Invitation declined.');
    } catch (error) {
      this.error.set(teamError(error));
    } finally {
      this.busy.set(false);
    }
  }
  saveMember(): void {
    void this.run(
      'member',
      { operation: 'profile', memberId: this.selectedMember()?.uid, ...this.memberForm },
      'Team profile updated.',
    );
  }
  memberAction(operation: string, member: TeamMember, role?: string): void {
    const message =
      operation === 'remove'
        ? `Remove ${member.name}? Their team access and voice grant will end. Team listings will be kept.`
        : operation === 'transfer'
          ? `Transfer team ownership to ${member.name}? You will remain an admin.`
          : `Change ${member.name}'s role to ${role}?`;
    if (!window.confirm(message)) return;
    void this.run(
      'member',
      { operation, memberId: member.uid, role },
      operation === 'transfer' ? 'Ownership transferred.' : 'Membership updated.',
    );
  }
  listingAction(operation: string, listing: TeamListing, visibility?: BoardVisibility): void {
    const audience = visibility || (listing.publishedVisibility === 'unlisted' ? 'unlisted' : 'public');
    if (
      ['unpublish', 'archive', 'delete'].includes(operation) &&
      !window.confirm(
        operation === 'delete'
          ? `Permanently delete “${listing.title}”? This cannot be undone.`
          : `${operation === 'archive' ? 'Archive' : 'Unpublish'} “${listing.title}”? Its visitor link will become unavailable.`,
      )
    )
      return;
    void this.run(
      'listing',
      { operation: operation === 'publish' && audience === 'unlisted' ? 'publishUnlisted' : operation,
        boardId: listing.id, revision: listing.revision,
        ...(operation === 'publish' ? { visibility: audience } : {}) },
      operation === 'publish'
        ? (visibility || listing.publishedVisibility) === 'unlisted'
          ? 'Unlisted listing updated. Anyone with the link can view it.' : 'Public listing updated.'
        : operation === 'unpublish' ? 'Listing is private. Visitor links are unavailable.' : 'Listing updated.',
    );
  }
  assign(): void {
    const listing = this.selectedListing();
    if (listing)
      void this.run(
        'listing',
        {
          operation: 'assign',
          boardId: listing.id,
          revision: listing.revision,
          representativeId: this.selectedRepId,
        },
        'Representative updated.',
      );
  }
  async loadVoices(): Promise<void> {
    try {
      this.personalVoices.set((await this.voices.loadLibrary()).voices);
    } catch (error) {
      this.modalError.set(teamError(error));
    }
  }
  shareVoice(): void {
    void this.run(
      'voice',
      { operation: 'share', voiceId: this.selectedVoiceId, consent: true },
      'Your selected voice is now available to this team.',
    );
  }
  revokeVoice(): void {
    if (
      window.confirm(
        'Stop sharing your voice? Existing downloaded videos cannot be recalled. Affected listings will need a new voice.',
      )
    )
      void this.run('voice', { operation: 'revoke' }, 'Voice sharing stopped.');
  }
  selectVoice(value: string): void {
    const listing = this.selectedListing();
    if (!listing) return;
    const member = this.members().find((member) => member.uid === value);
    void this.run(
      'voice',
      {
        operation: 'select',
        boardId: listing.id,
        revision: listing.revision,
        ownerId: member?.uid || '',
        voiceId: member?.voice?.id || '',
        voiceRevision: member?.voice?.revision || 0,
      },
      'Listing voice updated. Publish when you are ready.',
    );
  }
  makeQr(listing: TeamListing): void {
    this.modalError.set('');
    this.qrUrl.set('');
    try {
      this.qrUrl.set(publicBoardQrImageUrl(listing.id));
    } catch {
      this.modalError.set($localize`The QR code could not be created. Please try again.`);
    }
  }
  async copyLink(listing: TeamListing): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.publicShareUrl(listing));
      this.notice.set('Listing link copied.');
    } catch {
      this.modalError.set($localize`Could not copy automatically. Use the View listing link.`);
    }
  }
  signinReturn(): Record<string, string> {
    return { redirectTo: this.router.url };
  }
  focusedInvitationId(): string {
    return this.route.snapshot.queryParamMap.get('invite') || '';
  }
  orderedInvitations(): TeamInvitation[] {
    const focused = this.focusedInvitationId();
    return [...this.teams.invitations()].sort(
      (a, b) => Number(b.id === focused) - Number(a.id === focused),
    );
  }
  async switchInvitationAccount(): Promise<void> {
    if (this.busy()) return;
    const redirectTo = this.router.url;
    this.busy.set(true);
    try {
      await this.auth.signOut();
      await this.router.navigate(['/sign-in'], { queryParams: { redirectTo } });
    } catch (error) {
      this.error.set(teamError(error));
    } finally {
      this.busy.set(false);
    }
  }
  invitationDeliveryLabel(delivery: TeamInvitation['delivery']): string {
    return {
      pending: 'Email pending',
      queued: 'Email queued',
      processing: 'Sending email',
      retry: 'Email retry scheduled',
      sent: 'Submitted to email provider',
      submitted: 'Submitted to email provider',
      delivered: 'Delivered to mail server',
      failed: 'Email failed · check the address and resend',
      unknown: 'Email status unconfirmed · check with the recipient before resending',
      cancelled: 'Email cancelled',
    }[delivery];
  }
  async teamLifecycle(operation: 'archive' | 'restore' | 'delete'): Promise<void> {
    if (this.busy()) return;
    const team = this.currentTeam();
    if (!team) return;
    const confirmName =
      operation === 'delete'
        ? window.prompt(
            `Permanently delete this team, its listings, and private contacts? This cannot be undone. Type “${team.name}” to continue.`,
          )
        : '';
    if (operation === 'delete' && confirmName !== team.name) return;
    if (
      operation === 'archive' &&
      !window.confirm(
        'Archive this team? Its public page and listings will be unpublished. You can restore the workspace later.',
      )
    )
      return;
    this.busy.set(true);
    this.modalError.set('');
    this.error.set('');
    try {
      await this.teams.command('lifecycle', { teamId: team.id, operation, confirmName });
      this.modal.set(null);
      await this.teams.refreshAccount();
      if (operation === 'delete') await this.router.navigate(['/teams']);
      else await this.reload();
    } catch (error) {
      (this.modal() ? this.modalError : this.error).set(teamError(error));
    } finally {
      this.busy.set(false);
    }
  }
  async loadContacts(
    listing: TeamListing,
    contactId?: string,
    status?: string,
    more = false,
  ): Promise<void> {
    this.contactsLoading.set(true);
    this.contactsError.set('');
    try {
      const result = await httpsCallable<
        unknown,
        {
          contacts: Array<{
            id: string;
            name: string;
            email: string;
            phone: string;
            message: string;
            status: string;
            last_at: string;
          }>;
          nextCursor: string | null;
        }
      >(
        getFirebaseFunctions(),
        'manageTeamContacts',
      )({
        teamId: this.teamId(),
        boardId: listing.id,
        ...(contactId ? { contactId, status } : {}),
        ...(more ? { cursor: this.contactsCursor() } : {}),
      });
      if (this.selectedListing()?.id === listing.id) {
        this.contacts.set(
          more
            ? [
                ...new Map(
                  [...this.contacts(), ...result.data.contacts].map((contact) => [
                    contact.id,
                    contact,
                  ]),
                ).values(),
              ]
            : result.data.contacts,
        );
        this.contactsCursor.set(result.data.nextCursor);
      }
    } catch (error) {
      this.contactsError.set(teamError(error));
    } finally {
      this.contactsLoading.set(false);
    }
  }
  async loadConversations(listing: TeamListing, more = false): Promise<void> {
    this.conversationsLoading.set(true);
    this.conversationsError.set('');
    try {
      const result = await httpsCallable<
        unknown,
        { conversations: TeamConversation[]; nextCursor: string | null }
      >(
        getFirebaseFunctions(),
        'getTeamConversations',
      )({
        teamId: this.teamId(),
        boardId: listing.id,
        ...(more ? { cursor: this.conversationsCursor() } : {}),
      });
      if (this.selectedListing()?.id === listing.id) {
        this.conversations.set(
          more
            ? [...this.conversations(), ...result.data.conversations]
            : result.data.conversations,
        );
        this.conversationsCursor.set(result.data.nextCursor);
        this.conversationsLoaded.set(true);
      }
    } catch (error) {
      this.conversationsError.set(teamError(error));
    } finally {
      this.conversationsLoading.set(false);
    }
  }
}
