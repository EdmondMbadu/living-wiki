import { createHash } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';
import sgMail from '@sendgrid/mail';
import { db } from './firebase';
import {
  buildTalkThruAdminEmail,
  buildTalkThruApplicantEmail,
  parseTalkThruAdminEmails,
} from './talkthru-interest-email';

const sendgridApiKey = defineSecret('SENDGRID_API_KEY');
const adminEmailsSecret = defineSecret('TALKTHRU_ADMIN_EMAILS');
const senderEmail = 'missioncontrol@rocketgoals.com';
const interestCollection = db.collection('talkthru_interests');
const deliveryCollection = db.collection('talkthru_interest_deliveries');
const auditCollection = db.collection('talkthru_interest_audit');
const interestIdPattern = /^[A-Za-z0-9_-]{10,80}$/;
const submissionIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type TalkThruInterestStatus = 'new' | 'in_progress' | 'done';
type DeliveryKey = 'applicant' | 'jim' | 'edmond';

export interface TalkThruInterest {
  role: 'agent' | 'agency';
  name: string;
  email: string;
  agency: string;
  listing: string;
  consent: true;
}

function requiredAdminUid(uid: string | undefined): string {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to manage TalkThru requests.');
  return uid;
}

async function assertPlatformAdmin(uid: string): Promise<void> {
  const user = await db.collection('users').doc(uid).get();
  if (user.data()?.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Platform admin access is required.');
  }
}

function checkedInterestId(value: unknown): string {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!interestIdPattern.test(id)) throw new HttpsError('invalid-argument', 'Invalid TalkThru request ID.');
  return id;
}

function timestampToIso(value: unknown): string | null {
  return value instanceof Timestamp ? value.toDate().toISOString() : null;
}

function serializeInterest(id: string, data: Record<string, unknown>) {
  const delivery = data.emailDelivery && typeof data.emailDelivery === 'object'
    ? data.emailDelivery as Record<string, unknown> : {};
  const deliveryState = (key: DeliveryKey) => {
    const value = delivery[key];
    return value === 'sent' || value === 'failed' ? value : 'pending';
  };
  return {
    id,
    role: data.role === 'agency' ? 'agency' : 'agent',
    name: String(data.name ?? ''),
    email: String(data.email ?? ''),
    agency: String(data.agency ?? ''),
    listing: String(data.listing ?? ''),
    status: data.status === 'in_progress' || data.status === 'done' ? data.status : 'new',
    adminNotes: String(data.adminNotes ?? ''),
    archivedAt: timestampToIso(data.archivedAt),
    doneAt: timestampToIso(data.doneAt),
    createdAt: timestampToIso(data.createdAt),
    updatedAt: timestampToIso(data.updatedAt),
    emailDelivery: {
      applicant: deliveryState('applicant'),
      jim: deliveryState('jim'),
      edmond: deliveryState('edmond'),
    },
  };
}

export function normalizeTalkThruInterest(input: Record<string, unknown>): TalkThruInterest {
  const value = (key: string) => typeof input[key] === 'string' ? input[key].trim() : '';
  const role = value('role');
  const name = value('name');
  const email = value('email').toLowerCase();
  const agency = value('agency');
  const listing = value('listing');
  if (role !== 'agent' && role !== 'agency') throw new HttpsError('invalid-argument', 'Choose an agent or agency.');
  if (name.length < 2 || name.length > 120) throw new HttpsError('invalid-argument', 'Enter your name.');
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpsError('invalid-argument', 'Enter a valid email.');
  if (!agency || agency.length > 160) throw new HttpsError('invalid-argument', 'Enter your agency or brokerage.');
  if (listing) {
    let url: URL;
    try { url = new URL(listing); }
    catch { throw new HttpsError('invalid-argument', 'Enter a valid listing link.'); }
    if (url.protocol !== 'https:' || !url.hostname || listing.length > 2000)
      throw new HttpsError('invalid-argument', 'Enter an HTTPS listing link.');
  }
  if (input.consent !== true) throw new HttpsError('invalid-argument', 'Consent is required.');
  return { role, name, email, agency, listing, consent: true };
}

