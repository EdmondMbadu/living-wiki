import { createHash, randomUUID } from 'node:crypto';
import { FieldValue, type DocumentData } from 'firebase-admin/firestore';
import { defineSecret, defineString } from 'firebase-functions/params';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
import type Stripe from 'stripe';
import { db } from './firebase';
import { allowedCheckoutOrigins, getStripeClient, stripeSecretKey } from './stripe-client';
import { isLinkReadableVisibility } from './board-visibility';
import { requireTeamMember } from './teams';
import { flattenAnalyticsCards } from './card-analytics';

const relay = defineString('VOICE_CREDITS_RELAY_URL', { default: '' });
const packPrice = defineString('VOICE_CREDITS_STRIPE_PRICE_ID', { default: '' });
const superAdmins = defineString('VOICE_CREDITS_SUPER_ADMIN_UIDS', { default: '' });
const voiceKey = defineSecret('ELEVENLABS_API_KEY');
const policyRef = db.doc('voice_credit_settings/policy');
const sessions = db.collection('voice_credit_sessions');
const purchases = db.collection('voice_credit_purchases');
const wallet = (key: string) => db.collection('voice_credit_wallets').doc(key);
const dayMs = 86_400_000;
const sponsoredSeconds = 180;
const paidSeconds = 600;
const defaultMonthlyMinutes = 60;
const defaultBoardMinutes = 20;
const idPattern = /^[A-Za-z0-9_-]{1,180}$/;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const monthOf = (now: number) => new Date(now).toISOString().slice(0, 7);
const num = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0;
const hostMonth = (key: string, month: string) => db.collection('voice_credit_host_months').doc(hash(`${key}:${month}`));
const boardMonth = (boardId: string, month: string) => db.collection('voice_credit_board_months').doc(hash(`${boardId}:${month}`));
const boardLimitRef = (boardId: string) => db.collection('voice_credit_board_limits').doc(boardId);
const userWallet = (uid: string) => `user_${uid}`;
const publicRegion = 'us-central1';

