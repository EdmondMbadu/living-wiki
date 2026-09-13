/** Pure team policy and projection helpers. Keep this module independent of Firebase. */
export type TeamRole = 'admin' | 'member';
export type TeamListingStatus = 'draft' | 'published' | 'unpublished' | 'archived';
export type TeamRecord = Record<string, any>;

export const TEAM_INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
export const TEAM_MAX_MEMBERS = 200;
export const TEAM_MAX_INVITES_PER_REQUEST = 30;

export function teamText(value: unknown, length: number): string {
  return typeof value === 'string'
    ? value
        .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
        .trim()
        .slice(0, length)
    : '';
}

export function teamSlug(value: unknown): string {
  return teamText(value, 120)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export function teamEmail(value: unknown): string {
  const email = teamText(value, 254).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

export function teamUrl(value: unknown): string {
  const raw = teamText(value, 2000);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

/** Missing settings are unchanged; explicit empty values clear optional details. */
export function applyTeamSettingsPatch(team: TeamRecord, data: TeamRecord): TeamRecord {
  const next = { ...team };
  if (Object.hasOwn(data, 'name')) next.name = teamText(data.name, 100) || team.name;
  for (const [input, field, limit] of [
    ['description', 'description', 280],
    ['about', 'about', 4000],
    ['contactPhone', 'contact_phone', 40],
  ] as const) {
    if (Object.hasOwn(data, input)) next[field] = teamText(data[input], limit);
  }
  for (const [input, field] of [
    ['logoUrl', 'logo_url'],
    ['heroUrl', 'hero_url'],
    ['website', 'website'],
  ] as const) {
    if (Object.hasOwn(data, input)) next[field] = teamUrl(data[input]);
  }
  if (Object.hasOwn(data, 'contactEmail')) next.contact_email = teamEmail(data.contactEmail);
  if (Object.hasOwn(data, 'heroPosition')) {
    next.hero_position = Math.max(
      0,
      Math.min(100, Number.isFinite(Number(data.heroPosition)) ? Number(data.heroPosition) : 50),
    );
  }
  if (Object.hasOwn(data, 'heroUrl') && !next.hero_url) next.hero_position = 50;
  if (Object.hasOwn(data, 'accent'))
    next.accent = /^#[0-9a-f]{6}$/i.test(data.accent) ? data.accent : '#216b4c';
  if (Object.hasOwn(data, 'publicEnabled')) next.public_enabled = data.publicEnabled === true;
  return next;
}

export function canPublishTeamListing(role: TeamRole, uid: string, listing: TeamRecord): boolean {
  return role === 'admin' || listing['representative_id'] === uid;
}

/** Resolve only display identity from the current account, never private profile fields. */
export function currentTeamMemberIdentity(member: TeamRecord, account?: TeamRecord): TeamRecord {
  if (!account) return member;
  const hasPicturePreference =
    Object.hasOwn(account, 'profilePictureType') || Object.hasOwn(account, 'photoURL');
  return {
    ...member,
    name: teamText(account['displayName'], 100) || member['name'],
    ...(hasPicturePreference
      ? {
          photo_url:
            account['profilePictureType'] === 'icon' || account['profilePictureType'] === null
              ? ''
              : teamUrl(account['photoURL']),
          profile_icon: teamText(account['profileIcon'], 80),
          profile_picture_type:
            account['profilePictureType'] === 'icon'
              ? 'icon'
              : account['profilePictureType'] === 'image'
                ? 'image'
                : null,
        }
      : {}),
  };
}

export function teamMemberProjection(uid: string, member: TeamRecord): TeamRecord {
  return {
    uid,
    name: teamText(member['name'], 100),
    photoUrl: teamUrl(member['photo_url']),
    profileIcon: teamText(member['profile_icon'], 80),
    profilePictureType:
      member['profile_picture_type'] === 'icon'
        ? 'icon'
        : member['profile_picture_type'] === 'image'
          ? 'image'
          : null,
    title: teamText(member['title'], 100),
    bio: teamText(member['bio'], 1000),
    contactEmail: teamEmail(member['public_email']),
    contactPhone: teamText(member['public_phone'], 40),
  };
}

export function teamPageProjection(id: string, team: TeamRecord): TeamRecord {
  return {
    id,
    name: teamText(team['name'], 100),
    slug: teamText(team['slug'], 64),
    description: teamText(team['description'], 280),
    about: teamText(team['about'], 4000),
    logoUrl: teamUrl(team['logo_url']),
    heroUrl: teamUrl(team['hero_url']),
    heroPosition: Math.max(0, Math.min(100, Number(team['hero_position'] ?? 50))),
    accent: /^#[0-9a-f]{6}$/i.test(team['accent']) ? team['accent'] : '#216b4c',
    website: teamUrl(team['website']),
    contactEmail: teamEmail(team['contact_email']),
    contactPhone: teamText(team['contact_phone'], 40),
  };
}

// Public snapshots are allowlisted, not a private document with a handful of fields removed.
const BOARD_FIELDS =
  `id kind title description icon tone imageUrl logoUrl logoLinkUrl stackCtaLabel stackCtaUrl
  insideCardsDisplay showCardNumbers narrationStyle narrationSecondsPerCard stackNarratorVoiceId
  socialVideoUrl socialVideoMimeType socialVideoRatio socialLandscapeVideoUrl socialLandscapeVideoMimeType
  trailerVideoUrl trailerVideoMimeType trailerVideoRatio trailerLandscapeVideoUrl trailerLandscapeVideoMimeType
  socialVideoClosingHeadline socialVideoClosingMessage socialVideoClosingShowQrCode socialVideoClosingImage
  socialVideoClosingCustomImageUrl socialVideoClosingDurationSeconds created_at_iso updated_at_iso`.split(
    /\s+/,
  );
const CARD_FIELDS =
  `id title type subtitle notes imageUrl imageUrls imageAlt text url videoUrl videoId youtubeVideoId
  stackScript caption address location latitude longitude price currency sourceUrl productUrl merchant
  tags stickers createdAt updatedAt scope status rating contactDetails stackNarration listingPresentation
  shortSummary entityName entityType mediaKind audioPreviewUrl googleMapsUrl locationLat locationLng
  youtubeVideoTitle youtubeChannelTitle youtubeThumbnailUrl youtubeDurationSeconds
  listingContact listingIntro listingTalkingCard listingSection
  contactName contactEmail contactPhone agency introMessage conversation`.split(/\s+/);

function select(source: TeamRecord, keys: string[]): TeamRecord {
  return Object.fromEntries(
    keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]),
  );
}

export function publicTeamCard(card: TeamRecord, depth = 0): TeamRecord | null {
  if (depth > 8 || card['authorOnly'] === true || card['visibility'] === 'author-only') return null;
  const result = select(card, CARD_FIELDS);
  if (card['contactDetails'] && typeof card['contactDetails'] === 'object') {
    result['contactDetails'] = select(card['contactDetails'], [
      'name',
      'organization',
      'phone',
      'email',
    ]);
  }
  if (card['conversation'] && typeof card['conversation'] === 'object') {
    result['conversation'] = select(card['conversation'], [
      'version',
      'provider',
      'atlasId',
      'openingMessage',
      'ctaLabel',
      'actions',
      'starters',
    ]);
  }
  if (Array.isArray(card['relatedCards'])) {
    result['relatedCards'] = card['relatedCards']
      .map((child: TeamRecord) => publicTeamCard(child, depth + 1))
      .filter(Boolean);
  }
  return result;
}

export function publicTeamBoard(
  board: TeamRecord,
  teamId: string,
  team: TeamRecord,
  now: string,
): TeamRecord {
  return {
    ...select(board, BOARD_FIELDS),
    team_id: teamId,
    owner_user_id: `team:${teamId}`,
    ...(board['reserved_custom_slug'] ? { custom_slug: board['reserved_custom_slug'] } : {}),
    owner_display_name: teamText(team['name'], 100),
    owner_public_slug: '',
    owner_photo_url: teamUrl(team['logo_url']),
    owner_profile_icon: '',
    owner_profile_picture_type: 'image',
    visibility: 'public',
    cards: (Array.isArray(board['cards']) ? board['cards'] : [])
      .map((card: TeamRecord) => publicTeamCard(card))
      .filter(Boolean),
    updated_at_iso: now,
  };
}

export function teamListingSummary(board: TeamRecord): TeamRecord {
  return {
    id: board['id'],
    title: teamText(board['title'], 90),
    description: teamText(board['description'], 280),
    imageUrl: teamText(board['imageUrl'], 2000),
    status: board['team_status'] || 'draft',
    representativeId: board['representative_id'],
    creatorId: board['created_by'],
    revision: board['team_revision'] || 1,
    publishedRevision: board['published_revision'] || 0,
    hasUnpublishedChanges:
      board['team_status'] === 'published' &&
      board['team_revision'] !== board['published_revision'],
    voiceOwnerId: board['voice_owner_id'] || '',
    voiceId: board['voice_id'] || '',
    voiceRevision: board['voice_revision'] || 0,
    voiceName: board['voice_name'] || 'System voice',
    createdAt: board['created_at_iso'],
    updatedAt: board['updated_at_iso'],
    lastEditorId: board['last_editor_id'],
    cardCount: Array.isArray(board['cards']) ? board['cards'].length : 0,
    videoUrl: teamText(board['socialVideoUrl'], 2000),
    videoUpdatedAt: board['socialVideoUpdatedAt'] || '',
  };
}

export function validInvitation(invite: TeamRecord, email: string, now: number): boolean {
  return (
    invite['status'] === 'pending' &&
    invite['email'] === email &&
    Number(invite['expires_at_ms']) > now
  );
}

/** Three-way merge preserves edits to different cards; conflicts never silently overwrite work. */
export function mergeTeamBoard(
  current: TeamRecord,
  base: TeamRecord,
  incoming: TeamRecord,
): TeamRecord {
  const equal = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const merged = { ...current };
  for (const key of Object.keys(incoming)) {
    if (key === 'cards' || equal(base[key], incoming[key])) continue;
    if (!equal(base[key], current[key]) && !equal(incoming[key], current[key]))
      throw new Error(`conflict:${key}`);
    merged[key] = incoming[key];
  }
  const before: TeamRecord[] = base['cards'] || [];
  const next: TeamRecord[] = incoming['cards'] || [];
  const live: TeamRecord[] = current['cards'] || [];
  const ids = (cards: TeamRecord[]) => cards.map((card) => card['id']);
  const structureChanged = !equal(ids(before), ids(next));
  if (structureChanged && !equal(ids(before), ids(live)) && !equal(ids(next), ids(live)))
    throw new Error('conflict:card-order');
  const byId = new Map(live.map((card) => [card['id'], card]));
  for (const card of next) {
    const old = before.find((item) => item['id'] === card['id']);
    if (equal(old, card)) continue;
    const existing = byId.get(card['id']);
    if (!equal(old, existing) && !equal(existing, card))
      throw new Error(`conflict:card:${card['id']}`);
    byId.set(card['id'], card);
  }
  for (const card of before.filter(
    (item) => !next.some((candidate) => candidate['id'] === item['id']),
  )) {
    if (!equal(card, byId.get(card['id']))) throw new Error(`conflict:card:${card['id']}`);
    byId.delete(card['id']);
  }
  merged['cards'] = (structureChanged ? ids(next) : ids(live))
    .map((id) => byId.get(id))
    .filter(Boolean);
  return merged;
}
