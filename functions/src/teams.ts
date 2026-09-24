import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, type Transaction } from 'firebase-admin/firestore';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { db, storage } from './firebase';
import {
  invitationNotificationRef,
  invitationView,
  syncInvitationForUser,
} from './team-invitations';
import {
  applyTeamSettingsPatch,
  canPublishTeamListing,
  currentTeamMemberIdentity,
  mergeTeamBoard,
  publicTeamBoard,
  teamEmail,
  teamListingSummary,
  teamMemberProjection,
  teamPageProjection,
  teamSlug,
  teamText,
  teamUrl,
  validInvitation,
  TEAM_INVITATION_LIFETIME_MS,
  TEAM_MAX_INVITES_PER_REQUEST,
  TEAM_MAX_MEMBERS,
  type TeamRecord,
} from './team-model';

const options = { region: 'us-central1', cors: true };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const teamRef = (id: string) => db.collection('teams').doc(id);
const memberRef = (teamId: string, uid: string) => teamRef(teamId).collection('members').doc(uid);
const indexRef = (uid: string, teamId: string) =>
  db.collection('users').doc(uid).collection('team_memberships').doc(teamId);
const listingRef = (id: string) => db.collection('team_boards').doc(id);
const fail = (message: string): never => {
  throw new HttpsError('failed-precondition', message);
};
function id(value: unknown): string {
  const result = teamText(value, 180);
  if (!/^[a-zA-Z0-9_-]{1,180}$/.test(result))
    throw new HttpsError('invalid-argument', 'Invalid identifier.');
  return result;
}
function actor(request: CallableRequest): string {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to continue.');
  return request.auth.uid;
}
export async function requireTeamMember(
  teamId: string,
  uid: string,
  admin = false,
  tx?: Transaction,
) {
  const refs = [teamRef(teamId), memberRef(teamId, uid)];
  const [teamSnap, memberSnap] = tx ? await tx.getAll(...refs) : await db.getAll(...refs);
  const team = teamSnap.data();
  const member = memberSnap.data();
  if (
    !team ||
    !['active', 'archived'].includes(team['status']) ||
    !member ||
    member['status'] !== 'active'
  ) {
    throw new HttpsError('permission-denied', 'You no longer have access to this team.');
  }
  if (admin && member['role'] !== 'admin')
    throw new HttpsError('permission-denied', 'Only team admins can do that.');
  return { team, member };
}
export async function isActiveTeamMember(teamId: string, uid: string): Promise<boolean> {
  if (!uid || !teamId) return false;
  try {
    const { team } = await requireTeamMember(teamId, uid);
    return team['status'] === 'active';
  } catch {
    return false;
  }
}
function active(team: TeamRecord) {
  if (team['status'] !== 'active') fail('Restore this team before making changes.');
}
function audit(tx: Transaction, teamId: string, uid: string, action: string, target = '') {
  tx.create(teamRef(teamId).collection('activity').doc(), {
    actor_id: uid,
    action,
    target,
    at: new Date().toISOString(),
  });
}
function notify(tx: Transaction, uid: string, teamId: string, message: string, target = '') {
  tx.create(db.collection('users').doc(uid).collection('team_notifications').doc(), {
    type: 'team_update',
    teamId,
    message,
    target,
    read: false,
    createdAt: new Date().toISOString(),
  });
}
function membershipIndex(teamId: string, team: TeamRecord, role: string) {
  return {
    teamId,
    name: team['name'],
    logoUrl: team['logo_url'] || '',
    slug: team['slug'],
    role,
    status: team['status'],
    creatorId: team['created_by'],
    ownerId: team['owner_id'],
  };
}
async function profile(uid: string): Promise<TeamRecord & { name: string }> {
  const [user, account] = await Promise.all([
    getAuth().getUser(uid),
    db.collection('users').doc(uid).get(),
  ]);
  return {
    ...currentTeamMemberIdentity(
      {
        name: user.displayName || user.email?.split('@')[0] || 'Team member',
        photo_url: teamUrl(user.photoURL),
      },
      account.data(),
    ),
    name:
      teamText(account.data()?.['displayName'], 100) ||
      user.displayName ||
      user.email?.split('@')[0] ||
      'Team member',
    uid,
    email: teamEmail(user.email),
    title: '',
    bio: '',
    public_email: '',
    public_phone: '',
    public_visible: false,
    status: 'active',
  };
}
function readOnlyInvite(inviteId: string, data: TeamRecord) {
  return invitationView(inviteId, data);
}

async function createTeam(request: CallableRequest, uid: string) {
  const data = request.data || {};
  const requestId = id(data.requestId);
  const name = teamText(data.name, 100);
  if (name.length < 2) fail('Enter a team name with at least two characters.');
  const slug = teamSlug(data.slug || name);
  if (
    slug.length < 3 ||
    ['new', 'invitations', 'settings', 'admin', 'public', 'support'].includes(slug)
  )
    fail('Choose a longer or different team page address.');
  const newId = hash(`${uid}:${requestId}`).slice(0, 32);
  const now = new Date().toISOString();
  const memberProfile = await profile(uid);
  return db.runTransaction(async (tx) => {
    const quota = db.collection('team_creation_quotas').doc(uid);
    const slugRef = db.collection('team_slugs').doc(slug);
    const [existing, user, quotaDoc, reserved] = await tx.getAll(
      teamRef(newId),
      db.collection('users').doc(uid),
      quota,
      slugRef,
    );
    if (existing.exists) return { teamId: newId };
    if (user.data()?.['role'] !== 'admin' && (quotaDoc.data()?.['team_ids'] || []).length)
      fail('Your account can create one team. You can still join other teams.');
    if (reserved.exists)
      throw new HttpsError('already-exists', 'That team page address is already taken.');
    const team = {
      name,
      slug,
      status: 'active',
      created_by: uid,
      owner_id: uid,
      description: '',
      about: '',
      logo_url: '',
      hero_url: '',
      hero_position: 50,
      accent: '#216b4c',
      website: '',
      contact_email: '',
      contact_phone: '',
      public_enabled: false,
      member_count: 1,
      listing_count: 0,
      created_at: now,
      updated_at: now,
      revision: 1,
      tracking_since: now,
    };
    tx.create(teamRef(newId), team);
    tx.create(memberRef(newId, uid), { ...memberProfile, role: 'admin', joined_at: now });
    tx.create(indexRef(uid, newId), membershipIndex(newId, team, 'admin'));
    tx.create(slugRef, { team_id: newId });
    tx.set(quota, { team_ids: FieldValue.arrayUnion(newId) }, { merge: true });
    audit(tx, newId, uid, 'team.created');
    return { teamId: newId };
  });
}

async function currentMemberProfiles(
  members: Array<{ uid: string } & TeamRecord>,
): Promise<Map<string, TeamRecord>> {
  if (!members.length) return new Map();
  const accounts = await db.getAll(
    ...members.map((member) => db.collection('users').doc(member.uid)),
  );
  return new Map(
    members.map((member, index) => [
      member.uid,
      currentTeamMemberIdentity(member, accounts[index].data()),
    ]),
  );
}