export const submitTalkThruInterest = onCall({ region: 'us-central1', cors: true, maxInstances: 10 }, async (request) => {
  const input = request.data;
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new HttpsError('invalid-argument', 'Enter your contact details.');
  // Quietly discard automated submissions that fill the hidden field.
  if (input.website) return { received: true };
  const interest = normalizeTalkThruInterest(input);
  const submittedId = typeof input.submissionId === 'string' ? input.submissionId.trim() : '';
  if (submittedId && !submissionIdPattern.test(submittedId)) {
    throw new HttpsError('invalid-argument', 'Invalid submission ID.');
  }
  const interestRef = submittedId ? interestCollection.doc(submittedId) : interestCollection.doc();
  const ip = request.rawRequest.ip || 'unknown';
  const key = createHash('sha256').update(ip).digest('hex');
  const limitRef = db.doc(`talkthru_interest_limits/${key}`);
  const emailKey = createHash('sha256').update(interest.email).digest('hex');
  const emailLimitRef = db.doc(`talkthru_interest_email_limits/${emailKey}`);
  const now = Date.now();
  await db.runTransaction(async tx => {
    const existing = await tx.get(interestRef);
    if (existing.exists) {
      if (existing.data()?.email !== interest.email) {
        throw new HttpsError('already-exists', 'This submission ID has already been used.');
      }
      return;
    }
    const previous = (await tx.get(limitRef)).data();
    const previousEmail = (await tx.get(emailLimitRef)).data();
    const count = (previous?.windowEndsAt ?? 0) > now ? Number(previous?.count) || 0 : 0;
    const emailCount = (previousEmail?.windowEndsAt ?? 0) > now ? Number(previousEmail?.count) || 0 : 0;
    if (count >= 3) throw new HttpsError('resource-exhausted', 'Please try again later.');
    if (emailCount >= 3) throw new HttpsError('resource-exhausted', 'This email has received too many TalkThru requests today.');
    tx.set(limitRef, { count: count + 1, windowEndsAt: count ? Number(previous?.windowEndsAt) : now + 3600000 });
    tx.set(emailLimitRef, {
      count: emailCount + 1,
      windowEndsAt: emailCount ? Number(previousEmail?.windowEndsAt) : now + 24 * 3600000,
    });
    tx.set(interestRef, {
      ...interest,
      source: '/talkthrus',
      status: 'new',
      adminNotes: '',
      archivedAt: null,
      doneAt: null,
      emailDelivery: { applicant: 'pending', jim: 'pending', edmond: 'pending' },
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  return { received: true, id: interestRef.id };
});

export const listTalkThruInterests = onCall({ region: 'us-central1', cors: true }, async request => {
  await assertPlatformAdmin(requiredAdminUid(request.auth?.uid));
  const cursor = typeof request.data?.cursor === 'string' ? request.data.cursor.trim() : '';
  let query = interestCollection.orderBy('createdAt', 'desc').limit(51);
  if (cursor) {
    const cursorDoc = await interestCollection.doc(checkedInterestId(cursor)).get();
    if (!cursorDoc.exists) throw new HttpsError('invalid-argument', 'The list cursor has expired.');
    query = query.startAfter(cursorDoc);
  }
  const snapshot = await query.get();
  const page = snapshot.docs.slice(0, 50);
  return {
    interests: page.map(doc => serializeInterest(doc.id, doc.data())),
    nextCursor: snapshot.docs.length > 50 ? page[page.length - 1]?.id ?? null : null,
  };
});

export const updateTalkThruInterest = onCall({ region: 'us-central1', cors: true }, async request => {
  const uid = requiredAdminUid(request.auth?.uid);
  await assertPlatformAdmin(uid);
  const id = checkedInterestId(request.data?.id);
  const patch = request.data?.patch;
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new HttpsError('invalid-argument', 'Choose fields to update.');
  }
  const allowed = new Set(['role', 'name', 'email', 'agency', 'listing', 'adminNotes', 'status', 'archived']);
  const keys = Object.keys(patch);
  if (!keys.length || keys.some(key => !allowed.has(key))) {
    throw new HttpsError('invalid-argument', 'Unsupported TalkThru request field.');
  }
  const ref = interestCollection.doc(id);
  const auditRef = auditCollection.doc();
  await db.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw new HttpsError('not-found', 'TalkThru request not found.');
    const current = snapshot.data() as Record<string, unknown>;
    const next = { ...current, ...patch } as Record<string, unknown>;
    const contact = normalizeTalkThruInterest({ ...next, consent: true });
    const status = next.status ?? 'new';
    if (status !== 'new' && status !== 'in_progress' && status !== 'done') {
      throw new HttpsError('invalid-argument', 'Invalid TalkThru status.');
    }
    if ('archived' in patch && typeof patch.archived !== 'boolean') {
      throw new HttpsError('invalid-argument', 'Archive must be true or false.');
    }
    const adminNotes = next.adminNotes ?? '';
    if (typeof adminNotes !== 'string' || adminNotes.length > 4000) {
      throw new HttpsError('invalid-argument', 'Admin notes must be 4,000 characters or fewer.');
    }
    const changes: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: uid,
    };
    for (const field of ['role', 'name', 'email', 'agency', 'listing'] as const) {
      if (field in patch) changes[field] = contact[field];
    }
    if ('adminNotes' in patch) changes.adminNotes = adminNotes;
    if ('status' in patch) {
      changes.status = status;
      changes.doneAt = status === 'done' ? FieldValue.serverTimestamp() : null;
    }
    if ('archived' in patch) {
      changes.archivedAt = patch.archived ? FieldValue.serverTimestamp() : null;
    }
    if ('email' in patch && contact.email !== current.email) {
      changes['emailDelivery.applicant'] = 'pending';
      tx.delete(deliveryCollection.doc(`${id}_applicant`));
    }
    tx.update(ref, changes);
    tx.create(auditRef, {
      interestId: id,
      action: 'updated',
      fields: keys,
      actorUid: uid,
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  const updated = await ref.get();
  return { interest: serializeInterest(id, updated.data() as Record<string, unknown>) };
});

export const deleteTalkThruInterest = onCall({ region: 'us-central1', cors: true }, async request => {
  const uid = requiredAdminUid(request.auth?.uid);
  await assertPlatformAdmin(uid);
  const id = checkedInterestId(request.data?.id);
  const ref = interestCollection.doc(id);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new HttpsError('not-found', 'TalkThru request not found.');
  const batch = db.batch();
  batch.delete(ref);
  for (const key of ['applicant', 'jim', 'edmond'] as DeliveryKey[]) {
    batch.delete(deliveryCollection.doc(`${id}_${key}`));
  }
  batch.create(auditCollection.doc(), {
    interestId: id,
    action: 'deleted',
    actorUid: uid,
    createdAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();
  return { deleted: true };
});

async function sendOneEmail(
  interestId: string,
  key: DeliveryKey,
  recipientEmail: string,
  interest: TalkThruInterest,
  manual: boolean,
): Promise<void> {
  const deliveryRef = deliveryCollection.doc(`${interestId}_${key}`);
  const now = Date.now();
  const claimed = await db.runTransaction(async tx => {
    const previous = (await tx.get(deliveryRef)).data();
    if (previous?.status === 'sent') return false;
    if (!manual && Number(previous?.attempts) >= 5) return false;
    if (previous?.status === 'sending' && Number(previous.leaseUntil) > now) {
      throw new Error(`TalkThru email ${key} is already being sent.`);
    }
    tx.set(deliveryRef, {
      status: 'sending',
      attempts: FieldValue.increment(1),
      leaseUntil: now + 5 * 60_000,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return true;
  });
  if (!claimed) return;
  const content = key === 'applicant'
    ? buildTalkThruApplicantEmail(interest)
    : buildTalkThruAdminEmail(interest);
  try {
    await sgMail.send({
      to: recipientEmail,
      from: { email: senderEmail, name: 'LivingWiki' },
      subject: content.subject,
      text: content.text,
      html: content.html,
    });
    const batch = db.batch();
    batch.set(deliveryRef, {
      status: 'sent',
      sentAt: FieldValue.serverTimestamp(),
      leaseUntil: null,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    batch.update(interestCollection.doc(interestId), { [`emailDelivery.${key}`]: 'sent' });
    await batch.commit();
  } catch (error) {
    logger.error('TalkThru email delivery failed.', {
      interestId,
      recipient: key,
      errorType: error instanceof Error ? error.name : 'unknown',
      statusCode: typeof (error as { code?: unknown })?.code === 'number'
        ? (error as { code: number }).code : null,
    });
    const batch = db.batch();
    batch.set(deliveryRef, {
      status: 'failed',
      leaseUntil: null,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    batch.update(interestCollection.doc(interestId), { [`emailDelivery.${key}`]: 'failed' });
    await batch.commit();
    throw error;
  }
}

async function deliverTalkThruEmails(interestId: string, manual = false): Promise<void> {
  const snapshot = await interestCollection.doc(interestId).get();
  if (!snapshot.exists) return;
  const data = snapshot.data() as Record<string, unknown>;
  const interest = normalizeTalkThruInterest({ ...data, consent: true });
  const apiKey = sendgridApiKey.value();
  if (!apiKey) throw new Error('SENDGRID_API_KEY is not configured.');
  const adminEmails = parseTalkThruAdminEmails(adminEmailsSecret.value());
  sgMail.setApiKey(apiKey);
  const recipients: Array<[DeliveryKey, string]> = [
    ['applicant', interest.email],
    ['jim', adminEmails.jim],
    ['edmond', adminEmails.edmond],
  ];
  const results = await Promise.allSettled(
    recipients.map(([key, email]) => sendOneEmail(interestId, key, email, interest, manual)),
  );
  if (results.some(result => result.status === 'rejected')) {
    throw new Error(`One or more TalkThru emails could not be delivered for ${interestId}.`);
  }
}

export const sendTalkThruInterestEmails = onDocumentCreated({
  document: 'talkthru_interests/{interestId}',
  region: 'us-central1',
  retry: true,
  maxInstances: 10,
  secrets: [sendgridApiKey, adminEmailsSecret],
}, async event => {
  await deliverTalkThruEmails(event.params.interestId);
});

export const retryTalkThruInterestEmails = onCall({
  region: 'us-central1',
  cors: true,
  secrets: [sendgridApiKey, adminEmailsSecret],
}, async request => {
  await assertPlatformAdmin(requiredAdminUid(request.auth?.uid));
  const id = checkedInterestId(request.data?.id);
  try {
    await deliverTalkThruEmails(id, true);
  } catch {
    throw new HttpsError('unavailable', 'One or more emails could not be sent. Please retry later.');
  }
  const updated = await interestCollection.doc(id).get();
  return updated.exists
    ? { interest: serializeInterest(id, updated.data() as Record<string, unknown>) }
    : { interest: null };
});
