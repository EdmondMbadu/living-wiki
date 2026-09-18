import { isLinkReadableVisibility } from './board-visibility';
import { createHash } from 'node:crypto';
import { FieldValue, Timestamp, type Transaction } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db } from './firebase';
import { isActiveTeamMember, requireTeamMember } from './teams';
import { teamEmail, teamText } from './team-model';

const options = { region: 'us-central1', cors: true };
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const ref = (collection: string, key: string) => db.collection(collection).doc(hash(key));
const dayNow = () => new Date().toISOString().slice(0, 10);
const fromDay = (days: number) =>
  new Date(Date.parse(`${dayNow()}T00:00:00Z`) - (days - 1) * 86_400_000)
    .toISOString()
    .slice(0, 10);
const expiry = () => Timestamp.fromMillis(Date.now() + 100 * 86_400_000);
const empty = (durationReady: boolean) => ({
  views: 0,
  participants: 0,
  chats: 0,
  messages: 0,
  contacts: 0,
  voiceSeconds: durationReady ? 0 : (null as number | null),
});
function safeId(value: unknown) {
  const text = teamText(value, 180);
  if (!/^[A-Za-z0-9_-]{1,180}$/.test(text))
    throw new HttpsError('invalid-argument', 'Invalid listing identifier.');
  return text;
}

/** Called inside the existing event-receipt transaction, after its reads and before its writes. */
export async function recordTeamActivity(
  tx: Transaction,
  input: {
    teamId: string;
    boardId: string;
    visitorId: string;
    sessionId: string;
    type: string;
    day: string;
  },
) {
  const { teamId, boardId, visitorId, sessionId, type, day } = input;
  if (!['board_view', 'board_engaged', 'talking_card_message'].includes(type)) return;
  const participantKey = hash(`${teamId}:${visitorId}`);
  const visit = ref('team_visit_receipts', `${teamId}:${boardId}:${sessionId}:${day}`);
  const participant = db.collection('team_participants').doc(participantKey);
  const chat = ref('team_chat_receipts', `${teamId}:${boardId}:${sessionId}`);
  const [visitDoc, participantDoc, chatDoc, listingDoc] = await tx.getAll(
    visit,
    participant,
    chat,
    db.collection('team_boards').doc(boardId),
  );
  if (listingDoc.data()?.['team_id'] !== teamId) return;
  const counts: Record<string, unknown> = {};
  if (type === 'board_view' && !visitDoc.exists) {
    counts['views'] = FieldValue.increment(1);
    tx.create(visit, { teamId, boardId, expires_at: expiry() });
  }
  if (type === 'talking_card_message') {
    counts['messages'] = FieldValue.increment(1);
    if (!chatDoc.exists) {
      counts['chats'] = FieldValue.increment(1);
      tx.create(chat, {
        teamId,
        boardId,
        started_at: new Date().toISOString(),
        expires_at: expiry(),
      });
    }
  }
  if (type !== 'board_view') {
    const floor = fromDay(90);
    const activity = Object.fromEntries(
      Object.entries(participantDoc.data()?.['activity'] || {}).filter(
        ([key]) => key.slice(-10) >= floor,
      ),
    );
    activity[`${boardId}__${day}`] = true;
    tx.set(participant, { teamId, last_day: day, activity, expires_at: expiry() });
  }
  if (Object.keys(counts).length)
    tx.set(
      ref('team_analytics_daily', `${teamId}:${boardId}:${day}`),
      {
        teamId,
        boardId,
        day,
        representativeId: listingDoc.data()?.['representative_id'] || '',
        ...counts,
      },
      { merge: true },
    );
}

