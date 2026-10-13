import { HttpsError } from 'firebase-functions/v2/https';
import type { Transaction } from 'firebase-admin/firestore';
import { db } from './firebase';
import {
  TALKTHRU_FREE_ACTIVE_LIMIT,
  TALKTHRU_TEAM_FREE_PUBLISHED_LIMIT,
  isLinkReadableTalkThruVisibility,
  isTalkThruBoardRecord,
  resolveTalkThruEntitlement,
  talkThruStatusGrantsAccess,
  type TalkThruBillingRecord,
  type TalkThruEntitlement,
  type TalkThruListingSummary,
} from './talkthru-plans';

// Server-only collections. The default Firestore rule denies every client
// read and write; the app reads them through talkThruBillingCommand.
export const talkThruBillingCollection = db.collection('talkthru_billing');
export const talkThruTeamBillingCollection = db.collection('talkthru_team_billing');
export const talkThruTrialClaimsCollection = db.collection('talkthru_trial_claims');
export const talkThruPausedBoardsCollection = db.collection('talkthru_paused_boards');

export type TalkThruPlanRequiredReason =
  | 'listing_limit'
  | 'video_export'
  | 'team_listing_limit'
  | 'team_seats';

/**
 * The browser recognises `details.talkthruPlanRequired` and opens the plan
 * picker instead of only showing the message.
 */
export function talkThruPlanRequired(
  reason: TalkThruPlanRequiredReason,
  message: string,
  extra: Record<string, unknown> = {},
): HttpsError {
  return new HttpsError('failed-precondition', message, { talkthruPlanRequired: true, reason, ...extra });
}

export async function loadTalkThruEntitlement(uid: string): Promise<{
  entitlement: TalkThruEntitlement;
  personal: TalkThruBillingRecord | null;
  isAdmin: boolean;
}> {
  const [user, personal, memberships] = await Promise.all([
    db.collection('users').doc(uid).get(),
    talkThruBillingCollection.doc(uid).get(),
    db.collection('users').doc(uid).collection('team_memberships').limit(25).get(),
  ]);
  const isAdmin = user.data()?.['role'] === 'admin';
  const teams = (await Promise.all(memberships.docs.map(async (membership) => {
    const teamId = membership.id;
    const [billing, member] = await db.getAll(
      talkThruTeamBillingCollection.doc(teamId),
      db.collection('teams').doc(teamId).collection('members').doc(uid),
    );
    if (!billing.exists || member.data()?.['status'] !== 'active') return null;
    return { teamId, record: billing.data() as TalkThruBillingRecord };
  }))).filter((team): team is { teamId: string; record: TalkThruBillingRecord } => !!team);
  const personalRecord = personal.exists ? personal.data() as TalkThruBillingRecord : null;
  return {
    entitlement: resolveTalkThruEntitlement({ isAdmin, personal: personalRecord, teams }),
    personal: personalRecord,
    isAdmin,
  };
}

/** Personal TalkThrus (any visibility) owned by this account. */
export async function listPersonalTalkThrus(uid: string): Promise<TalkThruListingSummary[]> {
  const snapshot = await db.collection('boards').where('owner_user_id', '==', uid).get();
  return snapshot.docs
    .filter((doc) => {
      const data = doc.data();
      return !data['team_id'] && !data['parentBoardId'] && isTalkThruBoardRecord(data);
    })
    .map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        visibility: typeof data['visibility'] === 'string' ? data['visibility'] : 'private',
        updatedAt: typeof data['updated_at_iso'] === 'string'
          ? data['updated_at_iso']
          : typeof data['created_at_iso'] === 'string' ? data['created_at_iso'] : '',
      };
    });
}

export function activeTalkThruCount(listings: readonly TalkThruListingSummary[], excludeId = ''): number {
  return listings.filter((listing) => listing.id !== excludeId && isLinkReadableTalkThruVisibility(listing.visibility)).length;
}