async function dashboard(teamId: string, uid: string) {
  const { team, member } = await requireTeamMember(teamId, uid);
  const [members, listings, invitations, activity] = await Promise.all([
    teamRef(teamId).collection('members').where('status', '==', 'active').get(),
    teamRef(teamId).collection('listings').get(),
    member['role'] === 'admin'
      ? db.collection('team_invitations').where('team_id', '==', teamId).get()
      : null,
    teamRef(teamId).collection('activity').orderBy('at', 'desc').limit(30).get(),
  ]);
  const identities = await currentMemberProfiles(
    members.docs.map((doc) => ({ ...doc.data(), uid: doc.id })),
  );
  return {
    team: { id: teamId, ...team },
    role: member['role'],
    members: members.docs.map((doc) => {
      const value = doc.data();
      return {
        ...teamMemberProjection(doc.id, identities.get(doc.id) || value),
        role: value['role'],
        publicVisible: value['public_visible'] === true,
        joinedAt: value['joined_at'],
        ...(member['role'] === 'admin' || doc.id === uid ? { email: value['email'] } : {}),
        voice: value['shared_voice'] || null,
      };
    }),
    listings: listings.docs.map((doc) => doc.data()),
    invitations: invitations?.docs.map((doc) => readOnlyInvite(doc.id, doc.data())) || [],
    activity: activity.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
  };
}

async function updateTeam(teamId: string, uid: string, data: TeamRecord) {
  return db.runTransaction(async (tx) => {
    const { team } = await requireTeamMember(teamId, uid, true, tx);
    active(team);
    if (data.revision !== team['revision'])
      throw new HttpsError('aborted', 'Team settings changed. Reload before saving.');
    const members = await tx.get(
      teamRef(teamId).collection('members').where('status', '==', 'active'),
    );
    const updated = applyTeamSettingsPatch(team, data);
    if (teamText(updated.name, 100).length < 2)
      fail('Enter a team name with at least two characters.');
    const next = {
      ...updated,
      revision: team['revision'] + 1,
      updated_at: new Date().toISOString(),
    };
    tx.set(teamRef(teamId), next);
    for (const doc of members.docs)
      tx.set(indexRef(doc.id, teamId), membershipIndex(teamId, next, doc.data()['role']));
    syncPublicPage(
      tx,
      teamId,
      next,
      members.docs.map((doc) => ({ uid: doc.id, ...doc.data() })),
    );
    audit(tx, teamId, uid, 'team.settings_updated');
    return { ok: true };
  });
}
function syncPublicPage(tx: Transaction, teamId: string, team: TeamRecord, members: TeamRecord[]) {
  const ref = db.collection('public_team_pages').doc(teamId);
  if (team['public_enabled'] && team['status'] === 'active') {
    tx.set(ref, {
      ...teamPageProjection(teamId, team),
      members: members
        .filter((m) => m['public_visible'] === true)
        .map((m) => teamMemberProjection(m['uid'], m)),
    });
  } else tx.delete(ref);
}

async function inviteMembers(teamId: string, uid: string, data: TeamRecord) {
  const rawEmails: string[] = Array.isArray(data.emails)
    ? data.emails
    : String(data.emails || '')
        .trim()
        .split(/[\s,;]+/)
        .filter(Boolean);
  if (!rawEmails.length || rawEmails.length > TEAM_MAX_INVITES_PER_REQUEST)
    fail('Invite between 1 and 30 people at a time.');
  const emails = [...new Set(rawEmails.map(teamEmail))];
  if (emails.includes('')) fail('One or more email addresses are invalid.');
  const role = data.role === 'admin' ? 'admin' : 'member';
  await requireTeamMember(teamId, uid, true);
  const inviter = await profile(uid);
  const now = Date.now();
  const entries = emails.map((email) => ({
    email,
    inviteId: hash(`${teamId}:${email}`),
    token: randomBytes(32).toString('hex'),
    jobId: randomUUID(),
  }));
  // Commit the whole batch before sending email. A rate-limit or resend conflict never leaves a half-created batch.
  const deliveries = await db.runTransaction(async (tx) => {
    const { team } = await requireTeamMember(teamId, uid, true, tx);
    active(team);
    const [members, rate, ...oldInvites] = await Promise.all([
      tx.get(teamRef(teamId).collection('members').where('status', '==', 'active')),
      tx.get(teamRef(teamId).collection('limits').doc('invitations')),
      ...entries.map((entry) => tx.get(db.collection('team_invitations').doc(entry.inviteId))),
    ]);
    const memberEmails = new Set(
      (members as FirebaseFirestore.QuerySnapshot).docs.map((doc) => doc.data()['email']),
    );
    const pending = entries.filter((entry) => !memberEmails.has(entry.email));
    const rateData = (rate as FirebaseFirestore.DocumentSnapshot).data();
    const day = new Date(now).toISOString().slice(0, 10);
    const count = rateData?.['day'] === day ? Number(rateData?.['count']) || 0 : 0;
    if (count + pending.length > 200)
      throw new HttpsError(
        'resource-exhausted',
        'The daily invitation limit has been reached. Try tomorrow.',
      );
    for (const entry of pending) {
      const previous = (
        oldInvites[entries.indexOf(entry)] as FirebaseFirestore.DocumentSnapshot
      ).data();
      if (previous?.['status'] === 'pending' && now - (previous['sent_at_ms'] || 0) < 60_000)
        fail('Wait a minute before resending this invitation.');
    }
    for (const entry of pending) {
      tx.set(db.collection('team_invitations').doc(entry.inviteId), {
        team_id: teamId,
        team_name: team['name'],
        email: entry.email,
        role,
        token_hash: hash(entry.token),
        status: 'pending',
        invited_by: uid,
        inviter_name: inviter.name,
        sent_at_ms: now,
        expires_at_ms: now + TEAM_INVITATION_LIFETIME_MS,
        delivery: 'queued',
      });
      tx.create(db.collection('team_invitation_emails').doc(entry.jobId), {
        invite_id: entry.inviteId,
        team_id: teamId,
        team_name: team['name'],
        inviter_name: inviter.name,
        email: entry.email,
        role,
        token: entry.token,
        token_hash: hash(entry.token),
        status: 'queued',
        attempts: 0,
        created_at: now,
        next_attempt_at: now,
        expires_at_ms: now + TEAM_INVITATION_LIFETIME_MS,
      });
      audit(tx, teamId, uid, 'member.invited', entry.inviteId);
    }
    tx.set(teamRef(teamId).collection('limits').doc('invitations'), {
      day,
      count: count + pending.length,
    });
    return pending.map((entry) => ({ ...entry, teamName: String(team['name']) }));
  });
  const results = deliveries.map((entry) => ({ email: entry.email, delivery: 'queued' }));
  return { invitations: results, alreadyMembers: emails.length - deliveries.length };
}

