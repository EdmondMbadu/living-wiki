import { isPlatformBrowser } from '@angular/common';
import {
  DestroyRef,
  Injectable,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  orderBy,
  limit,
  where,
  writeBatch,
  updateDoc,
  type Firestore,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { getBlob, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { AuthService } from '../auth.service';
import { getFirebaseFirestore, getFirebaseFunctions, getFirebaseStorage } from '../firebase.client';
import type {
  PublicTeamPage,
  TeamDashboard,
  TeamInvitation,
  TeamListing,
  TeamMembership,
  TeamReport,
  TeamNotification,
} from './team.models';

export type TeamAccountLoadState = 'idle' | 'loading' | 'ready' | 'error';

@Injectable({ providedIn: 'root' })
export class TeamsService {
  private readonly auth = inject(AuthService);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly firestore: Firestore | null = this.browser ? getFirebaseFirestore() : null;
  private readonly destroy = inject(DestroyRef);
  readonly memberships = signal<TeamMembership[]>([]);
  readonly invitations = signal<TeamInvitation[]>([]);
  readonly notifications = signal<TeamNotification[]>([]);
  readonly notificationsState = signal<TeamAccountLoadState>('idle');
  private readonly subscriptionRevision = signal(0);
  readonly unreadUpdates = computed(() =>
    this.notifications().filter((item) => !item.read && item.type !== 'team_invitation'),
  );
  readonly attentionCount = computed(() => this.invitations().length + this.unreadUpdates().length);
  readonly canCreate = signal<boolean | null>(null);
  readonly allowanceState = signal<TeamAccountLoadState>('idle');
  readonly invitationsState = signal<TeamAccountLoadState>('idle');
  private accountRequest = 0;
  private invitationSnapshotVersion = 0;
  readonly loaded = signal(false);
  readonly connectionError = signal(false);
  private readonly mediaCache = new Map<string, string>();
  private readonly mediaSources = new Map<string, string>();
  private mediaEpoch = 0;
  readonly activeMemberships = computed(() =>
    this.memberships().filter((team) => team.status === 'active'),
  );
  readonly sidebarRoute = computed(() =>
    this.activeMemberships().length === 1
      ? `/teams/${this.activeMemberships()[0].teamId}`
      : '/teams',
  );

  constructor() {
    effect((onCleanup) => {
      const uid = this.auth.uid();
      this.subscriptionRevision();
      const verified = this.auth.emailVerified();
      const email = this.auth.email().trim().toLowerCase();
      this.memberships.set([]);
      this.invitations.set([]);
      this.notifications.set([]);
      this.notificationsState.set('idle');
      this.canCreate.set(null);
      this.accountRequest++;
      this.allowanceState.set('idle');
      this.invitationsState.set('idle');
      this.loaded.set(false);
      this.connectionError.set(false);
      this.clearPrivateMedia();
      if (!uid || !this.firestore) {
        this.loaded.set(true);
        return;
      }
      let valid = true;
      const stop = onSnapshot(
        collection(this.firestore, 'users', uid, 'team_memberships'),
        (snapshot) => {
          if (!valid) return;
          const next = snapshot.docs.map((doc) => doc.data() as TeamMembership);
          if (
            this.memberships().some(
              (previous) =>
                !next.some(
                  (team) =>
                    team.teamId === previous.teamId &&
                    team.status === previous.status &&
                    team.role === previous.role,
                ),
            )
          )
            this.clearPrivateMedia();
          this.memberships.set(next);
          this.loaded.set(true);
          this.connectionError.set(false);
        },
        () => {
          if (valid) {
            this.clearPrivateMedia();
            this.memberships.set([]);
            this.connectionError.set(true);
            this.loaded.set(true);
          }
        },
      );
      untracked(() => void this.refreshAccount(uid));
      let recent: TeamNotification[] = [];
      let unread: TeamNotification[] = [];
      const ready = new Set<number>();
      const errors = new Set<number>();
      const merge = () => {
        if (!valid) return;
        this.notifications.set(
          [...new Map([...recent, ...unread].map((item) => [item.id, item])).values()].sort(
            (a, b) => b.createdAt.localeCompare(a.createdAt),
          ),
        );
        if (ready.has(1) && verified) {
          this.invitations.set(
            unread.flatMap((item) => {
              const invite = item.invitation;
              return invite &&
                invite.status === 'pending' &&
                invite.email === email &&
                Date.parse(invite.expiresAt) > Date.now()
                ? [invite]
                : [];
            }),
          );
        }
        this.notificationsState.set(errors.size ? 'error' : ready.size === 2 ? 'ready' : 'loading');
      };
      this.notificationsState.set('loading');
      const notifications = collection(this.firestore, 'users', uid, 'team_notifications');
      // Recent history is bounded, but unread items are not: the badge must never silently cap at 50.
      const stops = [
        query(notifications, orderBy('createdAt', 'desc'), limit(50)),
        query(notifications, where('read', '==', false)),
      ].map((source, index) =>
        onSnapshot(
          source,
          (snapshot) => {
            if (!valid) return;
            const items = snapshot.docs.map(
              (doc) => ({ id: doc.id, ...doc.data() }) as TeamNotification,
            );
            if (index === 0) recent = items;
            else {
              unread = items;
              this.invitationSnapshotVersion++;
            }
            ready.add(index);
            errors.delete(index);
            merge();
          },
          () => {
            if (valid) {
              errors.add(index);
              merge();
            }
          },
        ),
      );
      const refresh = () => {
        if (document.visibilityState === 'visible') void this.refreshAccount(uid);
      };
      window.addEventListener('focus', refresh);
      const expiryTimer = window.setInterval(merge, 30_000);
      onCleanup(() => {
        valid = false;
        stop();
        stops.forEach((stop) => stop());
        window.removeEventListener('focus', refresh);
        window.clearInterval(expiryTimer);
      });
    });
  }
  hasAccess(teamId: string): boolean {
    return this.memberships().some((team) => team.teamId === teamId && team.status === 'active');
  }
  retryNotificationConnection(): void {
    this.subscriptionRevision.update((value) => value + 1);
  }
  isAdmin(teamId: string): boolean {
    return this.memberships().some((team) => team.teamId === teamId && team.role === 'admin');
  }
  async refreshAccount(expectedUid = this.auth.uid()): Promise<void> {
    if (!expectedUid || !this.browser || this.auth.uid() !== expectedUid) return;
    const request = ++this.accountRequest;
    const snapshotVersion = this.invitationSnapshotVersion;
    const isCurrent = () => this.auth.uid() === expectedUid && request === this.accountRequest;
    this.allowanceState.set('loading');
    this.invitationsState.set('loading');
    await Promise.all([
      this.command<{ canCreate: boolean }>('allowance').then(
        (allowance) => {
          if (!isCurrent()) return;
          this.canCreate.set(allowance.canCreate);
          this.allowanceState.set('ready');
        },
        () => {
          if (!isCurrent()) return;
          this.canCreate.set(null);
          this.allowanceState.set('error');
        },
      ),
      (this.auth.emailVerified?.() === false
        ? Promise.resolve({ invitations: [] as TeamInvitation[] })
        : this.command<{ invitations: TeamInvitation[] }>('inbox')
      ).then(
        (inbox) => {
          if (!isCurrent()) return;
          if (snapshotVersion === this.invitationSnapshotVersion)
            this.invitations.set(inbox.invitations);
          this.invitationsState.set('ready');
        },
        () => {
          if (!isCurrent()) return;
          this.invitationsState.set('error');
        },
      ),
    ]);
  }
  async command<T = { ok: boolean }>(
    action: string,
    data: Record<string, unknown> = {},
  ): Promise<T> {
    if (!this.browser) throw new Error('Open this page in your browser to continue.');
    return (
      await httpsCallable<Record<string, unknown>, T>(getFirebaseFunctions(), 'teamCommand', {
        timeout: action === 'allowance' || action === 'inbox' ? 15_000 : 120_000,
      })({ ...data, action })
    ).data;
  }
  async dashboard(teamId: string): Promise<TeamDashboard> {
    const data = await this.command<TeamDashboard>('dashboard', { teamId });
    return data.team.status === 'active'
      ? this.hydrateMedia(data)
      : {
          ...data,
          listings: data.listings.map((listing) => ({
            ...listing,
            imageUrl: listing.imageUrl.startsWith('team-media:') ? '' : listing.imageUrl,
            videoUrl: listing.videoUrl.startsWith('team-media:') ? '' : listing.videoUrl,
          })),
        };
  }
  async report(teamId: string, days: number): Promise<TeamReport> {
    return (
      await httpsCallable<unknown, TeamReport>(
        getFirebaseFunctions(),
        'getTeamInsights',
      )({ teamId, days })
    ).data;
  }
  async publicPage(slug: string): Promise<{ page: PublicTeamPage; listings: TeamListing[] }> {
    return (
      await httpsCallable<unknown, { page: PublicTeamPage; listings: TeamListing[] }>(
        getFirebaseFunctions(),
        'getPublicTeamPage',
      )({ slug })
    ).data;
  }
  async invitationPreview(
    inviteId: string,
    token: string,
  ): Promise<{
    teamName: string;
    role: string;
    expiresAt: string;
    status?: string;
    matchesAccount?: boolean | null;
    teamId?: string;
  }> {
    return (
      await httpsCallable<
        unknown,
        {
          teamName: string;
          role: string;
          expiresAt: string;
          status?: string;
          matchesAccount?: boolean | null;
          teamId?: string;
        }
      >(
        getFirebaseFunctions(),
        'getTeamInvitationPreview',
      )({ inviteId, token })
    ).data;
  }
  async loadBoard(boardId: string): Promise<Record<string, unknown> | null> {
    if (!this.firestore) return null;
    const result = await getDoc(doc(this.firestore, 'team_boards', boardId));
    return result.exists() ? this.hydrateMedia(result.data()) : null;
  }
  async saveBoard(
    teamId: string,
    boardId: string,
    board: Record<string, unknown>,
    revision = 0,
  ): Promise<Record<string, unknown>> {
    const prepared = await this.storeMedia(teamId, boardId, board);
    const result = await this.command<{ board: Record<string, unknown> }>('saveListing', {
      teamId,
      boardId,
      board: prepared,
      revision,
    });
    return this.hydrateMedia(result.board);
  }
  async hydrateMedia<T>(value: T): Promise<T> {
    const epoch = this.mediaEpoch;
    return this.mapMedia(value, async (text) => {
      if (!text.startsWith('team-media:')) return text;
      const cached = this.mediaCache.get(text);
      if (cached) return cached;
      const blob = await getBlob(ref(getFirebaseStorage(), text.slice('team-media:'.length)));
      if (epoch !== this.mediaEpoch)
        throw new Error('Your team access changed. Reopen the listing.');
      const url = URL.createObjectURL(blob);
      this.mediaCache.set(text, url);
      this.mediaSources.set(url, text);
      return url;
    });
  }
  async storeMedia<T>(teamId: string, boardId: string, value: T): Promise<T> {
    return this.mapMedia(value, async (text) => {
      const known = this.mediaSources.get(text);
      if (known) return known;
      if (!text.startsWith('data:image/') && !text.startsWith('blob:')) return text;
      const blob = await (await fetch(text)).blob();
      if (!/^(image|video)\//.test(blob.type)) throw new Error('Unsupported team media type.');
      const path = `team-media/${teamId}/${boardId}/${crypto.randomUUID()}`;
      await uploadBytes(ref(getFirebaseStorage(), path), blob, {
        contentType: blob.type,
        cacheControl: 'private,no-store',
      });
      const stored = `team-media:${path}`;
      this.mediaSources.set(text, stored);
      return stored;
    });
  }
  private async mapMedia<T>(value: T, transform: (text: string) => Promise<string>): Promise<T> {
    if (typeof value === 'string') return (await transform(value)) as T;
    if (Array.isArray(value))
      return (await Promise.all(value.map((item) => this.mapMedia(item, transform)))) as T;
    if (value && typeof value === 'object')
      return Object.fromEntries(
        await Promise.all(
          Object.entries(value).map(async ([key, item]) => [
            key,
            await this.mapMedia(item, transform),
          ]),
        ),
      ) as T;
    return value;
  }
  clearPrivateMedia(): void {
    this.mediaEpoch++;
    for (const url of this.mediaCache.values()) URL.revokeObjectURL(url);
    this.mediaCache.clear();
    this.mediaSources.clear();
  }
  async markNotificationRead(id: string): Promise<void> {
    if (this.notifications().find((item) => item.id === id)?.type === 'team_invitation') return;
    if (this.firestore && this.auth.uid())
      await updateDoc(doc(this.firestore, 'users', this.auth.uid(), 'team_notifications', id), {
        read: true,
      });
  }
  async markAllNotificationsRead(): Promise<void> {
    const uid = this.auth.uid();
    if (!this.firestore || !uid) return;
    const items = this.unreadUpdates();
    for (let start = 0; start < items.length; start += 400) {
      if (this.auth.uid() !== uid) return;
      const batch = writeBatch(this.firestore);
      for (const item of items.slice(start, start + 400))
        batch.update(doc(this.firestore, 'users', uid, 'team_notifications', item.id), {
          read: true,
        });
      await batch.commit();
    }
  }
  async uploadBranding(teamId: string, kind: 'logo' | 'hero', file: File): Promise<string> {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 8 * 1024 * 1024)
      throw new Error('Choose a JPG, PNG, or WebP image under 8 MB.');
    const target = ref(
      getFirebaseStorage(),
      `team-branding/${teamId}/${kind}-${crypto.randomUUID()}`,
    );
    await uploadBytes(target, file, { contentType: file.type });
    return getDownloadURL(target);
  }
  watchTeam(teamId: string, changed: () => void, revoked: () => void): () => void {
    if (!this.firestore || !this.auth.uid()) return () => {};
    let first = true;
    const stop = onSnapshot(
      doc(this.firestore, 'teams', teamId, 'members', this.auth.uid()),
      (snapshot) => {
        if (!snapshot.exists() || snapshot.data()['status'] !== 'active') revoked();
        else if (!first) changed();
        first = false;
      },
      revoked,
    );
    const stopListings = onSnapshot(
      collection(this.firestore, 'teams', teamId, 'listings'),
      () => changed(),
      revoked,
    );
    const stopActivity = onSnapshot(
      query(
        collection(this.firestore, 'teams', teamId, 'activity'),
        orderBy('at', 'desc'),
        limit(1),
      ),
      () => changed(),
      revoked,
    );
    const cleanup = () => {
      stop();
      stopListings();
      stopActivity();
    };
    const unregister = this.destroy.onDestroy(cleanup);
    return () => {
      cleanup();
      unregister();
    };
  }
}