function limitMessage(entitlement: TalkThruEntitlement): string {
  return entitlement.plan === 'free'
    ? `Your free plan includes ${TALKTHRU_FREE_ACTIVE_LIMIT} live TalkThru. Start your free month to add more.`
    : `Solo Agent includes ${entitlement.activeLimit} live TalkThrus. Switch to Agent Pro for unlimited listings.`;
}

/** Called before the wizard spends generation effort on a new personal TalkThru. */
export async function assertTalkThruCreationAllowed(uid: string): Promise<void> {
  const { entitlement } = await loadTalkThruEntitlement(uid);
  if (entitlement.activeLimit === null) return;
  const listings = await listPersonalTalkThrus(uid);
  const activeCount = activeTalkThruCount(listings);
  if (activeCount >= entitlement.activeLimit) {
    throw talkThruPlanRequired('listing_limit', limitMessage(entitlement), {
      plan: entitlement.plan,
      activeLimit: entitlement.activeLimit,
      activeCount,
    });
  }
}

export async function teamBillingRecord(teamId: string, tx?: Transaction): Promise<TalkThruBillingRecord | null> {
  const ref = talkThruTeamBillingCollection.doc(teamId);
  const snapshot = tx ? await tx.get(ref) : await ref.get();
  return snapshot.exists ? snapshot.data() as TalkThruBillingRecord : null;
}

export function teamPlanActive(record: TalkThruBillingRecord | null | undefined): boolean {
  return !!record && record.plan === 'team' && talkThruStatusGrantsAccess(record.status);
}

/**
 * Teams can keep one listing published for free. Re-publishing a listing that
 * is already live is always allowed so edits are never blocked.
 */
export async function assertTeamCanPublishListing(teamId: string, boardId: string, uid: string): Promise<void> {
  const [record, user, listings] = await Promise.all([
    teamBillingRecord(teamId),
    db.collection('users').doc(uid).get(),
    db.collection('teams').doc(teamId).collection('listings').where('status', '==', 'published').get(),
  ]);
  if (teamPlanActive(record) || user.data()?.['role'] === 'admin') return;
  const publishedIds = listings.docs.map((doc) => doc.id);
  if (publishedIds.includes(boardId)) return;
  if (publishedIds.length >= TALKTHRU_TEAM_FREE_PUBLISHED_LIMIT) {
    throw talkThruPlanRequired(
      'team_listing_limit',
      `Your team's free plan includes ${TALKTHRU_TEAM_FREE_PUBLISHED_LIMIT} published TalkThru. Start the team's free month to publish more.`,
      { teamId },
    );
  }
}

/**
 * Once a team pays per seat, invitations cannot exceed the seats it bought.
 * Free teams are not seat-limited; their limit is the one published listing.
 */
export async function assertTeamSeatsAvailable(
  tx: Transaction,
  teamId: string,
  activeMemberCount: number,
  newInviteEmails: readonly string[],
): Promise<void> {
  if (!newInviteEmails.length) return;
  const record = await teamBillingRecord(teamId, tx);
  if (!teamPlanActive(record)) return;
  const seats = Number(record?.seats) || 0;
  const pending = await tx.get(
    db.collection('team_invitations').where('team_id', '==', teamId).where('status', '==', 'pending'),
  );
  const now = Date.now();
  const newEmails = new Set(newInviteEmails);
  const otherPending = pending.docs.filter((doc) => {
    const data = doc.data();
    return !newEmails.has(data['email']) && Number(data['expires_at_ms'] || 0) > now;
  }).length;
  const needed = activeMemberCount + otherPending + newEmails.size;
  if (needed > seats) {
    throw talkThruPlanRequired(
      'team_seats',
      `Your team plan has ${seats} seats and ${activeMemberCount + otherPending} are taken or invited. Add seats in Billing, then send the invitation again.`,
      { teamId, seats, needed },
    );
  }
}
