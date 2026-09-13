import { getAuth } from 'firebase-admin/auth';
import { FieldValue } from 'firebase-admin/firestore';
import { onDocumentCreated, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import sgMail from '@sendgrid/mail';
import { db } from './firebase';
import { teamEmail, type TeamRecord } from './team-model';

const sendgridKey = defineSecret('SENDGRID_API_KEY');
const jobs = () => db.collection('team_invitation_emails');
export const invitationNotificationRef = (uid: string, inviteId: string) =>
  db.doc(`users/${uid}/team_notifications/invite-${inviteId}`);

export function invitationView(inviteId: string, data: TeamRecord) {
  return {
    id: inviteId,
    teamId: data['team_id'],
    teamName: data['team_name'],
    email: data['email'],
    role: data['role'],
    status:
      data['status'] === 'pending' && data['expires_at_ms'] <= Date.now()
        ? 'expired'
        : data['status'],
    expiresAt: new Date(data['expires_at_ms']).toISOString(),
    delivery: data['delivery'] || 'pending',
    inviterName: data['inviter_name'] || 'A team admin',
    sentAt: new Date(data['sent_at_ms'] || 0).toISOString(),
  };
}

/** Resolve against fresh Auth and canonical state, never an event's potentially stale payload. */
export async function syncInvitationForUser(uid: string, inviteId: string) {
  const user = await getAuth().getUser(uid);
  if (!user.emailVerified || !teamEmail(user.email)) return null;
  return db.runTransaction(async (tx) => {
    const invite = (await tx.get(db.doc(`team_invitations/${inviteId}`))).data();
    const ref = invitationNotificationRef(uid, inviteId);
    if (!invite || invite['email'] !== teamEmail(user.email)) {
      tx.delete(ref);
      return null;
    }
    const [team, previous] = await tx.getAll(db.doc(`teams/${invite['team_id']}`), ref);
    const view = invitationView(inviteId, invite);
    if (view.status === 'pending' && team.data()?.['status'] !== 'active') view.status = 'revoked';
    const notification = {
      type: 'team_invitation',
      teamId: view.teamId,
      target: '',
      invitation: view,
      message: `${view.inviterName} invited you to join ${view.teamName}.`,
      read: view.status !== 'pending',
      createdAt: view.sentAt,
    };
    // Inbox checks must not create a write/listener/refresh feedback loop.
    const old = previous.data();
    if (
      !old ||
      old['message'] !== notification.message ||
      old['read'] !== notification.read ||
      Object.entries(view).some(([key, value]) => old['invitation']?.[key] !== value)
    )
      tx.set(ref, notification);
    return view.status === 'pending' ? view : null;
  });
}

export const syncTeamInvitationNotification = onDocumentWritten(
  { region: 'us-central1', document: 'team_invitations/{inviteId}', retry: true },
  async (event) => {
    const email = event.data?.after.data()?.['email'] || event.data?.before.data()?.['email'];
    if (!email) return;
    let user;
    try {
      user = await getAuth().getUserByEmail(email);
    } catch (error) {
      if ((error as { code?: string }).code === 'auth/user-not-found') return;
      throw error;
    }
    await syncInvitationForUser(user.uid, event.params.inviteId);
  },
);

export const syncTeamInvitationAvailability = onDocumentWritten(
  { region: 'us-central1', document: 'teams/{teamId}', retry: true },
  async (event) => {
    if (event.data?.before.data()?.['status'] === event.data?.after.data()?.['status']) return;
    const invites = await db
      .collection('team_invitations')
      .where('team_id', '==', event.params.teamId)
      .where('status', '==', 'pending')
      .get();
    // Touch canonical invitations so the recipient sync rechecks team availability.
    for (let start = 0; start < invites.size; start += 400) {
      const batch = db.batch();
      for (const doc of invites.docs.slice(start, start + 400))
        batch.update(doc.ref, { team_status: event.data?.after.data()?.['status'] || 'deleted' });
      await batch.commit();
    }
  },
);

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
export function invitationEmail(job: TeamRecord) {
  const url = `https://www.livingwiki.com/teams/invitations?invite=${encodeURIComponent(job['invite_id'])}&token=${encodeURIComponent(job['token'])}`;
  const name = String(job['team_name']);
  const inviter = String(job['inviter_name'] || 'A team admin');
  const role = job['role'] === 'admin' ? 'admin' : 'member';
  const expiry = new Date(job['expires_at_ms']).toUTCString();
  return {
    to: job['email'] as string,
    from: {
      email: process.env['INVITE_SENDER_EMAIL'] || 'missioncontrol@rocketgoals.com',
      name: 'LivingWiki',
    },
    subject: `Join ${name} on LivingWiki`,
    text: `${inviter} invited you to join ${name} as a ${role}.\nReview invitation: ${url}\nSign in or create an account with ${job['email']}. You will be asked to confirm before joining.\nExpires ${expiry}. Your personal boards and voices stay private.\nNot expecting this invitation? You can ignore it.`,
    html: `<div style="background:#f4f7f5;padding:32px 16px"><div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:32px;border-radius:16px;background:white;color:#17372b"><p style="font-weight:bold;color:#216b4c">LivingWiki · Team invitation</p><h1>You're invited to ${escape(name)}</h1><p>${escape(inviter)} invited you to collaborate as a <strong>${role}</strong>.</p><p>Explore the team's listings and create TalkThrus together.</p><p><a href="${escape(url)}" style="display:inline-block;background:#216b4c;color:white;padding:14px 24px;border-radius:8px;text-decoration:none">Review invitation</a></p><p>Sign in or create an account with <strong>${escape(job['email'])}</strong>. Joining is your choice; opening this link does not accept the invitation.</p><p style="color:#65756c">Expires ${escape(expiry)}. Your personal boards and voices stay private.</p><hr style="border:0;border-top:1px solid #e3e9e5"><p style="font-size:12px;overflow-wrap:anywhere">Button not working? <a href="${escape(url)}">${escape(url)}</a></p><p style="font-size:12px;color:#65756c">Not expecting this invitation? You can ignore it.</p></div></div>`,
    // Preserve the direct app link and avoid unnecessary open-tracking pixels.
    trackingSettings: {
      clickTracking: { enable: false, enableText: false },
      openTracking: { enable: false },
    },
  };
}

async function finishJob(jobId: string, job: TeamRecord, patch: TeamRecord) {
  await db.runTransaction(async (tx) => {
    const ref = db.doc(`team_invitations/${job['invite_id']}`);
    const current = (await tx.get(ref)).data();
    tx.update(jobs().doc(jobId), patch);
    if (current?.['token_hash'] === job['token_hash'])
      tx.update(ref, { delivery: patch['status'] });
  });
}

/** A durable lease prevents concurrent trigger/scheduler sends. Ambiguous sends are never blindly retried. */
export async function processInvitationEmail(jobId: string) {
  const now = Date.now();
  const job = await db.runTransaction(async (tx) => {
    const ref = jobs().doc(jobId);
    const data = (await tx.get(ref)).data();
    if (!data || !['queued', 'retry'].includes(data['status']) || data['next_attempt_at'] > now)
      return null;
    const invite = (await tx.get(db.doc(`team_invitations/${data['invite_id']}`))).data();
    const team = (await tx.get(db.doc(`teams/${data['team_id']}`))).data();
    if (
      !invite ||
      invite['status'] !== 'pending' ||
      invite['token_hash'] !== data['token_hash'] ||
      invite['expires_at_ms'] <= now ||
      team?.['status'] !== 'active'
    ) {
      tx.update(ref, {
        status: 'cancelled',
        token: FieldValue.delete(),
        next_attempt_at: FieldValue.delete(),
      });
      return null;
    }
    const attempts = (data['attempts'] || 0) + 1;
    tx.update(ref, { status: 'processing', attempts, next_attempt_at: now + 300_000 });
    return { ...data, attempts };
  });
  if (!job) return;
  let patch: TeamRecord;
  try {
    if (!sendgridKey.value())
      throw Object.assign(new Error('Email configuration unavailable'), { code: 401 });
    sgMail.setApiKey(sendgridKey.value());
    sgMail.setTimeout(20_000);
    const [response] = await sgMail.send(invitationEmail(job));
    patch = {
      status: 'submitted',
      submitted_at: Date.now(),
      message_id: String(response.headers?.['x-message-id'] || ''),
      token: FieldValue.delete(),
      next_attempt_at: Date.now() + 300_000,
      checks: 0,
    };
  } catch (error) {
    const code = Number((error as { code?: unknown }).code) || 0;
    const retry = (code === 429 || code >= 500) && job['attempts'] < 5;
    patch = {
      status: retry ? 'retry' : code ? 'failed' : 'unknown',
      error_code: code ? `provider_${code}` : 'send_unconfirmed',
      next_attempt_at: retry ? Date.now() + 60_000 * 2 ** job['attempts'] : FieldValue.delete(),
    };
    if (!retry) patch['token'] = FieldValue.delete();
    // Provider errors may contain recipient PII or request credentials; never log raw error objects.
    logger.warn('Team invitation email not submitted', {
      jobId,
      status: patch['status'],
      errorCode: patch['error_code'],
    });
  }
  // Outside the send catch: a persistence failure must not classify a successful send as retryable.
  await finishJob(jobId, job, patch);
}

export async function checkInvitationDelivery(jobId: string, job: TeamRecord) {
  const checks = (job['checks'] || 0) + 1;
  let status = 'submitted';
  const messageId = String(job['message_id'] || '');
  if (/^[a-zA-Z0-9_-]+$/.test(messageId)) {
    const response = await fetch(
      `https://api.sendgrid.com/v3/messages?limit=1&query=${encodeURIComponent(`msg_id LIKE '${messageId}%'`)}`,
      {
        headers: { Authorization: `Bearer ${sendgridKey.value()}` },
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (response.ok) {
      const data = (await response.json()) as { messages?: Array<{ status: string }> };
      const observed = data.messages?.[0]?.status;
      if (observed === 'delivered') status = 'delivered';
      if (observed === 'not_delivered') status = 'failed';
    }
  }
  await finishJob(jobId, job, {
    status,
    checks,
    checked_at: Date.now(),
    next_attempt_at:
      status !== 'submitted' || checks >= 12
        ? FieldValue.delete()
        : Date.now() + Math.min(3600_000, 300_000 * checks),
  });
}

export const sendTeamInvitationEmail = onDocumentCreated(
  {
    region: 'us-central1',
    document: 'team_invitation_emails/{jobId}',
    secrets: [sendgridKey],
    retry: true,
    timeoutSeconds: 120,
  },
  async (event) => processInvitationEmail(event.params.jobId),
);

export const retryTeamInvitationEmails = onSchedule(
  {
    region: 'us-central1',
    schedule: 'every 5 minutes',
    secrets: [sendgridKey],
    timeoutSeconds: 300,
    maxInstances: 1,
  },
  async () => {
    const pending = await jobs()
      .where('next_attempt_at', '<=', Date.now())
      .orderBy('next_attempt_at')
      .limit(50)
      .get();
    for (let start = 0; start < pending.size; start += 5) {
      await Promise.all(
        pending.docs.slice(start, start + 5).map(async (doc) => {
          const job = doc.data();
          try {
            if (job['status'] === 'submitted') await checkInvitationDelivery(doc.id, job);
            else if (job['status'] === 'processing')
              await finishJob(doc.id, job, {
                status: 'unknown',
                token: FieldValue.delete(),
                next_attempt_at: FieldValue.delete(),
                error_code: 'lease_expired',
              });
            else await processInvitationEmail(doc.id);
          } catch {
            logger.warn('Team invitation job will be checked again', { jobId: doc.id });
          }
        }),
      );
    }
  },
);