async function respondInvitation(request: CallableRequest, uid: string) {
  const inviteId = id(request.data.inviteId);
  const accept = request.data.accept === true;
  const user = await getAuth().getUser(uid);
  const email = teamEmail(user.email);
  if (!user.emailVerified) fail('Verify your email address before accepting a team invitation.');
  const memberProfile = await profile(uid);
  return db.runTransaction(async (tx) => {
    const ref = db.collection('team_invitations').doc(inviteId);
    const invite = (await tx.get(ref)).data();
    if (!invite || invite['email'] !== email)
      throw new HttpsError(
        'permission-denied',
        'Sign in with the email address this invitation was sent to.',
      );
    if (invite['status'] === 'accepted' && invite['accepted_by'] === uid)
      return { teamId: invite['team_id'], accepted: true };
    if (!validInvitation(invite, email, Date.now()))
      fail('This invitation is no longer available. Ask a team admin to resend it.');
    const teamId = invite['team_id'];
    const [teamDoc, existing] = await tx.getAll(teamRef(teamId), memberRef(teamId, uid));
    const team = teamDoc.data();
    if (!team) fail('This team is no longer available.');
    active(team!);
    if (
      accept &&
      team!['member_count'] >= TEAM_MAX_MEMBERS &&
      existing.data()?.['status'] !== 'active'
    )
      fail('This team has reached its member limit.');
    tx.update(ref, {
      status: accept ? 'accepted' : 'declined',
      accepted_by: uid,
      responded_at: new Date().toISOString(),
    });
    tx.set(invitationNotificationRef(uid, inviteId), {
      type: 'team_invitation',
      teamId,
      target: '',
      read: true,
      createdAt: new Date(invite['sent_at_ms'] || 0).toISOString(),
      message: `Invitation to ${invite['team_name']} ${accept ? 'accepted' : 'declined'}.`,
      invitation: { ...invitationView(inviteId, invite), status: accept ? 'accepted' : 'declined' },
    });
    if (accept && existing.data()?.['status'] !== 'active') {
      tx.set(memberRef(teamId, uid), {
        ...memberProfile,
        role: invite['role'],
        joined_at: new Date().toISOString(),
      });
      tx.set(indexRef(uid, teamId), membershipIndex(teamId, team!, invite['role']));
      tx.update(teamRef(teamId), { member_count: FieldValue.increment(1) });
      notify(tx, team!['owner_id'], teamId, `${memberProfile.name} joined the team.`);
      if (
        invite['invited_by'] &&
        invite['invited_by'] !== team!['owner_id'] &&
        invite['invited_by'] !== uid
      )
        notify(tx, invite['invited_by'], teamId, `${memberProfile.name} joined the team.`);
    }
    audit(tx, teamId, uid, accept ? 'invitation.accepted' : 'invitation.declined');
    return { teamId, accepted: accept };
  });
}

async function updateMember(teamId: string, uid: string, data: TeamRecord) {
  const targetUid = id(data.memberId || uid);
  const operation = data.operation || 'profile';
  return db.runTransaction(async (tx) => {
    const { team, member } = await requireTeamMember(
      teamId,
      uid,
      operation !== 'profile' && targetUid !== uid,
      tx,
    );
    active(team);
    const members = await tx.get(
      teamRef(teamId).collection('members').where('status', '==', 'active'),
    );
    const target = members.docs.find((doc) => doc.id === targetUid)?.data();
    if (!target) fail('This member is no longer on the team.');
    const all = members.docs.map((doc) => ({ uid: doc.id, ...doc.data() }));
    const ref = memberRef(teamId, targetUid);
    if (operation === 'profile') {
      if (targetUid !== uid && member['role'] !== 'admin')
        throw new HttpsError('permission-denied', 'You can only edit your own team profile.');
      const patch = {
        title: teamText(data.title, 100),
        bio: teamText(data.bio, 1000),
        public_visible: data.publicVisible === true,
        public_email: teamEmail(data.contactEmail),
        public_phone: teamText(data.contactPhone, 40),
      };
      // An admin may hide a member, but only that member can opt into public contact information.
      if (
        targetUid !== uid &&
        ((patch.public_visible && !target!['public_visible']) ||
          patch.public_email !== (target!['public_email'] || '') ||
          patch.public_phone !== (target!['public_phone'] || ''))
      )
        fail('Members must opt in to publishing their own profile and contact information.');
      tx.update(ref, patch);
      syncPublicPage(
        tx,
        teamId,
        team,
        all.map((m) => (m.uid === targetUid ? { ...m, ...patch } : m)),
      );
    } else if (operation === 'remove') {
      if (targetUid === team['owner_id'])
        fail('Transfer ownership before leaving or removing the team owner.');
      tx.update(ref, { status: 'removed', shared_voice: FieldValue.delete() });
      tx.delete(indexRef(targetUid, teamId));
      tx.update(teamRef(teamId), { member_count: FieldValue.increment(-1) });
      syncPublicPage(
        tx,
        teamId,
        team,
        all.filter((m) => m.uid !== targetUid),
      );
      notify(
        tx,
        targetUid,
        teamId,
        'Your team membership ended. Team listings remain with the team.',
      );
    } else if (operation === 'role') {
      if (member['role'] !== 'admin')
        throw new HttpsError('permission-denied', 'Only team admins can change roles.');
      if (targetUid === team['owner_id']) fail('The team owner must remain an admin.');
      const role = data.role === 'admin' ? 'admin' : 'member';
      tx.update(ref, { role });
      tx.set(indexRef(targetUid, teamId), membershipIndex(teamId, team, role));
      notify(tx, targetUid, teamId, `Your team role is now ${role}.`);
    } else if (operation === 'transfer') {
      if (team['owner_id'] !== uid)
        throw new HttpsError('permission-denied', 'Only the owner can transfer ownership.');
      tx.update(teamRef(teamId), { owner_id: targetUid, revision: FieldValue.increment(1) });
      tx.update(ref, { role: 'admin' });
      for (const m of all)
        tx.set(
          indexRef(m.uid, teamId),
          membershipIndex(
            teamId,
            { ...team, owner_id: targetUid },
            m.uid === targetUid ? 'admin' : (m as TeamRecord)['role'],
          ),
        );
      notify(tx, targetUid, teamId, 'You are now the team owner.');
    } else fail('Unknown membership operation.');
    audit(tx, teamId, uid, `member.${operation}`, targetUid);
    return { ok: true };
  });
}

const PROTECTED_BOARD_KEYS = new Set([
  'id',
  'team_id',
  'team_revision',
  'team_status',
  'published_revision',
  'owner_user_id',
  'owner_public_slug',
  'owner_display_name',
  'owner_photo_url',
  'owner_profile_icon',
  'owner_profile_picture_type',
  'visibility',
  'created_by',
  'representative_id',
  'last_editor_id',
  'voice_owner_id',
  'voice_id',
  'voice_revision',
  'voice_name',
  'created_at_iso',
  'updated_at_iso',
  'server_updated_at',
  'atlas_id',
  'generated_for_atlas_id',
  'custom_slug',
  'like_count',
  'teamId',
  'teamRevision',
  'teamStatus',
  'teamDraft',
  'teamVoiceName',
  'representativeId',
  'voiceOwnerId',
  'voiceId',
  'voiceRevision',
  'publishedRevision',
  'ownerUserId',
  'ownerPublicSlug',
  'ownerDisplayName',
  'ownerPhotoUrl',
  'ownerProfileIcon',
  'ownerProfilePictureType',
  'createdAt',
  'updatedAt',
  'atlasId',
  'generatedForAtlasId',
  'parentBoardId',
  'parentCardId',
  'forkedFromBoardId',
  'forkedFromOwnerUserId',
  'last_save_key',
  'imported_from',
  'reserved_custom_slug',
]);
function boardContent(value: unknown): TeamRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Invalid listing.');
  const input = value as TeamRecord;
  if (Buffer.byteLength(JSON.stringify(input), 'utf8') > 850_000)
    fail('This listing is too large to save.');
  const clean = Object.fromEntries(
    Object.entries(input).filter(([key]) => !PROTECTED_BOARD_KEYS.has(key) && !key.startsWith('_')),
  );
  const title = teamText(clean['title'], 90);
  if (!title) fail('Give your listing a title.');
  const cards = clean['cards'];
  if (!Array.isArray(cards) || cards.length > 200) fail('A listing can contain up to 200 cards.');
  if (new Set(cards.map((card: TeamRecord) => id(card.id))).size !== cards.length)
    fail('Each card must have a unique identifier.');
  // Cross-board references are not a sharing grant. Nest related cards in this listing instead.
  function check(items: TeamRecord[], depth: number) {
    if (depth > 8) fail('This listing has too many nested cards.');
    for (const card of items) {
      if (card['childBoardId'])
        fail('Linked child boards must be copied into this listing before sharing with a team.');
      if (Array.isArray(card['relatedCards'])) check(card['relatedCards'], depth + 1);
    }
  }
  check(cards, 0);
  return { ...clean, title };
}