export const getTeamInsights = onCall({ ...options, timeoutSeconds: 60 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to view team analytics.');
  const teamId = safeId(request.data?.teamId);
  const { team } = await requireTeamMember(teamId, request.auth.uid);
  const days = [7, 30, 90].includes(Number(request.data?.days)) ? Number(request.data.days) : 30;
  const start = fromDay(days);
  const finish = dayNow();
  const [daily, participants, contactStats, listingDocs, config] = await Promise.all([
    db
      .collection('team_analytics_daily')
      .where('teamId', '==', teamId)
      .where('day', '>=', start)
      .where('day', '<=', finish)
      .get(),
    db
      .collection('team_participants')
      .where('teamId', '==', teamId)
      .where('last_day', '>=', start)
      .get(),
    db
      .collection('team_contact_stats')
      .where('teamId', '==', teamId)
      .where('last_day', '>=', start)
      .get(),
    db.collection('teams').doc(teamId).collection('listings').get(),
    db.collection('teams').doc(teamId).collection('runtime').doc('voice_webhook').get(),
  ]);
  // Missing webhook setup is unknown, not zero minutes. A verified callback marks tracking as available.
  const durationReady = config.data()?.['verified'] === true;
  const totals = empty(durationReady);
  const listings: Record<string, ReturnType<typeof empty>> = {};
  for (const listing of listingDocs.docs) listings[listing.id] = empty(durationReady);
  for (const row of daily.docs) {
    const value = row.data();
    const entry = (listings[value['boardId']] ||= empty(durationReady));
    for (const key of ['views', 'chats', 'messages', 'voiceSeconds'] as const) {
      if (key === 'voiceSeconds' && !durationReady) continue;
      const n = Math.max(0, Number(value[key]) || 0);
      entry[key] = (entry[key] || 0) + n;
      totals[key] = (totals[key] || 0) + n;
    }
  }
  for (const doc of participants.docs) {
    const boardIds = new Set(
      Object.keys(doc.data()['activity'] || {})
        .filter((key) => key.slice(-10) >= start && key.slice(-10) <= finish)
        .map((key) => key.slice(0, -12)),
    );
    if (boardIds.size) totals.participants++;
    for (const boardId of boardIds) (listings[boardId] ||= empty(durationReady)).participants++;
  }
  for (const doc of contactStats.docs) {
    const value = doc.data();
    if (!(value['days'] || []).some((day: string) => day >= start && day <= finish)) continue;
    totals.contacts++;
    (listings[value['boardId']] ||= empty(durationReady)).contacts++;
  }
  return {
    days,
    trackingSince: team['tracking_since'],
    voiceTrackingSince: config.data()?.['first_verified_at'] || null,
    totals,
    listings,
  };
});

export const submitTeamContact = onCall(options, async (request) => {
  const data = request.data || {};
  const boardId = safeId(data.boardId);
  const requestId = safeId(data.requestId);
  if (data.website) return { accepted: true }; // Honeypot: no record, notification, or analytics event.
  const email = teamEmail(data.email);
  const name = teamText(data.name, 100);
  const message = teamText(data.message, 2000);
  const phone = teamText(data.phone, 40);
  if (!name || !email || !message || data.consent !== true)
    throw new HttpsError(
      'invalid-argument',
      'Add your name, email, message, and permission for the team to contact you.',
    );
  const board = (await db.collection('boards').doc(boardId).get()).data();
  const teamId = board?.['team_id'];
  if (!teamId || !isLinkReadableVisibility(board?.['visibility']))
    throw new HttpsError('not-found', 'This listing is not available.');
  if (request.auth?.uid && (await isActiveTeamMember(teamId, request.auth.uid)))
    throw new HttpsError('failed-precondition', 'Team previews do not create visitor contacts.');
  const now = new Date().toISOString();
  const day = now.slice(0, 10);
  const key = hash(`${teamId}:${boardId}:${email}`);
  return db.runTransaction(async (tx) => {
    const receipt = ref('team_contact_requests', `${teamId}:${requestId}`);
    const limitRef = ref(
      'team_contact_limits',
      `${teamId}:${day}:${request.rawRequest.ip || email}`,
    );
    const contact = db.collection('team_contacts').doc(key);
    const stats = db.collection('team_contact_stats').doc(key);
    const [previous, rate, current, stat, listing, team] = await tx.getAll(
      receipt,
      limitRef,
      contact,
      stats,
      db.collection('team_boards').doc(boardId),
      db.collection('teams').doc(teamId),
    );
    if (previous.exists) return { accepted: true };
    if (team.data()?.['status'] !== 'active' || listing.data()?.['team_status'] !== 'published')
      throw new HttpsError('not-found', 'This listing is no longer available.');
    if ((rate.data()?.['count'] || 0) >= 10)
      throw new HttpsError(
        'resource-exhausted',
        'Too many requests today. Please contact the team directly.',
      );
    const repId = listing.data()?.['representative_id'] || team.data()?.['owner_id'];
    const rep = (
      await tx.get(db.collection('teams').doc(teamId).collection('members').doc(repId))
    ).data();
    const recipient = rep?.['status'] === 'active' ? repId : team.data()?.['owner_id'];
    tx.create(receipt, { teamId, boardId, at: now, expires_at: expiry() });
    tx.set(limitRef, { count: FieldValue.increment(1), expires_at: expiry() }, { merge: true });
    tx.set(
      contact,
      {
        teamId,
        boardId,
        name,
        email,
        phone,
        message,
        consent: true,
        consent_at: now,
        representativeId: repId,
        status: current.data()?.['status'] || 'new',
        first_at: current.data()?.['first_at'] || now,
        last_at: now,
        requests: FieldValue.increment(1),
      },
      { merge: true },
    );
    tx.create(contact.collection('requests').doc(requestId), {
      name,
      email,
      phone,
      message,
      at: now,
      representativeId: repId,
    });
    const days = [
      ...new Set([
        ...(stat.data()?.['days'] || []).filter((value: string) => value >= fromDay(90)),
        day,
      ]),
    ];
    tx.set(stats, { teamId, boardId, days, last_day: day });
    tx.create(db.collection('users').doc(recipient).collection('team_notifications').doc(), {
      teamId,
      target: boardId,
      message: `A visitor contacted you about ${listing.data()?.['title'] || 'a listing'}.`,
      read: false,
      createdAt: now,
    });
    return { accepted: true };
  });
});

