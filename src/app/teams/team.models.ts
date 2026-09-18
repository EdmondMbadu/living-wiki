export type TeamRole = 'admin' | 'member';
export interface TeamNotification {
  type?: 'team_invitation' | 'team_update';
  invitation?: TeamInvitation;
  id: string;
  teamId: string;
  message: string;
  target: string;
  read: boolean;
  createdAt: string;
}
export type ListingStatus = 'draft' | 'published' | 'unpublished' | 'archived';
export interface TeamMembership {
  teamId: string;
  name: string;
  logoUrl: string;
  slug: string;
  role: TeamRole;
  status: 'active' | 'archived';
  creatorId: string;
  ownerId: string;
}
export interface Team {
  id: string;
  name: string;
  slug: string;
  description: string;
  about: string;
  logo_url: string;
  hero_url: string;
  hero_position: number;
  accent: string;
  website: string;
  contact_email: string;
  contact_phone: string;
  owner_id: string;
  created_by: string;
  public_enabled: boolean;
  member_count: number;
  listing_count: number;
  status: 'active' | 'archived';
  revision: number;
  tracking_since: string;
}
export interface SharedTeamVoice {
  id: string;
  name: string;
  revision: number;
  sharedAt: string;
}
export interface TeamMember {
  uid: string;
  name: string;
  photoUrl: string;
  profileIcon?: string;
  profilePictureType?: 'image' | 'icon' | null;
  title: string;
  bio: string;
  contactEmail: string;
  contactPhone: string;
  email?: string;
  publicVisible: boolean;
  role: TeamRole;
  joinedAt: string;
  voice: SharedTeamVoice | null;
}
export interface TeamInvitation {
  id: string;
  teamId: string;
  teamName: string;
  email: string;
  role: TeamRole;
  status: 'pending' | 'accepted' | 'declined' | 'expired' | 'revoked';
  expiresAt: string;
  delivery:
    | 'sent'
    | 'failed'
    | 'pending'
    | 'queued'
    | 'processing'
    | 'retry'
    | 'submitted'
    | 'delivered'
    | 'unknown'
    | 'cancelled';
  inviterName?: string;
  sentAt?: string;
}
export interface TeamListing {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  status: ListingStatus;
  /** Visitor audience; the collaborative working copy always stays private. */
  publishedVisibility?: 'public' | 'unlisted' | 'private';
  representativeId: string;
  creatorId: string;
  revision: number;
  publishedRevision: number;
  hasUnpublishedChanges: boolean;
  voiceOwnerId: string;
  voiceId: string;
  voiceRevision: number;
  voiceName: string;
  createdAt: string;
  updatedAt: string;
  lastEditorId: string;
  cardCount: number;
  videoUrl: string;
  videoUpdatedAt: string;
}
export interface TeamDashboard {
  team: Team;
  role: TeamRole;
  members: TeamMember[];
  listings: TeamListing[];
  invitations: TeamInvitation[];
  activity: Array<{ id: string; actor_id: string; action: string; target: string; at: string }>;
}
export interface TeamMetrics {
  views: number;
  participants: number;
  chats: number;
  messages: number;
  contacts: number;
  voiceSeconds: number | null;
}
export interface TeamReport {
  totals: TeamMetrics;
  listings: Record<string, TeamMetrics>;
  trackingSince: string;
  voiceTrackingSince?: string | null;
  days: number;
}

/** Missing or invalid counters are unavailable, never an assumed zero. */
export function validateTeamReport(report: TeamReport, days: number): TeamReport {
  const validMetrics = (value: TeamMetrics) =>
    value &&
    ['views', 'participants', 'chats', 'messages', 'contacts'].every((key) => {
      const count = value[key as keyof TeamMetrics];
      return typeof count === 'number' && Number.isSafeInteger(count) && count >= 0;
    }) &&
    (value.voiceSeconds === null ||
      (typeof value.voiceSeconds === 'number' &&
        Number.isFinite(value.voiceSeconds) &&
        value.voiceSeconds >= 0));
  if (
    !report ||
    report.days !== days ||
    !validMetrics(report.totals) ||
    !report.listings ||
    Array.isArray(report.listings) ||
    typeof report.listings !== 'object' ||
    !Object.values(report.listings).every(validMetrics)
  )
    throw new Error('Analytics returned incomplete or invalid counts. Please refresh.');
  return report;
}
export interface TeamConversation {
  id: string;
  startedAt: string;
  durationSeconds: number;
  internal: boolean;
  transcript: Array<{ role: string; message: string; seconds: number }>;
}
export interface PublicTeamPage {
  id: string;
  name: string;
  slug: string;
  description: string;
  about: string;
  logoUrl: string;
  heroUrl: string;
  heroPosition: number;
  accent: string;
  website: string;
  contactEmail: string;
  contactPhone: string;
  members: Array<
    Pick<
      TeamMember,
      | 'uid'
      | 'name'
      | 'photoUrl'
      | 'profileIcon'
      | 'profilePictureType'
      | 'title'
      | 'bio'
      | 'contactEmail'
      | 'contactPhone'
    >
  >;
}
export function filterTeamListings(
  listings: readonly TeamListing[],
  members: readonly TeamMember[],
  query: string,
  status: string,
  representativeId: string,
): TeamListing[] {
  const term = query.trim().toLocaleLowerCase();
  const names = new Map(members.map((member) => [member.uid, member.name]));
  return listings
    .filter(
      (listing) =>
        (!status || listing.status === status) &&
        (!representativeId || listing.representativeId === representativeId) &&
        (!term ||
          [listing.title, listing.description, names.get(listing.representativeId) || '']
            .join(' ')
            .toLocaleLowerCase()
            .includes(term)),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export function teamInitials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0] || '')
      .join('')
      .toUpperCase() || 'T'
  );
}
export function teamSlugInput(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}
export function teamError(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message.replace(/^Firebase:\s*/, '').replace(/\s*\(functions\/[^)]+\)\.?$/, '')
      : '';
  return message && message !== 'INTERNAL'
    ? message
    : 'Something went wrong. Please try again. Your changes have not been discarded.';
}
