import { DatePipe, DecimalPipe, isPlatformBrowser } from '@angular/common';
import {
  Component,
  DestroyRef,
  ElementRef,
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
import { httpsCallable } from 'firebase/functions';
import { getFirebaseFunctions } from '../firebase.client';
import {
  filterTeamListings,
  teamError,
  teamInitials,
  teamSlugInput,
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
    RouterLink,
    FormsModule,
    DatePipe,
    DecimalPipe,
    AccountMenuComponent,
    WorkspaceSidebarComponent,
    MobileMenuComponent,
    ThemeToggleComponent,
    TeamContactComponent,
  ],
  templateUrl: './teams.html',
  styleUrl: './teams.css',
})
export class TeamsComponent {
  readonly auth = inject(AuthService);
  readonly teams = inject(TeamsService);
  private readonly voices = inject(PersonalVoiceService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroy = inject(DestroyRef);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private stopWatching: (() => void) | null = null;
  private loadSequence = 0;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private createRequestId = '';
  private previousFocus: HTMLElement | null = null;
  @ViewChild('modalDialog') set modalDialog(element: ElementRef<HTMLDialogElement> | undefined) {
    if (element && this.browser)
      queueMicrotask(() => {
        if (element.nativeElement.isConnected && !element.nativeElement.open)
          element.nativeElement.showModal();
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
  readonly busy = signal(false);
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
    | 'settings'
    | 'invite'
    | 'member'
    | 'listing'
    | 'qr'
    | 'voice'
    | 'import'
    | 'notifications'
    | null
  >(null);
  readonly importListings = signal<Array<{ id: string; title: string; updatedAt: string }>>([]);
  readonly importLoading = signal(false);
  importId = '';
  importOperation = 'copy';
  private importRequestId = '';
  readonly unreadNotifications = computed(
    () => this.teams.notifications().filter((item) => !item.read).length,
  );
  readonly modalError = signal('');
  readonly selectedListing = signal<TeamListing | null>(null);
  readonly selectedMember = signal<TeamMember | null>(null);
  readonly personalVoices = signal<PersonalVoice[]>([]);
  readonly qrUrl = signal('');
  readonly invitationPreview = signal<{ teamName: string; role: string; expiresAt: string } | null>(
    null,
  );
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
  inviteForm = { emails: '', role: 'member' };
  memberForm = { title: '', bio: '', publicVisible: false, contactEmail: '', contactPhone: '' };
  selectedVoiceId = '';
  selectedRepId = '';

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
    this.selectedListing.set(null);
    this.contacts.set([]);
    this.conversations.set([]);
    this.error.set('');
    this.notice.set('');
    this.dashboard.set(null);
    this.publicPage.set(null);
    this.report.set(null);
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
        void this.loadMetrics();
        const requestedListing = this.route.snapshot.queryParamMap.get('listing');
        const selected = result.listings.find((listing) => listing.id === requestedListing);
        if (selected) this.showModal('listing', selected);
        if (result.team.status === 'active')
          this.stopWatching = this.teams.watchTeam(
            teamId,
            () => this.scheduleRefresh(),
            () => {
              this.loadSequence++;
              this.teams.clearPrivateMedia();
              this.dashboard.set(null);
              this.report.set(null);
              this.modal.set(null);
              this.selectedListing.set(null);
              this.selectedMember.set(null);
              this.contacts.set([]);
              this.conversations.set([]);
              this.error.set(
                'Your access to this team has ended. Your personal boards are unchanged.',
              );
            },
          );
      } else {
        await this.teams.refreshAccount();
        if (this.mode() === 'invitations') {
          const inviteId = this.route.snapshot.queryParamMap.get('invite');
          const token = this.route.snapshot.queryParamMap.get('token');
          if (inviteId && token)
            this.invitationPreview.set(await this.teams.invitationPreview(inviteId, token));
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
    if (!teamId || !this.dashboard()) return;
    try {
      const result = await this.teams.dashboard(teamId);
      if (sequence === this.loadSequence && this.dashboard()) this.dashboard.set(result);
    } catch (error) {
      if (sequence === this.loadSequence) this.error.set(teamError(error));
    }
  }
  async loadMetrics(): Promise<void> {
    const teamId = this.teamId();
    const days = this.days();
    this.reportError.set('');
    this.report.set(null);
    try {
      const result = await this.teams.report(teamId, days);
      if (this.teamId() === teamId && this.days() === days && this.dashboard())
        this.report.set(result);
    } catch {
      if (this.teamId() === teamId)
        this.reportError.set(
          'Analytics are temporarily unavailable. No activity has been assumed.',
        );
    }
  }
  setDays(value: string): void {
    this.days.set(Number(value));
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
        name: team.name,
        description: team.description,
        about: team.about,
        logoUrl: team.logo_url,
        heroUrl: team.hero_url,
        heroPosition: team.hero_position,
        accent: team.accent,
        website: team.website,
        contactEmail: team.contact_email,
        contactPhone: team.contact_phone,
        publicEnabled: team.public_enabled,
      };
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
      this.contacts.set([]);
      this.contactsError.set('');
      this.contactsCursor.set(null);
      this.conversations.set([]);
      this.conversationsLoaded.set(false);
      this.conversationsError.set('');
      this.conversationsCursor.set(null);
      if (this.mayPublish(listing)) void this.loadContacts(listing);
    }
    if (kind === 'qr' && listing) void this.makeQr(listing);
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
  async openNotification(item: { id: string; teamId: string; target: string }): Promise<void> {
    try {
      await this.teams.markNotificationRead(item.id);
      this.modal.set(null);
      await this.router.navigate(['/teams', item.teamId], {
        queryParams: item.target ? { listing: item.target } : {},
      });
    } catch (error) {
      this.modalError.set(teamError(error));
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
  saveSettings(): void {
    void this.run(
      'update',
      { ...this.settingsForm, revision: this.currentTeam()?.revision },
      'Team settings saved.',
    );
  }
  async uploadBranding(event: Event, kind: 'logo' | 'hero'): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file || this.busy()) return;
    this.busy.set(true);
    this.modalError.set('');
    try {
      const url = await this.teams.uploadBranding(this.teamId(), kind, file);
      if (kind === 'logo') this.settingsForm.logoUrl = url;
      else this.settingsForm.heroUrl = url;
    } catch (error) {
      this.modalError.set(teamError(error));
    } finally {
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
          : `${result.invitations.length} invitation${result.invitations.length === 1 ? '' : 's'} sent.${result.alreadyMembers ? ` ${result.alreadyMembers} already on the team.` : ''}`,
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
  listingAction(operation: string, listing: TeamListing): void {
    if (
      ['unpublish', 'archive', 'delete'].includes(operation) &&
      !window.confirm(
        operation === 'delete'
          ? `Permanently delete “${listing.title}”? This cannot be undone.`
          : `${operation === 'archive' ? 'Archive' : 'Unpublish'} “${listing.title}”? Its public link will become unavailable.`,
      )
    )
      return;
    void this.run(
      'listing',
      { operation, boardId: listing.id, revision: listing.revision },
      operation === 'publish' ? 'Public listing updated.' : 'Listing updated.',
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
  async makeQr(listing: TeamListing): Promise<void> {
    try {
      const qr = await import('qrcode');
      const url = `${window.location.origin}${this.publicPath(listing)}?utm_source=qr-code&utm_medium=team`;
      const dataUrl = await qr.toDataURL(url, {
        width: 600,
        margin: 2,
        color: { dark: '#123b2b', light: '#ffffff' },
      });
      if (this.selectedListing()?.id === listing.id) this.qrUrl.set(dataUrl);
    } catch {
      this.modalError.set('The QR code could not be created. Please try again.');
    }
  }
  async copyLink(listing: TeamListing): Promise<void> {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${this.publicPath(listing)}`);
      this.notice.set('Listing link copied.');
    } catch {
      this.modalError.set('Could not copy automatically. Use the View listing link.');
    }
  }
  signinReturn(): Record<string, string> {
    return { redirectTo: this.router.url };
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