export const manageTeamContacts = onCall(options, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to view contacts.');
  const teamId = safeId(request.data?.teamId);
  const boardId = safeId(request.data?.boardId);
  const uid = request.auth.uid;
  const { member } = await requireTeamMember(teamId, uid);
  const listing = (await db.collection('team_boards').doc(boardId).get()).data();
  if (
    listing?.['team_id'] !== teamId ||
    (member['role'] !== 'admin' && listing['representative_id'] !== uid)
  )
    throw new HttpsError(
      'permission-denied',
      'Only the assigned representative or a team admin can view private contacts.',
    );
  if (request.data?.contactId) {
    const contactRef = db.collection('team_contacts').doc(safeId(request.data.contactId));
    await db.runTransaction(async (tx) => {
      const { member: freshMember } = await requireTeamMember(teamId, uid, false, tx);
      const [contact, currentListing] = await tx.getAll(
        contactRef,
        db.collection('team_boards').doc(boardId),
      );
      if (
        contact.data()?.['teamId'] !== teamId ||
        contact.data()?.['boardId'] !== boardId ||
        (freshMember['role'] !== 'admin' && currentListing.data()?.['representative_id'] !== uid)
      )
        throw new HttpsError('permission-denied', 'Contact access has changed.');
      const status = request.data.status === 'contacted' ? 'contacted' : 'new';
      tx.update(contactRef, { status });
    });
  }
  let query = db
    .collection('team_contacts')
    .where('teamId', '==', teamId)
    .where('boardId', '==', boardId)
    .orderBy('last_at', 'desc')
    .limit(26);
  if (request.data?.cursor) {
    const cursor = await db.collection('team_contacts').doc(safeId(request.data.cursor)).get();
    if (cursor.data()?.['teamId'] !== teamId || cursor.data()?.['boardId'] !== boardId)
      throw new HttpsError('invalid-argument', 'Reload contacts before continuing.');
    query = query.startAfter(cursor);
  }
  const contacts = await query.get();
  const page = contacts.docs.slice(0, 25);
  return {
    contacts: page.map((doc) => ({ id: doc.id, ...doc.data() })),
    nextCursor: contacts.size > 25 ? page.at(-1)!.id : null,
  };
});

/** Private, paginated provider-verified calls. No client can upload or invent transcripts. */
export const getTeamConversations = onCall(options, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to view conversations.');
  const teamId = safeId(request.data?.teamId);
  const boardId = safeId(request.data?.boardId);
  const { member } = await requireTeamMember(teamId, request.auth.uid);
  const listing = (await db.collection('team_boards').doc(boardId).get()).data();
  if (
    listing?.['team_id'] !== teamId ||
    (member['role'] !== 'admin' && listing['representative_id'] !== request.auth.uid)
  )
    throw new HttpsError(
      'permission-denied',
      'Only the assigned representative or a team admin can view private conversations.',
    );
  let query = db
    .collection('team_conversations')
    .where('teamId', '==', teamId)
    .where('boardId', '==', boardId)
    .orderBy('startedAt', 'desc')
    .limit(11);
  if (request.data?.cursor) {
    const cursor = await db.collection('team_conversations').doc(safeId(request.data.cursor)).get();
    if (cursor.data()?.['teamId'] !== teamId || cursor.data()?.['boardId'] !== boardId)
      throw new HttpsError('invalid-argument', 'Reload conversations before continuing.');
    query = query.startAfter(cursor);
  }
  const result = await query.get();
  const page = result.docs.slice(0, 10);
  return {
    conversations: page.map((doc) => ({
      id: doc.id,
      startedAt: doc.data()['startedAt'],
      durationSeconds: doc.data()['durationSeconds'],
      internal: doc.data()['internal'] === true,
      transcript: doc.data()['transcript'] || [],
    })),
    nextCursor: result.size > 10 ? page.at(-1)!.id : null,
  };
});