async function saveListing(teamId: string, uid: string, data: TeamRecord, kiwiActionId = '') {
  const boardId = id(data.boardId);
  const incoming = boardContent(data.board);
  const saveKey = hash(`${uid}:${data.revision || 0}:${JSON.stringify(incoming)}`);
  validateMediaScope(incoming, teamId);
  return db.runTransaction(async (tx) => {
    const { team } = await requireTeamMember(teamId, uid, false, tx);
    active(team);
    const kiwiRef = kiwiActionId ? db.collection('users').doc(uid).collection('kiwi_actions').doc(kiwiActionId) : null;
    const kiwiDoc = kiwiRef ? await tx.get(kiwiRef) : null;
    const [currentDoc, deleted] = await tx.getAll(
      listingRef(boardId),
      db.collection('team_deleted_listings').doc(boardId),
    );
    if (deleted.exists) fail('This listing was permanently deleted. Create a new listing instead.');
    const current = currentDoc.data();
    if (kiwiRef && kiwiDoc?.data()?.['status'] === 'applied') return { board: current };
    if (kiwiRef && kiwiDoc?.data()?.['status'] !== 'pending')
      throw new HttpsError('failed-precondition', 'This Kiwi proposal is no longer pending.');
    const baseRef = listingRef(boardId)
      .collection('revisions')
      .doc(String(Number(data.revision) || 0));
    const baseDoc =
      current && current['team_revision'] !== data.revision ? await tx.get(baseRef) : null;
    const publicDoc = !current ? await tx.get(db.collection('boards').doc(boardId)) : null;
    if (current && current['team_id'] !== teamId)
      throw new HttpsError('permission-denied', 'This listing belongs to a different team.');
    if (current?.['last_save_key'] === saveKey) {
      if (kiwiRef) tx.update(kiwiRef, { status: 'applied', appliedAt: FieldValue.serverTimestamp() });
      return { board: current };
    }
    if (!current && publicDoc?.exists)
      fail('This board already exists. Use the explicit transfer action.');
    if (current?.['team_status'] === 'archived') fail('Restore this listing before editing.');
    if (current && data.revision === undefined) fail('Reload the listing before saving.');
    let content = incoming;
    if (current && current['team_revision'] !== data.revision) {
      if (data.requireExactRevision === true) {
        throw new HttpsError('aborted', 'The listing changed after review. Rescan before applying the copy repair.');
      }
      if (!baseDoc?.exists)
        throw new HttpsError(
          'aborted',
          'The listing changed. Reload it; your unsaved work has not been overwritten.',
        );
      try {
        content = mergeTeamBoard(boardContent(current), boardContent(baseDoc.data()), incoming);
      } catch {
        throw new HttpsError(
          'aborted',
          'A colleague changed the same card or setting. Your unsaved work is preserved; reload before applying it.',
        );
      }
    }
    const now = new Date().toISOString();
    const revision = (current?.['team_revision'] || 0) + 1;
    const next = {
      ...current,
      ...content,
      id: boardId,
      team_id: teamId,
      team_revision: revision,
      last_save_key: saveKey,
      team_status: current?.['team_status'] || 'draft',
      published_revision: current?.['published_revision'] || 0,
      owner_user_id: `team:${teamId}`,
      owner_display_name: team['name'],
      owner_public_slug: '',
      owner_photo_url: team['logo_url'] || '',
      visibility: 'private',
      created_by: current?.['created_by'] || uid,
      representative_id: current?.['representative_id'] || uid,
      created_at_iso: current?.['created_at_iso'] || now,
      updated_at_iso: now,
      last_editor_id: uid,
      // Voice selection is a separate capability-checked operation; payloads cannot grant themselves a voice.
      stackNarratorVoiceId: current?.['stackNarratorVoiceId'] || 'warm-storyteller',
      voice_owner_id: current?.['voice_owner_id'] || '',
      voice_id: current?.['voice_id'] || '',
      voice_revision: current?.['voice_revision'] || 0,
      voice_name: current?.['voice_name'] || 'System voice',
    };
    tx.set(listingRef(boardId), next);
    tx.create(listingRef(boardId).collection('revisions').doc(String(revision)), next);
    tx.set(teamRef(teamId).collection('listings').doc(boardId), teamListingSummary(next));
    if (!current) tx.update(teamRef(teamId), { listing_count: FieldValue.increment(1) });
    audit(tx, teamId, uid, current ? 'listing.saved' : 'listing.created', boardId);
    if (kiwiRef) tx.update(kiwiRef, { status: 'applied', appliedAt: FieldValue.serverTimestamp() });
    return { board: next };
  });
}

/** Long-running generation jobs recheck membership and merge against the revision they started with. */
export async function saveGeneratedTeamBoard(uid: string, board: TeamRecord, patch: TeamRecord) {
  return saveListing(board['team_id'], uid, {
    boardId: board['id'],
    revision: board['team_revision'],
    board: { ...board, ...patch },
  });
}

/** Kiwi uses the same membership, revision, media, and audit path as the team editor. */
export async function saveKiwiTeamBoard(
  uid: string,
  teamId: string,
  boardId: string,
  board: TeamRecord,
  revision = 0,
  kiwiActionId = '',
) {
  return saveListing(teamId, uid, { boardId, board, revision, requireExactRevision: true }, kiwiActionId);
}

/** Operator-reviewed copy repair uses normal membership, history and idempotency. */
export async function saveReviewedTeamBoardCopy(uid: string, board: TeamRecord, patch: TeamRecord) {
  return saveListing(board['team_id'], uid, {
    boardId: board['id'], revision: board['team_revision'], requireExactRevision: true,
    board: { ...board, ...patch },
  });
}

function privateTombstone(board: TeamRecord): TeamRecord {
  return {
    id: board['id'],
    team_id: board['team_id'],
    owner_user_id: `team:${board['team_id']}`,
    visibility: 'private',
    title: board['title'],
    cards: [],
    ...(board['reserved_custom_slug'] ? { custom_slug: board['reserved_custom_slug'] } : {}),
  };
}