function integer(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

function readPolicy(data?: DocumentData) {
  return {
    enabled: data?.enabled === true,
    monthlyMinutes: integer(data?.monthlyMinutes, 0, 100_000) ?? defaultMonthlyMinutes,
    boardMinutes: integer(data?.boardMinutes, 0, 100_000) ?? defaultBoardMinutes,
    changedAt: num(data?.changedAt),
    changedBy: typeof data?.changedBy === 'string' ? data.changedBy : null,
    lastDisabledAt: num(data?.lastDisabledAt),
  };
}

export async function voiceCreditsEnabled(): Promise<boolean> {
  return readPolicy((await policyRef.get()).data()).enabled;
}

async function canManageVoiceCredits(uid?: string, claim?: unknown): Promise<boolean> {
  if (!uid || (claim !== true && !superAdmins.value().split(',').map((value) => value.trim()).includes(uid))) return false;
  return (await db.doc(`users/${uid}`).get()).data()?.role === 'admin';
}

function relayUrl(): URL | null {
  try {
    const url = new URL(relay.value());
    return url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash ? url : null;
  } catch {
    return null;
  }
}

function boardHost(board: DocumentData): string | null {
  const teamId = board.team_id;
  const ownerId = board.owner_user_id;
  if (typeof teamId === 'string' && idPattern.test(teamId)) return `team_${teamId}`;
  return typeof ownerId === 'string' && idPattern.test(ownerId) ? userWallet(ownerId) : null;
}

type VoiceActor = { uid?: string; claim?: unknown; guest?: string | null; network?: string };
type VoiceReservation = VoiceActor & {
  boardId: string;
  cardId: string;
  atlasId: string;
  expectedHost: string;
  paid: boolean;
  upstream: string;
  providerUserId: string;
  agentId: string;
  quote?: boolean;
};

export { boardHost as voiceCreditsBoardHost };

function voiceLimit(code: string, message: string, extra: Record<string, unknown> = {}): never {
  throw new HttpsError('resource-exhausted', message, { voiceCreditReason: code, ...extra });
}

export async function reserveBoardVoice(input: VoiceReservation) {
  const admin = await canManageVoiceCredits(input.uid, input.claim);
  const url = relayUrl();
  const now = Date.now();
  const month = monthOf(now);
  const ticket = randomUUID();
  const ref = sessions.doc(ticket);
  const guest = typeof input.guest === 'string' && /^[A-Za-z0-9_-]{12,128}$/.test(input.guest) ? input.guest : null;
  const actor = input.uid ? `uid:${input.uid}` : guest ? `guest:${guest}` : null;
  const gateKeys = input.paid && input.uid ? [hash(`paid:${input.uid}`)]
    : [...new Set([actor, guest ? `guest:${guest}` : null].filter((key): key is string => !!key))]
      .map((key) => hash(`${input.boardId}:${key}`));
  const gateRefs = gateKeys.map((key) => db.collection('voice_credit_visitor_windows').doc(key));
  const networkRef = !input.uid && input.network
    ? db.collection('voice_credit_guest_networks').doc(hash(`${input.boardId}:${input.network}:${Math.floor(now / 3_600_000)}`))
    : null;

  const allowed = await db.runTransaction(async (tx) => {
    const [policySnap, boardSnap] = await Promise.all([
      tx.get(policyRef), tx.get(db.doc(`boards/${input.boardId}`)),
    ]);
    const policy = readPolicy(policySnap.data());
    if (!policy.enabled || admin) return null;
    const board = boardSnap.data();
    // A published board is the source of both visibility and billing ownership.
    if (!board || !isLinkReadableVisibility(board.visibility) || boardHost(board) !== input.expectedHost) {
      throw new HttpsError('failed-precondition', 'This board changed. Reopen the avatar to continue.');
    }
    if (!flattenAnalyticsCards(board.cards, board.owner_user_id === input.uid)
      .some((card) => card.id === input.cardId && card.conversation?.atlasId === input.atlasId)) {
      throw new HttpsError('failed-precondition', 'This avatar changed. Reopen the card to continue.');
    }
    if (!input.quote && (!url || !input.upstream)) throw new HttpsError('unavailable', 'Voice limits are temporarily unavailable.');
    if (!actor) throw new HttpsError('unauthenticated', 'Sign in to use voice.');
    if (input.paid && !input.uid) voiceLimit('sign-in', 'Sign in to continue with your credits.');

    const payer = input.paid ? userWallet(input.uid!) : input.expectedHost;
    const accountRef = wallet(payer);
    const poolRef = hostMonth(payer, month);
    const meterRef = boardMonth(input.boardId, month);
    const [accountSnap, poolSnap, meterSnap, limitSnap, networkSnap, ...gateSnaps] = await Promise.all([
      tx.get(accountRef), tx.get(poolRef), tx.get(meterRef), tx.get(boardLimitRef(input.boardId)),
      networkRef ? tx.get(networkRef) : Promise.resolve(null), ...gateRefs.map((gate) => tx.get(gate)),
    ]);
    const account = accountSnap.data();
    const pool = poolSnap.data();
    const meter = meterSnap.data();
    const gates = gateSnaps.map((snap) => snap.data());
    if (gates.some((gate) => num(gate?.activeUntil) > now)) {
      voiceLimit('in-progress', 'A voice session is still active or its usage is being confirmed. Try again shortly.');
    }
    const windowEndsAt = Math.max(0, ...gates.map((gate) => num(gate?.windowEndsAt)));
    const previousSeconds = Math.max(0, ...gates.filter((gate) => num(gate?.windowEndsAt) > now).map((gate) => num(gate?.seconds)));
    const resuming = windowEndsAt > now && gates
      .filter((gate) => num(gate?.windowEndsAt) > now)
      .every((gate) => gate?.cardId === input.cardId && num(gate?.resumeUntil) > now);
    if (!input.paid && windowEndsAt > now && (!resuming || previousSeconds >= sponsoredSeconds)) {
      voiceLimit('free-used', 'Your sponsored session has ended. Continue with your credits or in text.', { availableAt: windowEndsAt });
    }
    if (!input.paid && !resuming && networkSnap && num(networkSnap.data()?.starts) >= 20) {
      voiceLimit('sign-in', 'Sign in to continue with voice from this network.');
    }

    const availablePaid = Math.max(0, num(account?.seconds) - num(account?.reserved));
    const availableIncluded = input.paid ? 0
      : Math.max(0, policy.monthlyMinutes * 60 - num(pool?.includedUsed) - num(pool?.includedReserved));
    const boardMinutes = integer(limitSnap.data()?.minutes, 0, 100_000) ?? policy.boardMinutes;
    const boardRemaining = Math.max(0, boardMinutes * 60 - num(meter?.used) - num(meter?.reserved));
    const duration = Math.min(input.paid ? paidSeconds : sponsoredSeconds - previousSeconds,
      input.paid ? availablePaid : boardRemaining, availableIncluded + availablePaid);
    if (!duration) {
      if (input.paid) voiceLimit('balance', 'Add voice credits to continue.');
      voiceLimit('sponsored-empty', 'This board has no sponsored voice time left. Continue with your credits or in text.');
    }
    if (input.quote) return duration;
    const included = Math.min(duration, availableIncluded);
    const purchased = duration - included;
    const expiry = now + 40_000;
    tx.create(ref, {
      state: 'ready', expiresAt: expiry, reconcileAt: expiry,
      duration, included, purchased, month, payer, boardId: input.boardId,
      cardId: input.cardId, atlasId: input.atlasId, mode: input.paid ? 'paid' : 'sponsored',
      providerUserId: input.providerUserId, agentId: input.agentId, upstream: input.upstream,
      gateKeys, createdAt: now,
      ...(networkRef && !input.paid && !resuming ? { networkId: networkRef.id } : {}),
    });
    gateRefs.forEach((gate) => tx.set(gate, {
      activeTicket: ticket, activeUntil: now + 90_000 + duration * 1000,
    }, { merge: true }));
    if (networkRef && !input.paid && !resuming) tx.set(networkRef, {
      starts: FieldValue.increment(1), expires_at: new Date(now + dayMs),
    }, { merge: true });
    if (!input.paid) {
      tx.set(poolRef, { includedReserved: FieldValue.increment(included) }, { merge: true });
      tx.set(meterRef, { reserved: FieldValue.increment(duration) }, { merge: true });
    }
    if (purchased) tx.set(accountRef, { reserved: FieldValue.increment(purchased) }, { merge: true });
    return duration;
  });
  if (allowed === null) return null;
  if (input.quote) return { signedUrl: '', seconds: allowed, paid: input.paid };
  url!.protocol = 'wss:';
  url!.pathname = `/session/${ticket}`;
  return { signedUrl: url!.toString(), seconds: allowed, paid: input.paid };
}

export async function settleVoiceCreditSession(ticket: string, actual: number, startedAt?: number, interrupted = false) {
  const ref = sessions.doc(ticket);
  await db.runTransaction(async (tx) => {
    const session = (await tx.get(ref)).data();
    if (!session || session.state === 'settled') return;
    const gates = (session.gateKeys as string[]).map((key) => db.collection('voice_credit_visitor_windows').doc(key));
    const [policy, ...gateSnaps] = await Promise.all([tx.get(policyRef), ...gates.map((gate) => tx.get(gate))]);
    const disabledAt = num(session.disabledAt) || readPolicy(policy.data()).lastDisabledAt;
    const cutoff = startedAt && disabledAt >= session.createdAt
      ? Math.max(0, Math.floor((disabledAt - startedAt) / 1000)) : session.duration;
    const seconds = Math.max(0, Math.min(Math.ceil(actual), session.duration, cutoff));
    const includedUsed = Math.min(seconds, session.included);
    const purchasedUsed = seconds - includedUsed;
    if (session.purchased) {
      tx.set(wallet(session.payer), {
        reserved: FieldValue.increment(-session.purchased), seconds: FieldValue.increment(-purchasedUsed),
      }, { merge: true });
    }
    if (session.mode === 'sponsored') {
      tx.set(hostMonth(session.payer, session.month), {
        includedUsed: FieldValue.increment(includedUsed), includedReserved: FieldValue.increment(-session.included),
        used: FieldValue.increment(seconds),
      }, { merge: true });
      tx.set(boardMonth(session.boardId, session.month), {
        used: FieldValue.increment(seconds), reserved: FieldValue.increment(-session.duration),
      }, { merge: true });
    }
    gates.forEach((gate, index) => {
      const old = gateSnaps[index].data();
      if (old?.activeTicket !== ticket) return;
      const ongoingWindow = num(old.windowEndsAt) > session.createdAt;
      const windowPatch = session.mode === 'sponsored' && startedAt && seconds > 0 ? {
        seconds: (ongoingWindow ? num(old.seconds) : 0) + seconds,
        cardId: session.cardId,
        windowEndsAt: ongoingWindow ? old.windowEndsAt : startedAt + dayMs,
        resumeUntil: interrupted ? Date.now() + 120_000 : 0,
      } : {};
      tx.set(gate, {
        ...windowPatch, activeUntil: 0, activeTicket: null,
        expires_at: new Date(Date.now() + 2 * dayMs),
      }, { merge: true });
    });
    tx.update(ref, {
      state: 'settled', seconds, includedUsed, purchasedUsed, settledAt: Date.now(),
      reconcileAt: FieldValue.delete(), upstream: FieldValue.delete(),
    });
  });
}

export const reconcileVoiceCredits = onSchedule(
  { region: publicRegion, schedule: 'every 1 minutes', secrets: [voiceKey], timeoutSeconds: 55 },
  async () => {
    const pending = await sessions.where('reconcileAt', '<=', Date.now()).limit(50).get();
    await Promise.allSettled(pending.docs.map(async (doc) => {
      const value = doc.data();
      try {
        if (value.state === 'ready' || value.state === 'failed') {
          // Claim and expiration both change the state transactionally.
          await db.runTransaction(async (tx) => {
            const latest = (await tx.get(doc.ref)).data();
            if (latest?.state === 'ready' && latest.expiresAt <= Date.now()) tx.update(doc.ref, { state: 'failed' });
          });
          if ((await doc.ref.get()).data()?.state === 'failed') await settleVoiceCreditSession(doc.id, 0);
          return;
        }
        const headers = { 'xi-api-key': voiceKey.value() };
        let providerId = value.providerId;
        if (typeof providerId !== 'string') {
          const search = new URL('https://api.elevenlabs.io/v1/convai/conversations');
          search.searchParams.set('user_id', value.providerUserId);
          search.searchParams.set('agent_id', value.agentId);
          const response = await fetch(search, { headers, signal: AbortSignal.timeout(6500) });
          if (!response.ok) throw new Error(`Provider lookup status ${response.status}`);
          const list = await response.json();
          providerId = list.conversations?.[0]?.conversation_id;
          if (typeof providerId !== 'string') {
            if (Array.isArray(list.conversations) && !list.conversations.length && Date.now() - value.createdAt > 3_600_000) {
              await settleVoiceCreditSession(doc.id, 0);
              return;
            }
            throw new Error('Provider conversation ID is not available yet.');
          }
        }
        const result = await fetch(`https://api.elevenlabs.io/v1/convai/conversations/${encodeURIComponent(providerId)}`, {
          headers, signal: AbortSignal.timeout(6500),
        });
        if (!result.ok) throw new Error(`Provider status ${result.status}`);
        const report = await result.json();
        const actual = report.metadata?.call_duration_secs;
        const start = report.metadata?.start_time_unix_secs;
        if (report.conversation_id !== providerId || report.user_id !== value.providerUserId || report.agent_id !== value.agentId
          || !['done', 'failed'].includes(report.status) || !Number.isFinite(actual) || !Number.isFinite(start)) {
          throw new Error('Provider has not confirmed this completed session.');
        }
        await settleVoiceCreditSession(doc.id, actual, start * 1000, value.interrupted === true);
      } catch (error) {
        logger.warn('Voice credit settlement pending', { ticket: doc.id, error: String(error) });
        if (Date.now() - value.createdAt >= 7_200_000) {
          logger.error('Releasing unverified voice reservation without a charge', { ticket: doc.id });
          await settleVoiceCreditSession(doc.id, 0);
          return;
        }
        await db.runTransaction(async (tx) => {
          if ((await tx.get(doc.ref)).data()?.state !== 'settled') {
            tx.update(doc.ref, { reconcileAt: Date.now() + 120_000 });
          }
        });
      }
    }));
  },
);

const packMinutes = 60;
const purchaseSessionPattern = /^cs_(?:test|live)_[A-Za-z0-9]+$/;

export async function fulfillVoiceCreditPurchase(session: Stripe.Checkout.Session): Promise<boolean> {
  const id = session.metadata?.voiceCreditOrder;
  if (session.metadata?.source !== 'voice_credits' || !id || !idPattern.test(id)
    || session.mode !== 'payment' || session.payment_status !== 'paid') return false;
  return db.runTransaction(async (tx) => {
    const ref = purchases.doc(id);
    const order = (await tx.get(ref)).data();
    if (!order || order.sessionId !== session.id || order.uid !== session.client_reference_id
      || session.livemode !== order.live || typeof session.payment_intent !== 'string') return false;
    if (order.state === 'paid') return true;
    if (order.state !== 'pending' || !session.amount_total || session.amount_total !== order.amount
      || session.currency !== order.currency || (order.paymentIntent && order.paymentIntent !== session.payment_intent)) return false;
    tx.set(wallet(order.payer), { seconds: FieldValue.increment(order.seconds - num(order.revokedSeconds)) }, { merge: true });
    tx.update(ref, { state: 'paid', paymentIntent: session.payment_intent, paidAt: Date.now() });
    return true;
  });
}

export async function refundVoiceCreditPurchase(charge: Stripe.Charge, dispute?: { id: string; closed: boolean; lost: boolean }) {
  const id = charge.metadata?.voiceCreditOrder;
  if (charge.metadata?.source !== 'voice_credits' || !id || !idPattern.test(id)
    || typeof charge.payment_intent !== 'string') return;
  const ref = purchases.doc(id);
  await db.runTransaction(async (tx) => {
    const order = (await tx.get(ref)).data();
    if (!order || order.amount !== charge.amount || order.currency !== charge.currency || order.live !== charge.livemode
      || (order.paymentIntent && order.paymentIntent !== charge.payment_intent)) return;
    const disputes: Record<string, { closed: boolean; lost: boolean }> = { ...order.disputes };
    if (dispute && idPattern.test(dispute.id) && !disputes[dispute.id]?.closed) {
      disputes[dispute.id] = { closed: dispute.closed, lost: dispute.lost };
    }
    const refundedAmount = Math.max(num(order.refundedAmount), charge.amount_refunded);
    const blocked = Object.values(disputes).some((item) => !item.closed || item.lost);
    const revokedSeconds = blocked ? order.seconds : Math.min(order.seconds, Math.floor(order.seconds * refundedAmount / order.amount));
    const delta = num(order.revokedSeconds) - revokedSeconds;
    if (delta && order.state === 'paid') tx.set(wallet(order.payer), { seconds: FieldValue.increment(delta) }, { merge: true });
    tx.update(ref, { paymentIntent: charge.payment_intent, disputes, refundedAmount, revokedSeconds });
  });
}

async function resolvePayer(uid: string, teamId: unknown): Promise<string> {
  if (typeof teamId !== 'string' || !teamId) return userWallet(uid);
  if (!idPattern.test(teamId)) throw new HttpsError('invalid-argument', 'Invalid team.');
  const membership = await requireTeamMember(teamId, uid);
  if (membership.member.role !== 'owner' && membership.member.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Only team admins can manage team voice credits.');
  }
  return `team_${teamId}`;
}

function checkoutReturn(data: Record<string, unknown>): URL {
  const origin = typeof data.origin === 'string' ? data.origin : '';
  if (!allowedCheckoutOrigins.has(origin)) throw new HttpsError('invalid-argument', 'Invalid checkout origin.');
  const path = typeof data.returnPath === 'string' && /^\/(?:boards(?:\/|\?|$)|voice-usage(?:\?|$))/.test(data.returnPath)
    && !/[\\\r\n]/.test(data.returnPath) ? data.returnPath : '/voice-usage';
  const url = new URL(path, origin);
  if (url.origin !== origin) throw new HttpsError('invalid-argument', 'Invalid checkout return page.');
  url.searchParams.delete('voiceCheckout');
  url.searchParams.delete('voiceSession');
  return url;
}

export const voiceCreditsCommand = onCall({ region: publicRegion, cors: true, secrets: [stripeSecretKey] }, async (request) => {
  const action = request.data?.action;
  const uid = request.auth?.token.firebase?.sign_in_provider === 'anonymous' ? undefined : request.auth?.uid;
  const policy = readPolicy((await policyRef.get()).data());
  if (action === 'status') {
    const admin = await canManageVoiceCredits(uid, request.auth?.token.voiceCreditsSuperAdmin);
    return { enabled: policy.enabled, admin, ...(admin ? { policy, checkoutConfigured: !!packPrice.value(), relayConfigured: !!relayUrl() } : {}) };
  }
  if (action === 'quote') {
    if (!policy.enabled) return null;
    const { boardId, cardId } = request.data;
    if (typeof boardId !== 'string' || !idPattern.test(boardId) || typeof cardId !== 'string' || !idPattern.test(cardId)) {
      throw new HttpsError('invalid-argument', 'Choose a valid board and avatar.');
    }
    const board = (await db.doc(`boards/${boardId}`).get()).data();
    const host = board && boardHost(board);
    if (!board || !host || !isLinkReadableVisibility(board.visibility)) return null;
    const card = flattenAnalyticsCards(board.cards, board.owner_user_id === uid).find((item) => item.id === cardId);
    if (!card?.conversation?.atlasId) return null;
    const result = await reserveBoardVoice({
      boardId, cardId, atlasId: card.conversation.atlasId, expectedHost: host, uid, claim: request.auth?.token.voiceCreditsSuperAdmin,
      guest: request.data.guest, network: request.rawRequest.ip, paid: false,
      quote: true, upstream: '', providerUserId: '', agentId: '',
    });
    return result ? { seconds: result.seconds } : null;
  }
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to manage voice credits.');
  if (action === 'set-policy') {
    if (!await canManageVoiceCredits(uid, request.auth?.token.voiceCreditsSuperAdmin)) {
      throw new HttpsError('permission-denied', 'Super admin access is required.');
    }
    const enabled = request.data.enabled;
    const monthlyMinutes = integer(request.data.monthlyMinutes, 0, 100_000);
    const boardMinutes = integer(request.data.boardMinutes, 0, 100_000);
    if (typeof enabled !== 'boolean' || monthlyMinutes === null || boardMinutes === null) {
      throw new HttpsError('invalid-argument', 'Enter valid voice limits.');
    }
    if (enabled) {
      const url = relayUrl();
      if (!url || !/^price_[A-Za-z0-9]+$/.test(packPrice.value())) {
        throw new HttpsError('failed-precondition', 'Configure the voice relay and Stripe credit price before enabling limits.');
      }
      const [health, price] = await Promise.all([
        fetch(new URL('/healthz', url), { redirect: 'error', signal: AbortSignal.timeout(5000) }).catch(() => null),
        getStripeClient().prices.retrieve(packPrice.value()),
      ]);
      if (!health?.ok || (await health.text()).trim() !== 'livingwiki-voice-relay' || !price.active
        || price.type !== 'one_time' || !price.unit_amount) {
        throw new HttpsError('failed-precondition', 'The voice relay or Stripe credit price is not ready.');
      }
    }
    return db.runTransaction(async (tx) => {
      const current = readPolicy((await tx.get(policyRef)).data());
      if (request.data.expectedChangedAt !== current.changedAt) {
        throw new HttpsError('aborted', 'Voice limits changed in another session. Refresh and try again.');
      }
      const changedAt = Math.max(Date.now(), current.changedAt + 1);
      const next = {
        enabled, monthlyMinutes, boardMinutes, changedAt, changedBy: uid,
        lastDisabledAt: !enabled && current.enabled ? changedAt : current.lastDisabledAt,
      };
      tx.set(policyRef, next);
      tx.create(db.collection('voice_credit_admin_log').doc(), { previous: current, ...next });
      return { enabled, admin: true, policy: next, checkoutConfigured: !!packPrice.value(), relayConfigured: !!relayUrl() };
    });
  }
  if (action === 'confirm') {
    const id = request.data.sessionId;
    if (typeof id !== 'string' || !purchaseSessionPattern.test(id)) throw new HttpsError('invalid-argument', 'Invalid payment session.');
    const session = await getStripeClient().checkout.sessions.retrieve(id);
    if (session.client_reference_id !== uid || session.metadata?.source !== 'voice_credits') {
      throw new HttpsError('permission-denied', 'This payment belongs to another account.');
    }
    return { paid: await fulfillVoiceCreditPurchase(session), expired: session.status === 'expired' };
  }
  if (!policy.enabled) throw new HttpsError('failed-precondition', 'Voice credits are currently off.');

  const payer = await resolvePayer(uid, request.data?.teamId);
  const month = monthOf(Date.now());
  if (action === 'wallet') {
    const [account, usage, boards] = await Promise.all([
      wallet(payer).get(), hostMonth(payer, month).get(),
      payer.startsWith('team_')
        ? db.collection('boards').where('team_id', '==', payer.slice(5)).get()
        : db.collection('boards').where('owner_user_id', '==', uid).get(),
    ]);
    const hosted = boards.docs.filter((doc) => boardHost(doc.data()) === payer && isLinkReadableVisibility(doc.data().visibility));
    const refs = hosted.flatMap((doc) => [boardLimitRef(doc.id), boardMonth(doc.id, month)]);
    const details = refs.length ? await db.getAll(...refs) : [];
    const resetAt = Date.parse(`${month}-01T00:00:00Z`);
    const reset = new Date(resetAt);
    reset.setUTCMonth(reset.getUTCMonth() + 1);
    return {
      seconds: Math.max(0, num(account.data()?.seconds) - num(account.data()?.reserved)),
      includedRemaining: Math.max(0, policy.monthlyMinutes * 60 - num(usage.data()?.includedUsed) - num(usage.data()?.includedReserved)),
      hostedSeconds: num(usage.data()?.used), resetAt: reset.getTime(), packMinutes,
      boards: hosted.map((doc, index) => ({
        id: doc.id, title: typeof doc.data().title === 'string' ? doc.data().title : doc.id,
        minutes: integer(details[index * 2].data()?.minutes, 0, 100_000) ?? policy.boardMinutes,
        used: num(details[index * 2 + 1].data()?.used),
      })),
    };
  }
  if (action === 'board-cap') {
    const boardId = request.data.boardId;
    const minutes = integer(request.data.minutes, 0, 100_000);
    if (typeof boardId !== 'string' || !idPattern.test(boardId) || minutes === null) {
      throw new HttpsError('invalid-argument', 'Choose a board and enter a valid cap.');
    }
    await db.runTransaction(async (tx) => {
      const board = (await tx.get(db.doc(`boards/${boardId}`))).data();
      if (!board || boardHost(board) !== payer) throw new HttpsError('permission-denied', 'You cannot manage this board’s credits.');
      if (!readPolicy((await tx.get(policyRef)).data()).enabled) throw new HttpsError('failed-precondition', 'Voice credits are currently off.');
      tx.set(boardLimitRef(boardId), { minutes, changedBy: uid, changedAt: Date.now() });
    });
    return { saved: true };
  }
  if (action === 'checkout') {
    const priceId = packPrice.value();
    if (!/^price_[A-Za-z0-9]+$/.test(priceId)) throw new HttpsError('failed-precondition', 'Credit purchases are not configured.');
    const url = checkoutReturn(request.data);
    const stripe = getStripeClient();
    const price = await stripe.prices.retrieve(priceId);
    if (!price.active || price.type !== 'one_time' || !price.unit_amount) {
      throw new HttpsError('failed-precondition', 'Credit purchases are temporarily unavailable.');
    }
    const order = purchases.doc();
    const success = new URL(url);
    success.searchParams.set('voiceCheckout', 'success');
    url.searchParams.set('voiceCheckout', 'cancelled');
    const session = await stripe.checkout.sessions.create({
      mode: 'payment', line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: uid,
      metadata: { source: 'voice_credits', voiceCreditOrder: order.id },
      payment_intent_data: { metadata: { source: 'voice_credits', voiceCreditOrder: order.id } },
      success_url: `${success.href}&voiceSession={CHECKOUT_SESSION_ID}`,
      cancel_url: url.href,
    }, { idempotencyKey: `voice-credits-${order.id}` });
    if (!session.url) throw new HttpsError('unavailable', 'Checkout could not start.');
    await order.create({
      sessionId: session.id, uid, payer, seconds: packMinutes * 60,
      live: session.livemode, amount: price.unit_amount, currency: price.currency,
      state: 'pending', createdAt: Date.now(),
    });
    return { url: session.url };
  }
  throw new HttpsError('invalid-argument', 'Unknown voice credit action.');
});