async function listingAction(teamId: string, uid: string, data: TeamRecord) {
  const boardId = id(data.boardId);
  // A distinct operation fails safely against older deployed servers rather
  // than silently ignoring the audience and publishing an unlisted request.
  const operation = data.operation === 'publishUnlisted' ? 'publish' : data.operation;
  let publicMedia: TeamRecord | null = null;
  let publishedVisibility: 'public' | 'unlisted' = 'public';
  if (operation === 'publish') {
    if (data.visibility !== undefined && !['public', 'unlisted'].includes(data.visibility))
      fail('Choose Public or Unlisted before publishing. Use Unpublish to make a listing private.');
    if (data.operation === 'publishUnlisted' && data.visibility !== undefined && data.visibility !== 'unlisted')
      fail('Unlisted publication requires the Unlisted audience.');
    const { team, member } = await requireTeamMember(teamId, uid);
    active(team);
    const source = (await listingRef(boardId).get()).data();
    if (!source || source['team_id'] !== teamId || source['team_revision'] !== data.revision)
      throw new HttpsError('aborted', 'The listing changed. Refresh before publishing.');
    if (!canPublishTeamListing(member['role'], uid, source))
      throw new HttpsError('permission-denied', 'Only the representative or an admin can publish.');
    // Older clients updating an unlisted listing must preserve its audience.
    publishedVisibility = data.operation === 'publishUnlisted' ? 'unlisted'
      : data.visibility || (source['published_visibility'] === 'unlisted' ? 'unlisted' : 'public');
    await validatePublicConversations(source['cards'] || []);
    // Copies are immutable and prepared outside the transaction; authorization and revision are rechecked before exposure.
    publicMedia = await publishMedia(
      publicTeamBoard(source, teamId, team, new Date().toISOString(), publishedVisibility),
      teamId,
      boardId,
    );
  }
  const result = await db.runTransaction(async (tx) => {
    const { team, member } = await requireTeamMember(teamId, uid, false, tx);
    active(team);
    const doc = await tx.get(listingRef(boardId));
    const board = doc.data();
    if (!board && operation === 'delete' && member['role'] === 'admin') {
      const deleted = await tx.get(db.collection('team_deleted_listings').doc(boardId));
      if (deleted.data()?.['team_id'] === teamId) return { ok: true };
    }
    if (!board || board['team_id'] !== teamId)
      throw new HttpsError('not-found', 'Listing not found.');
    if (board['team_revision'] !== data.revision)
      throw new HttpsError('aborted', 'This listing changed. Refresh before continuing.');
    if (
      ['publish', 'unpublish'].includes(operation) &&
      !canPublishTeamListing(member['role'], uid, board)
    )
      throw new HttpsError(
        'permission-denied',
        'Only the assigned representative or an admin can publish this listing.',
      );
    if (
      ['archive', 'restore', 'assign', 'delete'].includes(operation) &&
      member['role'] !== 'admin'
    )
      throw new HttpsError('permission-denied', 'Only team admins can do that.');
    const now = new Date().toISOString();
    const next: TeamRecord = { ...board, updated_at_iso: now, last_editor_id: uid };
    let published: TeamRecord | null = null;
    if (operation === 'publish') {
      if (!board['cards']?.length) fail('Add at least one card before publishing.');
      if (board['team_status'] === 'archived') fail('Restore this listing before publishing.');
      if (board['voice_owner_id'])
        await requireVoiceGrant(
          teamId,
          board['voice_owner_id'],
          board['voice_id'],
          board['voice_revision'],
          tx,
        );
      next['team_status'] = 'published';
      next['published_revision'] = board['team_revision'];
      next['published_visibility'] = publishedVisibility;
      published = {
        ...publicMedia,
        ...publicTeamBoard({ ...next, ...publicMedia }, teamId, team, now, publishedVisibility),
      };
    } else if (operation === 'unpublish') next['team_status'] = 'unpublished';
    else if (operation === 'archive') next['team_status'] = 'archived';
    else if (operation === 'restore') next['team_status'] = 'draft';
    else if (operation === 'assign') {
      const repId = id(data.representativeId);
      const representative = (await tx.get(memberRef(teamId, repId))).data();
      if (representative?.['status'] !== 'active') fail('Choose an active team member.');
      next['representative_id'] = repId;
      notify(tx, repId, teamId, `You are now the representative for ${board['title']}.`, boardId);
    } else if (operation === 'delete') {
      if (board['team_status'] !== 'archived')
        fail('Archive this listing before permanently deleting it.');
      tx.delete(listingRef(boardId));
      tx.delete(teamRef(teamId).collection('listings').doc(boardId));
      tx.set(db.collection('team_deleted_listings').doc(boardId), { team_id: teamId });
      tx.set(
        db.collection('boards').doc(boardId),
        privateTombstone({ ...board, title: 'Unavailable listing' }),
      );
      tx.delete(db.collection('public_team_listings').doc(boardId));
      tx.delete(db.collection('team_published_configs').doc(boardId));
      tx.update(teamRef(teamId), { listing_count: FieldValue.increment(-1) });
      audit(tx, teamId, uid, 'listing.deleted', boardId);
      return { ok: true };
    } else fail('Unknown listing action.');
    if (operation !== 'publish') {
      next['team_revision']++;
      tx.set(listingRef(boardId).collection('revisions').doc(String(next['team_revision'])), next);
    }
    tx.set(listingRef(boardId), next);
    tx.set(teamRef(teamId).collection('listings').doc(boardId), teamListingSummary(next));
    if (published) {
      tx.set(db.collection('boards').doc(boardId), published);
      tx.set(db.collection('team_published_configs').doc(boardId), {
        team_id: teamId,
        voice_owner_id: next['voice_owner_id'] || '',
        voice_id: next['voice_id'] || '',
        voice_revision: next['voice_revision'] || 0,
        representative_id: next['representative_id'],
        revision: next['published_revision'],
      });
      if (publishedVisibility === 'public') tx.set(db.collection('public_team_listings').doc(boardId), {
        teamId,
        id: boardId,
        title: published['title'],
        description: published['description'] || '',
        imageUrl: published['imageUrl'] || '',
        representativeId: next['representative_id'],
        updatedAt: now,
      });
      else tx.delete(db.collection('public_team_listings').doc(boardId));
    } else if (['unpublish', 'archive', 'restore'].includes(operation)) {
      tx.set(db.collection('boards').doc(boardId), privateTombstone(next));
      tx.delete(db.collection('public_team_listings').doc(boardId));
      tx.delete(db.collection('team_published_configs').doc(boardId));
    }
    audit(tx, teamId, uid, `listing.${operation}`, boardId);
    return { ok: true };
  });
  if (operation === 'delete') {
    await db.recursiveDelete(listingRef(boardId).collection('revisions'));
    for (const name of ['team_contacts', 'team_conversations', 'team_voice_sessions']) {
      const records = await db
        .collection(name)
        .where('teamId', '==', teamId)
        .where('boardId', '==', boardId)
        .get();
      for (const record of records.docs) await db.recursiveDelete(record.ref);
    }
    // Private uploads can be shared by other listings in this team. Retain them
    // until team deletion; only this listing's independent public copies are removed.
    await storage.bucket().deleteFiles({ prefix: `public-team-media/${teamId}/${boardId}/` });
  }
  return result;
}

export async function requireVoiceGrant(
  teamId: string,
  ownerId: string,
  voiceId: string,
  revision: number,
  tx?: Transaction,
) {
  const ref = memberRef(teamId, ownerId);
  const member = (tx ? await tx.get(ref) : await ref.get()).data();
  const voice = member?.['shared_voice'];
  if (
    member?.['status'] !== 'active' ||
    !voice ||
    voice['id'] !== voiceId ||
    voice['revision'] !== revision
  )
    fail('This voice is no longer shared with the team. Choose another voice or the system voice.');
  const voiceRef = db
    .collection('user_narrator_voices')
    .doc(ownerId)
    .collection('voices')
    .doc(voiceId);
  const original = (tx ? await tx.get(voiceRef) : await voiceRef.get()).data();
  if (
    !original ||
    original['status'] !== 'ready' ||
    Number(original['voice_revision'] || 1) !== revision
  )
    fail('This voice has changed or is no longer ready. Its owner needs to share it again.');
  return voice as TeamRecord;
}

function validateMediaScope(value: unknown, teamId: string): void {
  if (
    typeof value === 'string' &&
    value.startsWith('team-media:') &&
    !value.startsWith(`team-media:team-media/${teamId}/`)
  )
    throw new HttpsError(
      'permission-denied',
      'Media from another team cannot be attached to this listing.',
    );
  if (Array.isArray(value)) value.forEach((item) => validateMediaScope(item, teamId));
  else if (value && typeof value === 'object')
    Object.values(value).forEach((item) => validateMediaScope(item, teamId));
}
async function publishMedia<T>(value: T, teamId: string, boardId: string): Promise<T> {
  if (typeof value === 'string' && value.startsWith('team-media:')) {
    validateMediaScope(value, teamId);
    const path = value.slice('team-media:'.length);
    const destination = `public-team-media/${teamId}/${boardId}/${hash(path)}`;
    const bucket = storage.bucket();
    await bucket.file(path).copy(bucket.file(destination));
    await bucket.file(destination).setMetadata({
      cacheControl: 'no-cache,max-age=0',
      metadata: { firebaseStorageDownloadTokens: '' },
    });
    return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(destination)}?alt=media` as T;
  }
  if (Array.isArray(value))
    return (await Promise.all(value.map((item) => publishMedia(item, teamId, boardId)))) as T;
  if (value && typeof value === 'object')
    return Object.fromEntries(
      await Promise.all(
        Object.entries(value).map(async ([key, item]) => [
          key,
          await publishMedia(item, teamId, boardId),
        ]),
      ),
    ) as T;
  return value;
}
async function validatePublicConversations(cards: TeamRecord[]): Promise<void> {
  for (const card of cards) {
    if (card['authorOnly']) continue;
    const atlasId = card['conversation']?.['atlasId'];
    if (atlasId) {
      const atlas = (await db.collection('atlases').doc(id(atlasId)).get()).data();
      if (atlas?.['is_public'] !== true)
        fail(
          'Publish the Talking Card avatar, or remove it from this listing, before publishing. Private knowledge is never shared implicitly.',
        );
    }
    if (Array.isArray(card['relatedCards']))
      await validatePublicConversations(card['relatedCards']);
  }
}

async function wizardAction(teamId: string, uid: string, data: TeamRecord) {
  const draftId = id(data.draftId);
  const ref = teamRef(teamId).collection('wizard_drafts').doc(draftId);
  return db.runTransaction(async (tx) => {
    const { team, member } = await requireTeamMember(teamId, uid, false, tx);
    active(team);
    const previous = (await tx.get(ref)).data();
    if (data.operation === 'delete') {
      const completed = data.completedBoardId
        ? (await tx.get(listingRef(id(data.completedBoardId)))).data()
        : null;
      const savedByMember = completed?.['team_id'] === teamId && completed?.['id'] === draftId;
      if (
        previous &&
        previous['owner_user_id'] !== uid &&
        member['role'] !== 'admin' &&
        !savedByMember
      )
        fail('Only the draft creator or an admin can discard a team wizard draft.');
      tx.delete(ref);
      return { revision: 0 };
    }
    if (previous && data.revision !== previous['revision'])
      throw new HttpsError(
        'aborted',
        'A teammate changed this wizard draft. Reopen it before saving.',
      );
    const payload = data.draft;
    if (!payload || Buffer.byteLength(JSON.stringify(payload), 'utf8') > 800_000)
      fail('This wizard draft is too large.');
    validateMediaScope(payload, teamId);
    const revision = (previous?.['revision'] || 0) + 1;
    tx.set(ref, {
      ...payload,
      id: draftId,
      team_id: teamId,
      revision,
      owner_user_id: previous?.['owner_user_id'] || uid,
      updated_at_iso: new Date().toISOString(),
      last_editor_id: uid,
    });
    return { revision };
  });
}

async function lifecycle(teamId: string, uid: string, data: TeamRecord) {
  const operation = data.operation;
  if (!['archive', 'restore', 'delete'].includes(operation)) fail('Unknown team lifecycle action.');
  let original: TeamRecord = {};
  await db.runTransaction(async (tx) => {
    const current = (await tx.get(teamRef(teamId))).data();
    if (!current || current['owner_id'] !== uid)
      throw new HttpsError(
        'permission-denied',
        'Only the team owner can archive, restore, or delete the team.',
      );
    if (
      operation === 'delete' &&
      (data.confirmName !== current['name'] ||
        !['archived', 'deleting'].includes(current['status']))
    )
      fail('Archive the team first, then type its exact name to permanently delete it.');
    if (operation === 'restore' && current['status'] !== 'archived')
      fail('Only archived teams can be restored.');
    if (operation === 'archive' && !['active', 'archived', 'archiving'].includes(current['status']))
      fail('This team is being deleted.');
    original = current;
    tx.update(teamRef(teamId), {
      status:
        operation === 'restore' ? 'active' : operation === 'delete' ? 'deleting' : 'archiving',
      public_enabled: false,
      revision: FieldValue.increment(1),
      updated_at: new Date().toISOString(),
    });
    tx.delete(db.collection('public_team_pages').doc(teamId));
    audit(tx, teamId, uid, `team.${operation}`);
  });
  const members = await teamRef(teamId).collection('members').get();
  if (operation !== 'restore') {
    const listings = await db.collection('team_boards').where('team_id', '==', teamId).get();
    for (const listing of listings.docs) {
      const batch = db.batch();
      if (operation === 'delete')
        batch.set(
          db.collection('boards').doc(listing.id),
          privateTombstone({ ...listing.data(), title: 'Unavailable listing' }),
        );
      else batch.set(db.collection('boards').doc(listing.id), privateTombstone(listing.data()));
      batch.delete(db.collection('public_team_listings').doc(listing.id));
      batch.delete(db.collection('team_published_configs').doc(listing.id));
      if (operation === 'archive') {
        const next = {
          ...listing.data(),
          team_status:
            listing.data()['team_status'] === 'published'
              ? 'unpublished'
              : listing.data()['team_status'],
          team_revision: listing.data()['team_revision'] + 1,
          updated_at_iso: new Date().toISOString(),
        };
        batch.set(listing.ref, next);
        batch.set(teamRef(teamId).collection('listings').doc(listing.id), teamListingSummary(next));
        batch.set(listing.ref.collection('revisions').doc(String(next.team_revision)), next);
      }
      await batch.commit();
      if (operation === 'delete') await db.recursiveDelete(listing.ref);
    }
  }
  const finalTeam = { ...original, status: operation === 'restore' ? 'active' : 'archived' };
  for (const member of members.docs) {
    if (operation === 'delete' || member.data()['status'] !== 'active')
      await indexRef(member.id, teamId).delete();
    else
      await indexRef(member.id, teamId).set(
        membershipIndex(teamId, finalTeam, member.data()['role']),
      );
  }
  if (operation === 'delete') {
    // Deletion is scoped to validated team IDs, never to a user's personal collections or media.
    for (const [collection, field] of [
      ['team_invitations', 'team_id'],
      ['team_contacts', 'teamId'],
      ['team_contact_stats', 'teamId'],
      ['team_conversations', 'teamId'],
      ['team_analytics_daily', 'teamId'],
      ['team_participants', 'teamId'],
      ['team_voice_sessions', 'teamId'],
    ]) {
      const docs = await db.collection(collection).where(field, '==', teamId).get();
      for (const doc of docs.docs) await db.recursiveDelete(doc.ref);
    }
    await storage.bucket().deleteFiles({ prefix: `team-media/${teamId}/` });
    await storage.bucket().deleteFiles({ prefix: `team-branding/${teamId}/` });
    await storage.bucket().deleteFiles({ prefix: `public-team-media/${teamId}/` });
    // Keep the lifecycle tombstone until quota release succeeds, so retries can finish cleanup.
    for (const collection of await teamRef(teamId).listCollections())
      await db.recursiveDelete(collection);
    await db.runTransaction(async (tx) => {
      tx.set(
        db.collection('team_creation_quotas').doc(original['created_by']),
        { team_ids: FieldValue.arrayRemove(teamId) },
        { merge: true },
      );
      // Slug remains reserved as a tombstone so old links cannot be hijacked by another team.
      tx.set(db.collection('team_slugs').doc(original['slug']), { team_id: teamId, deleted: true });
      tx.delete(teamRef(teamId));
    });
  } else await teamRef(teamId).update({ status: finalTeam.status });
  return { ok: true };
}

async function transferListing(teamId: string, uid: string, data: TeamRecord) {
  const sourceId = id(data.boardId);
  const copy = data.operation === 'copy';
  if (!copy && data.operation !== 'move') fail('Choose move or copy.');
  const destinationId = copy
    ? hash(`${teamId}:${uid}:${id(data.requestId)}`).slice(0, 32)
    : sourceId;
  await requireTeamMember(teamId, uid);
  const preparedSource = (await db.collection('boards').doc(sourceId).get()).data();
  if (preparedSource?.['owner_user_id'] !== uid || preparedSource?.['team_id']) {
    const previous = (await listingRef(destinationId).get()).data();
    if (previous?.['team_id'] === teamId && previous?.['imported_from'] === sourceId)
      return { boardId: destinationId };
    throw new HttpsError('permission-denied', 'Only the personal owner can transfer a listing.');
  }
  if (preparedSource['updated_at_iso'] !== data.updatedAt)
    throw new HttpsError(
      'aborted',
      'This personal listing changed. Reload before transferring it.',
    );
  // Copy owned uploads into the team's immutable, private namespace before committing ownership.
  const transferable = boardContent(preparedSource);
  // Generated videos may contain a personal voice that was never shared with this team.
  for (const field of [
    'socialVideoUrl',
    'socialLandscapeVideoUrl',
    'trailerVideoUrl',
    'trailerLandscapeVideoUrl',
  ])
    transferable[field] = '';
  const preparedContent = await importOwnedMedia(transferable, uid, teamId, destinationId);
  return db.runTransaction(async (tx) => {
    const { team } = await requireTeamMember(teamId, uid, false, tx);
    active(team);
    const [sourceDoc, existing, deleted] = await tx.getAll(
      db.collection('boards').doc(sourceId),
      listingRef(destinationId),
      db.collection('team_deleted_listings').doc(destinationId),
    );
    if (deleted.exists) fail('This listing was permanently deleted. Make a new copy instead.');
    if (existing.exists) {
      if (
        existing.data()?.['team_id'] === teamId &&
        existing.data()?.['imported_from'] === sourceId
      )
        return { boardId: destinationId };
      fail('A listing with this identifier already exists.');
    }
    const source = sourceDoc.data();
    if (!source || source['owner_user_id'] !== uid || source['team_id'])
      throw new HttpsError('permission-denied', 'Only the personal owner can transfer a listing.');
    if (source['updated_at_iso'] !== data.updatedAt)
      throw new HttpsError(
        'aborted',
        'This personal listing changed. Reload before transferring it.',
      );
    const isListing = (source['cards'] || []).some((card: TeamRecord) =>
      (card['tags'] || []).includes('real-estate'),
    );
    if (!isListing) fail('Only real estate TalkThru boards can be added to a team.');
    const content = preparedContent;
    // Sharing a linked child or private knowledge source is never inferred from moving the parent.
    if (source['parentBoardId'] || source['parentCardId'])
      fail('Transfer the root listing, not an individual nested board.');
    const remap = (cards: TeamRecord[]): TeamRecord[] =>
      cards.map((card) => ({
        ...card,
        ...(copy ? { id: randomUUID() } : {}),
        ...(Array.isArray(card['relatedCards'])
          ? { relatedCards: remap(card['relatedCards']) }
          : {}),
      }));
    const now = new Date().toISOString();
    const next = {
      ...content,
      id: destinationId,
      cards: remap(content['cards']),
      team_id: teamId,
      team_revision: 1,
      published_revision: 0,
      team_status: 'draft',
      owner_user_id: `team:${teamId}`,
      owner_display_name: team['name'],
      owner_photo_url: team['logo_url'],
      owner_public_slug: '',
      created_by: uid,
      representative_id: uid,
      last_editor_id: uid,
      imported_from: sourceId,
      reserved_custom_slug: !copy ? source['custom_slug'] || '' : '',
      visibility: 'private',
      created_at_iso: copy ? now : source['created_at_iso'],
      updated_at_iso: now,
      stackNarratorVoiceId: 'warm-storyteller',
      voice_owner_id: '',
      voice_id: '',
      voice_revision: 0,
      voice_name: 'System voice',
      socialVideoUrl: '',
      socialLandscapeVideoUrl: '',
      trailerVideoUrl: '',
      trailerLandscapeVideoUrl: '',
    };
    tx.create(listingRef(destinationId), next);
    tx.create(listingRef(destinationId).collection('revisions').doc('1'), next);
    tx.create(teamRef(teamId).collection('listings').doc(destinationId), teamListingSummary(next));
    tx.update(teamRef(teamId), { listing_count: FieldValue.increment(1) });
    if (!copy) {
      // Keep the original document ID and custom-route aliases reserved while its working copy becomes private.
      tx.set(sourceDoc.ref, {
        id: sourceId,
        team_id: teamId,
        owner_user_id: `team:${teamId}`,
        visibility: 'private',
        title: source['title'],
        cards: [],
        ...(source['custom_slug'] ? { custom_slug: source['custom_slug'] } : {}),
      });
      tx.delete(db.collection('public_board_summaries').doc(sourceId));
    }
    audit(
      tx,
      teamId,
      uid,
      copy ? 'listing.copied_from_personal' : 'listing.moved_from_personal',
      destinationId,
    );
    return { boardId: destinationId };
  });
}

async function importOwnedMedia<T>(
  value: T,
  uid: string,
  teamId: string,
  boardId: string,
): Promise<T> {
  if (typeof value === 'string' && value.startsWith('https://firebasestorage.googleapis.com/')) {
    const url = new URL(value);
    const parts = url.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/);
    const bucket = storage.bucket();
    const path = parts ? decodeURIComponent(parts[2]) : '';
    if (
      parts &&
      decodeURIComponent(parts[1]) === bucket.name &&
      path.startsWith(`users/${uid}/boards/`)
    ) {
      const source = bucket.file(path);
      const [metadata] = await source.getMetadata();
      if (
        !/^image\/(jpeg|png|webp|gif|avif)$/.test(metadata.contentType || '') ||
        Number(metadata.size) > 10 * 1024 * 1024
      )
        fail(
          'An uploaded listing image cannot be transferred. Replace it with a supported image first.',
        );
      const target = `team-media/${teamId}/${boardId}/${hash(`${path}:${metadata.generation}`)}`;
      await source.copy(bucket.file(target));
      await bucket.file(target).setMetadata({
        cacheControl: 'private,no-store',
        metadata: { firebaseStorageDownloadTokens: '' },
      });
      return `team-media:${target}` as T;
    }
  }
  if (Array.isArray(value))
    return (await Promise.all(
      value.map((item) => importOwnedMedia(item, uid, teamId, boardId)),
    )) as T;
  if (value && typeof value === 'object')
    return Object.fromEntries(
      await Promise.all(
        Object.entries(value).map(async ([key, item]) => [
          key,
          await importOwnedMedia(item, uid, teamId, boardId),
        ]),
      ),
    ) as T;
  return value;
}

async function voiceAction(teamId: string, uid: string, data: TeamRecord) {
  return db.runTransaction(async (tx) => {
    const { team } = await requireTeamMember(teamId, uid, false, tx);
    active(team);
    if (data.operation === 'share') {
      if (data.consent !== true) fail('Confirm that this team may use your selected voice.');
      const voiceId = id(data.voiceId);
      const raw = (
        await tx.get(
          db.collection('user_narrator_voices').doc(uid).collection('voices').doc(voiceId),
        )
      ).data();
      if (!raw || raw['status'] !== 'ready')
        throw new HttpsError(
          'failed-precondition',
          'Choose a ready voice from your personal library.',
        );
      const grant = {
        id: voiceId,
        name: teamText(raw['name'], 80),
        revision: raw['voice_revision'] || raw['voiceRevision'] || 1,
        sharedAt: new Date().toISOString(),
      };
      tx.update(memberRef(teamId, uid), { shared_voice: grant });
      audit(tx, teamId, uid, 'voice.shared', voiceId);
    } else if (data.operation === 'revoke') {
      tx.update(memberRef(teamId, uid), { shared_voice: FieldValue.delete() });
      audit(tx, teamId, uid, 'voice.revoked');
    } else if (data.operation === 'select') {
      const boardId = id(data.boardId);
      const board = (await tx.get(listingRef(boardId))).data();
      if (!board || board['team_id'] !== teamId)
        throw new HttpsError('not-found', 'Listing not found.');
      if (board['team_revision'] !== data.revision)
        throw new HttpsError('aborted', 'The listing changed. Refresh before selecting a voice.');
      const ownerId = data.ownerId ? id(data.ownerId) : '';
      const voiceId = ownerId ? id(data.voiceId) : '';
      const grant = ownerId
        ? await requireVoiceGrant(teamId, ownerId, voiceId, data.voiceRevision, tx)
        : null;
      const next = {
        ...board,
        voice_owner_id: ownerId,
        voice_id: voiceId,
        voice_revision: grant?.['revision'] || 0,
        voice_name: grant?.['name'] || 'System voice',
        stackNarratorVoiceId: voiceId ? `personal-voice:${voiceId}` : 'warm-storyteller',
        team_revision: board['team_revision'] + 1,
        updated_at_iso: new Date().toISOString(),
        last_editor_id: uid,
      };
      tx.set(listingRef(boardId), next);
      tx.set(listingRef(boardId).collection('revisions').doc(String(next.team_revision)), next);
      tx.set(teamRef(teamId).collection('listings').doc(boardId), teamListingSummary(next));
      audit(tx, teamId, uid, 'listing.voice_selected', boardId);
    } else fail('Unknown voice action.');
    return { ok: true };
  });
}

export const teamCommand = onCall({ ...options, timeoutSeconds: 120 }, async (request) => {
  const uid = actor(request);
  const data = request.data || {};
  const action = data.action;
  if (action === 'create') return createTeam(request, uid);
  if (action === 'allowance') {
    const [quota, user] = await db.getAll(
      db.collection('team_creation_quotas').doc(uid),
      db.collection('users').doc(uid),
    );
    return {
      canCreate: user.data()?.['role'] === 'admin' || !(quota.data()?.['team_ids'] || []).length,
    };
  }
  if (action === 'inbox') {
    const user = await getAuth().getUser(uid);
    if (!user.emailVerified) fail('Verify your email address to check team invitations.');
    const docs = await db
      .collection('team_invitations')
      .where('email', '==', teamEmail(user.email))
      .where('status', '==', 'pending')
      .get();
    const invitations = [];
    for (let start = 0; start < docs.size; start += 20) {
      const results = await Promise.all(
        docs.docs.slice(start, start + 20).map((doc) => syncInvitationForUser(uid, doc.id)),
      );
      invitations.push(...results.filter(Boolean));
    }
    return { invitations };
  }
  if (action === 'respondInvitation') return respondInvitation(request, uid);
  const teamId = id(data.teamId);
  if (action === 'dashboard') return dashboard(teamId, uid);
  if (action === 'update') return updateTeam(teamId, uid, data);
  if (action === 'invite') return inviteMembers(teamId, uid, data);
  if (action === 'member') return updateMember(teamId, uid, data);
  if (action === 'saveListing') return saveListing(teamId, uid, data);
  if (action === 'listing') return listingAction(teamId, uid, data);
  if (action === 'voice') return voiceAction(teamId, uid, data);
  if (action === 'wizard') return wizardAction(teamId, uid, data);
  if (action === 'lifecycle') return lifecycle(teamId, uid, data);
  if (action === 'transferListing') return transferListing(teamId, uid, data);
  if (action === 'personalListings') {
    const { team } = await requireTeamMember(teamId, uid);
    active(team);
    const boards = await db.collection('boards').where('owner_user_id', '==', uid).get();
    return {
      listings: boards.docs
        .filter(
          (doc) =>
            !doc.data()['team_id'] &&
            !doc.data()['parentBoardId'] &&
            (doc.data()['cards'] || []).some((card: TeamRecord) =>
              (card['tags'] || []).includes('real-estate'),
            ),
        )
        .map((doc) => ({
          id: doc.id,
          title: doc.data()['title'],
          updatedAt: doc.data()['updated_at_iso'],
        })),
    };
  }
  if (action === 'revokeInvitation') {
    await db.runTransaction(async (tx) => {
      await requireTeamMember(teamId, uid, true, tx);
      const ref = db.collection('team_invitations').doc(id(data.inviteId));
      const invite = (await tx.get(ref)).data();
      if (invite?.['team_id'] !== teamId)
        throw new HttpsError('permission-denied', 'Invitation not found.');
      if (invite['status'] !== 'pending') fail('This invitation is no longer pending.');
      tx.update(ref, { status: 'revoked', token_hash: '' });
      audit(tx, teamId, uid, 'invitation.revoked', ref.id);
    });
    return { ok: true };
  }
  throw new HttpsError('invalid-argument', 'Unknown team action.');
});

export const getPublicTeamPage = onCall(options, async (request) => {
  const slug = teamSlug(request.data?.slug);
  if (!slug) throw new HttpsError('not-found', 'Team page unavailable.');
  const route = await db.collection('team_slugs').doc(slug).get();
  const teamId = route.data()?.['team_id'];
  if (!teamId) throw new HttpsError('not-found', 'Team page unavailable.');
  const [page, listings, team] = await Promise.all([
    db.collection('public_team_pages').doc(teamId).get(),
    db.collection('public_team_listings').where('teamId', '==', teamId).get(),
    teamRef(teamId).get(),
  ]);
  if (
    !page.exists ||
    team.data()?.['status'] !== 'active' ||
    team.data()?.['public_enabled'] !== true
  )
    throw new HttpsError('not-found', 'This team page is not published.');
  // Only opted-in public members are resolved; private accounts never enter this response.
  const visible = await teamRef(teamId)
    .collection('members')
    .where('status', '==', 'active')
    .where('public_visible', '==', true)
    .get();
  const identities = await currentMemberProfiles(
    visible.docs.map((doc) => ({ ...doc.data(), uid: doc.id })),
  );
  return {
    page: {
      ...page.data(),
      members: visible.docs.map((doc) => teamMemberProjection(doc.id, identities.get(doc.id)!)),
    },
    listings: listings.docs.map((doc) => doc.data()),
  };
});

export const getTeamInvitationPreview = onCall(options, async (request) => {
  const ref = db.collection('team_invitations').doc(id(request.data?.inviteId));
  const invite = (await ref.get()).data();
  const user = request.auth ? await getAuth().getUser(request.auth.uid) : null;
  const matches = !!user?.emailVerified && !!invite && invite['email'] === teamEmail(user.email);
  const tokenMatches =
    !!invite?.['token_hash'] && hash(teamText(request.data?.token, 100)) === invite['token_hash'];
  if (!invite || (!matches && !tokenMatches))
    throw new HttpsError('not-found', 'This invitation is no longer available.');
  const team = (await teamRef(invite['team_id']).get()).data();
  const view = invitationView(ref.id, invite);
  const status = team?.['status'] !== 'active' ? 'unavailable' : view.status;
  return {
    teamName: invite['team_name'],
    role: invite['role'],
    expiresAt: new Date(invite['expires_at_ms']).toISOString(),
    status,
    matchesAccount: user ? matches : null,
    teamId: matches && status === 'accepted' ? invite['team_id'] : '',
  };
});
