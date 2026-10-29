import { createHash, randomUUID } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as logger from 'firebase-functions/logger';
import { db } from './firebase';
import { resolveCityGuide } from './city-guide';
import { hasPlatformVisitorMessage, requirePlatformAnalyticsAdmin } from './platform-analytics';

type Data = Record<string, any>;
export type PicamoTracking = { sessionId: string; requestId: string };
type Binding = {
  actor: string;
  account: boolean;
  internal: boolean;
  source: 'assistant' | 'city';
  label: string;
  atlasId: string;
};
type Trace = {
  requestId: string;
  sessionId: string;
  binding: Binding;
  day: string;
  startedAt: number;
};
const options = { region: 'us-central1', cors: true };
const voiceKey = defineSecret('ELEVENLABS_API_KEY');
const DAY = 86400000;
const IDLE = 30 * 60000;
const sessions = db.collection('picamo_analytics_sessions');
const requests = db.collection('picamo_analytics_requests');
const daily = db.collection('picamo_analytics_daily');
const participants = db.collection('picamo_analytics_participants');
const scopes = db.collection('picamo_analytics_scopes');
const voices = db.collection('picamo_analytics_voice_sessions');
const providers = db.collection('picamo_analytics_providers');
const state = db.collection('picamo_analytics_meta').doc('state');
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{16,180}$/.test(v);
const tracking = (v: any): v is PicamoTracking => !!v && id(v.sessionId) && id(v.requestId);
const shard = (v: string) => parseInt(hash(v).slice(0, 8), 16) % 16;
const dailyRef = (b: Binding, day: string) =>
  daily.doc(
    `${day}_${b.source}_${hash(b.atlasId).slice(0, 16)}_${Number(b.internal)}_${shard(b.actor)}`,
  );
const publicBinding = (b: Binding) => ({
  source: b.source,
  label: b.label,
  atlasId: b.atlasId,
  actor: b.actor,
  account: b.account,
  internal: b.internal,
});
function writeDay(tx: FirebaseFirestore.Transaction, b: Binding, day: string, values: Data) {
  tx.set(
    dailyRef(b, day),
    {
      day,
      source: b.source,
      atlasId: b.atlasId,
      label: b.label,
      internal: b.internal,
      ...Object.fromEntries(Object.entries(values).map(([k, v]) => [k, FieldValue.increment(v)])),
      updatedAt: Timestamp.now(),
    },
    { merge: true },
  );
  // One participant per UTC day and source; period uniques are sets, never sums of daily counts.
  tx.set(participants.doc(hash(`${day}:${b.source}:${b.atlasId}:${b.actor}:${b.internal}`)), {
    day,
    source: b.source,
    atlasId: b.atlasId,
    internal: b.internal,
    actor: b.actor,
    account: b.account,
  });
}
async function binding(
  source: 'assistant' | 'city',
  uid?: string | null,
  anonymous?: string | null,
  atlasId = '',
): Promise<Binding | null> {
  if (!uid && !id(anonymous)) return null;
  let label = 'Assistant';
  if (source === 'city') {
    if (!/^[A-Za-z0-9_-]{1,180}$/.test(atlasId)) return null;
    const atlas = (await db.collection('atlases').doc(atlasId).get()).data();
    const guide = resolveCityGuide(atlas);
    if (!guide || guide.city_persona_override) return null;
    label = String(atlas?.city_config?.city_name || atlas?.name || 'City guide').slice(0, 120);
  }
  const internal = !!uid && (await db.collection('users').doc(uid).get()).data()?.role === 'admin';
  return {
    actor: hash(uid ? `uid:${uid}` : `guest:${anonymous}`),
    account: !!uid,
    internal,
    source,
    label,
    atlasId,
  };
}
export async function beginPicamoText(
  b: Binding,
  meta: PicamoTracking,
  now = Date.now(),
): Promise<Trace> {
  const requestId = hash(`${b.actor}:${b.source}:${b.atlasId}:${meta.sessionId}:${meta.requestId}`);
  return db.runTransaction(async (tx) => {
    const requestRef = requests.doc(requestId);
    const previous = (await tx.get(requestRef)).data();
    if (previous) return previous.trace as Trace;
    const scopeRef = scopes.doc(hash(`${b.actor}:${b.source}:${b.atlasId}:${meta.sessionId}`));
    const scope = (await tx.get(scopeRef)).data();
    const sessionId =
      scope && now - scope.lastAt < IDLE ? scope.sessionId : hash(`${requestId}:session`);
    const sessionRef = sessions.doc(sessionId);
    const session = (await tx.get(sessionRef)).data();
    const metaState = await tx.get(state);
    const day = dayOf(now),
      trace = { requestId, sessionId, binding: b, day, startedAt: now };
    tx.create(requestRef, { trace, status: 'pending', localClosed: false });
    if (!metaState.exists || now < metaState.data()!.trackingSince.toMillis())
      tx.set(state, { trackingSince: Timestamp.fromMillis(now) });
    tx.set(scopeRef, { sessionId, lastAt: Math.max(now, scope?.lastAt || 0) });
    tx.set(
      sessionRef,
      {
        ...publicBinding(b),
        mode: 'text',
        startedAt: session?.startedAt || now,
        lastAt: Math.max(now, session?.lastAt || 0),
        latestRequestAt: Math.max(now, session?.latestRequestAt || 0),
        ...(now >= (session?.latestRequestAt || 0) ? { latestRequestId: requestId } : {}),
        messages: FieldValue.increment(1),
        seconds: null,
        status: 'active',
        ...(session ? {} : { successes: 0, failures: 0 }),
      },
      { merge: true },
    );
    writeDay(tx, b, day, { conversations: session ? 0 : 1, text: session ? 0 : 1, messages: 1 });
    return trace;
  });
}
export async function finishPicamoText(
  trace: Trace,
  outcome: 'success' | 'failed' | 'handled' | 'interrupted',
  now = Date.now(),
  responseMs?: number,
) {
  await db.runTransaction(async (tx) => {
    const requestRef = requests.doc(trace.requestId),
      sessionRef = sessions.doc(trace.sessionId);
    const [requestSnap, sessionSnap] = await tx.getAll(requestRef, sessionRef);
    const request = requestSnap.data(),
      session = sessionSnap.data();
    if (!request || !session) return;
    const backend = outcome === 'success' || outcome === 'failed';
    // UI-only interactions do not claim a successful model response. A later backend receipt wins.
    if (backend ? ['success', 'failed'].includes(request.status) : request.status !== 'pending')
      return;
    tx.update(requestRef, { status: outcome, finishedAt: now });
    if (backend)
      writeDay(tx, trace.binding, trace.day, {
        successes: Number(outcome === 'success'),
        failures: Number(outcome === 'failed'),
        responseMs: Math.max(0, responseMs ?? now - trace.startedAt),
        responses: 1,
      });
    tx.update(sessionRef, {
      ...(backend
        ? {
            successes: FieldValue.increment(Number(outcome === 'success')),
            failures: FieldValue.increment(Number(outcome === 'failed')),
          }
        : {}),
      ...(session.latestRequestId === trace.requestId
        ? {
            status:
              outcome === 'failed'
                ? 'failed'
                : outcome === 'interrupted'
                  ? 'interrupted'
                  : 'active',
          }
        : {}),
    });
  });
}
async function safe<T>(work: () => Promise<T>): Promise<T | null> {
  try {
    return await work();
  } catch (error) {
    logger.warn('Picamo analytics unavailable; interaction continues', { error: String(error) });
    return null;
  }
}
export async function trackPicamoCityText<T>(
  p: {
    atlasId: string | null;
    uid?: string | null;
    anonymous?: string | null;
    tracking?: PicamoTracking;
  },
  handler: () => Promise<T>,
): Promise<T> {
  const trace = tracking(p.tracking)
    ? await safe(async () => {
        const b = await binding('city', p.uid, p.anonymous, p.atlasId || '');
        return b ? beginPicamoText(b, p.tracking!) : null;
      })
    : null;
  return finishTracked(trace, handler);
}
async function finishTracked<T>(trace: Trace | null, handler: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await handler();
    if (trace)
      await safe(() => finishPicamoText(trace, 'success', Date.now(), Date.now() - startedAt));
    return result;
  } catch (error) {
    if (trace)
      await safe(() => finishPicamoText(trace, 'failed', Date.now(), Date.now() - startedAt));
    throw error;
  }
}
export function withPicamoAssistantText<T>(handler: (request: any, stream?: any) => Promise<T>) {
  return async (request: any, stream?: any): Promise<T> => {
    const meta = request.data?.picamoTracking;
    const trace =
      request.auth?.uid && tracking(meta) && String(request.data?.message || '').trim()
        ? await safe(async () =>
            beginPicamoText((await binding('assistant', request.auth.uid))!, meta),
          )
        : null;
    return finishTracked(trace, () => handler(request, stream));
  };
}
// Local intake questions and wizard navigation are real user turns, but not model answers.
export const recordPicamoAssistantInteraction = onCall(
  { ...options, timeoutSeconds: 15 },
  async (request) => {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in to use Picamo.');
    const meta = request.data?.picamoTracking;
    if (!tracking(meta)) throw new HttpsError('invalid-argument', 'Invalid Picamo interaction.');
    const trace = await beginPicamoText((await binding('assistant', request.auth.uid))!, meta);
    if (request.data?.phase === 'finish')
      await finishPicamoText(trace, request.data?.interrupted === true ? 'interrupted' : 'handled');
    return { recorded: true };
  },
);

export async function issuePicamoVoice(
  source: 'assistant' | 'city',
  uid: string | null,
  anonymous: string | null,
  agentId: string,
  atlasId = '',
): Promise<string | null> {
  return safe(async () => {
    const b = await binding(source, uid, anonymous, atlasId);
    if (!b) return null;
    const nonce = `pca_${randomUUID()}`;
    await voices
      .doc(nonce)
      .create({
        ...publicBinding(b),
        agentId,
        issuedAt: Date.now(),
        status: 'waiting',
        attempts: 0,
        nextSyncAt: Timestamp.fromMillis(Date.now() + 5 * 60000),
      });
    return nonce;
  });
}
/** Only server-verified provider payloads enter this function. No transcript text is retained. */
export async function recordPicamoVerifiedVoice(nonce: string, job: Data, details: Data) {
  if (details.user_id !== nonce || details.agent_id !== job.agentId || !id(details.conversation_id))
    throw new HttpsError('permission-denied', 'This Picamo call could not be verified.');
  if (!['done', 'failed'].includes(details.status)) return false;
  const turns = (Array.isArray(details.transcript) ? details.transcript : []).filter(
    hasPlatformVisitorMessage,
  );
  if (!turns.length) return true;
  const startedAt = Number(details.metadata?.start_time_unix_secs) * 1000;
  if (!Number.isFinite(startedAt) || Math.abs(startedAt - job.issuedAt) > DAY)
    throw new Error('Invalid Picamo voice start time.');
  const rawSeconds = details.metadata?.call_duration_secs;
  const seconds =
    typeof rawSeconds === 'number' &&
    Number.isFinite(rawSeconds) &&
    rawSeconds >= 0 &&
    rawSeconds <= DAY / 1000
      ? rawSeconds
      : null;
  const b = job as Binding,
    days = new Map<string, Data>();
  const add = (day: string, metric: string, n: number) => {
    const row = days.get(day) || {};
    row[metric] = (row[metric] || 0) + n;
    days.set(day, row);
  };
  const firstDay = dayOf(startedAt);
  add(firstDay, 'conversations', 1);
  add(firstDay, 'voice', 1);
  if (seconds === null) add(firstDay, 'unknownDurations', 1);
  for (const turn of turns) {
    const offset =
      typeof turn.time_in_call_secs === 'number' && Number.isFinite(turn.time_in_call_secs)
        ? Math.max(0, Math.min(seconds ?? DAY / 1000, turn.time_in_call_secs)) * 1000
        : 0;
    add(dayOf(startedAt + offset), 'messages', 1);
  }
  if (seconds !== null) {
    for (let cursor = startedAt, end = startedAt + seconds * 1000; cursor < end; ) {
      const next = Math.min(end, (Math.floor(cursor / DAY) + 1) * DAY);
      add(dayOf(cursor), 'seconds', (next - cursor) / 1000);
      cursor = next;
    }
  }
  await db.runTransaction(async (tx) => {
    const receipt = providers.doc(hash(details.conversation_id));
    if ((await tx.get(receipt)).exists) return;
    const metaState = await tx.get(state);
    tx.create(receipt, { nonce, recordedAt: Timestamp.now() });
    if (!metaState.exists || startedAt < metaState.data()!.trackingSince.toMillis())
      tx.set(state, { trackingSince: Timestamp.fromMillis(startedAt) });
    tx.set(sessions.doc(nonce), {
      ...publicBinding(b),
      mode: 'voice',
      startedAt,
      lastAt: seconds === null ? startedAt : startedAt + seconds * 1000,
      messages: turns.length,
      seconds,
      status: details.status === 'done' ? 'completed' : 'interrupted',
      successes: 0,
      failures: 0,
    });
    for (const [day, values] of days) writeDay(tx, b, day, values);
  });
  return true;
}
async function providerDetails(conversationId: string, apiKey: string) {
  const response = await fetch(
    `https://api.elevenlabs.io/v1/convai/conversations/${encodeURIComponent(conversationId)}`,
    {
      headers: { 'xi-api-key': apiKey },
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok) throw new Error(`Picamo voice verification returned ${response.status}`);
  return response.json() as Promise<Data>;
}
async function syncVoice(nonce: string, apiKey: string, suppliedId?: string) {
  const ref = voices.doc(nonce),
    job = (await ref.get()).data();
  if (!job || job.status === 'done') return;
  let conversationId = job.conversationId;
  if (suppliedId && conversationId && suppliedId !== conversationId)
    throw new HttpsError('permission-denied', 'This call is already attached.');
  if (!conversationId && !suppliedId) {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversations?user_id=${encodeURIComponent(nonce)}&agent_id=${encodeURIComponent(job.agentId)}&page_size=10`,
      {
        headers: { 'xi-api-key': apiKey },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok) throw new Error(`Picamo voice recovery returned ${response.status}`);
    const list = (await response.json()) as Data;
    conversationId = list.conversations?.find(
      (v: Data) => v.agent_id === job.agentId,
    )?.conversation_id;
  }
  conversationId ||= suppliedId;
  if (!conversationId || !id(conversationId)) return;
  const details = await providerDetails(conversationId, apiKey);
  if (
    details.user_id !== nonce ||
    details.agent_id !== job.agentId ||
    details.conversation_id !== conversationId
  )
    throw new HttpsError('permission-denied', 'This Picamo call could not be verified.');
  await ref.update({ conversationId });
  if (await recordPicamoVerifiedVoice(nonce, job, details))
    await ref.update({ status: 'done', nextSyncAt: FieldValue.delete() });
}
export const syncPicamoVoiceAnalytics = onCall(
  { ...options, timeoutSeconds: 45, secrets: [voiceKey] },
  async (request) => {
    const nonce = request.data?.sessionId,
      conversationId = request.data?.conversationId;
    if (typeof nonce !== 'string' || !/^pca_[A-Za-z0-9-]{36}$/.test(nonce) || !id(conversationId))
      throw new HttpsError('invalid-argument', 'Invalid Picamo call.');
    const job = (await voices.doc(nonce).get()).data();
    const uid = request.auth?.uid,
      anonymous = request.data?.anonymousVisitorId;
    const actor = uid ? hash(`uid:${uid}`) : id(anonymous) ? hash(`guest:${anonymous}`) : '';
    if (!job || !actor || job.actor !== actor)
      throw new HttpsError('permission-denied', 'This Picamo call is not available.');
    await syncVoice(nonce, voiceKey.value(), conversationId);
    return { pending: (await voices.doc(nonce).get()).data()?.status !== 'done' };
  },
);
/** Reuses the existing five-minute voice recovery schedule, with bounded work. */
export async function recoverPicamoVoice(apiKey: string) {
  const pending = await voices
    .where('nextSyncAt', '<=', Timestamp.now())
    .orderBy('nextSyncAt')
    .limit(15)
    .get();
  const deadline = Date.now() + 60000;
  for (const doc of pending.docs) {
    if (Date.now() >= deadline) break;
    const job = doc.data();
    if (Date.now() - job.issuedAt > DAY) {
      await doc.ref.update({ status: 'unverified', nextSyncAt: FieldValue.delete() });
      continue;
    }
    await safe(() => syncVoice(doc.id, apiKey));
    if ((await doc.ref.get()).data()?.status !== 'done')
      await doc.ref.update({
        nextSyncAt: Timestamp.fromMillis(
          Date.now() + Math.min(60, 5 * 2 ** Math.min(job.attempts || 0, 4)) * 60000,
        ),
        attempts: FieldValue.increment(1),
      });
  }
}

const metricKeys = [
  'conversations',
  'text',
  'voice',
  'messages',
  'seconds',
  'unknownDurations',
  'successes',
  'failures',
  'responses',
  'responseMs',
] as const;
const empty = () =>
  Object.fromEntries(metricKeys.map((k) => [k, 0])) as Record<(typeof metricKeys)[number], number>;
const caches = new Map<string, { until: number; value: Data }>();
export function picamoDateRange(input: Data) {
  const today = dayOf(Date.now());
  const from = input.from || dayOf(Date.now() - 29 * DAY),
    to = input.to || today;
  const valid = (s: unknown): s is string =>
    typeof s === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    Number.isFinite(Date.parse(s)) &&
    dayOf(Date.parse(s)) === s;
  if (
    !valid(from) ||
    !valid(to) ||
    from > to ||
    to > today ||
    Date.parse(to) - Date.parse(from) > 10 * 366 * DAY
  )
    throw new HttpsError('invalid-argument', 'Choose valid dates within a ten-year range.');
  return {
    from,
    to,
    group: ['day', 'month', 'year'].includes(input.group) ? input.group : 'day',
    source: ['assistant', 'city'].includes(input.source) ? input.source : 'all',
    atlasId:
      input.source === 'city' &&
      typeof input.atlasId === 'string' &&
      /^[A-Za-z0-9_-]{1,180}$/.test(input.atlasId)
        ? input.atlasId
        : '',
    includeInternal: input.includeInternal === true,
  };
}
async function bounded(query: FirebaseFirestore.Query, limit = 50000) {
  const snapshot = await query.limit(limit + 1).get();
  if (snapshot.size > limit)
    throw new HttpsError(
      'resource-exhausted',
      'This report is too large. Choose a shorter date range or a single source.',
    );
  return snapshot.docs.map((d) => d.data());
}
export async function readPicamoAnalytics(input: Data) {
  const range = picamoDateRange(input),
    key = JSON.stringify(range);
  let summary =
    input.refresh !== true && caches.get(key)?.until! > Date.now() ? caches.get(key)!.value : null;
  const period = (day: string) =>
    range.group === 'year' ? day.slice(0, 4) : range.group === 'month' ? day.slice(0, 7) : day;
  const scopeMatches = (r: Data) =>
    (range.includeInternal || !r.internal) && (range.source === 'all' || r.source === range.source);
  const matches = (r: Data) => scopeMatches(r) && (!range.atlasId || r.atlasId === range.atlasId);
  if (!summary) {
    const [days, people, meta] = await Promise.all([
      bounded(daily.where('day', '>=', range.from).where('day', '<=', range.to)),
      bounded(participants.where('day', '>=', range.from).where('day', '<=', range.to)),
      state.get(),
    ]);
    const series = new Map<string, Data>();
    const trackingSince = meta.data()?.trackingSince?.toDate().toISOString() || null;
    for (let stamp = Date.parse(range.from); stamp <= Date.parse(range.to); stamp += DAY) {
      const day = dayOf(stamp),
        p = period(day),
        row = series.get(p) || { period: p, ...empty(), recorded: false, partial: false };
      if (trackingSince && day >= trackingSince.slice(0, 10)) row.recorded = true;
      else row.partial = true;
      if (day === dayOf(Date.now()) || day === trackingSince?.slice(0, 10)) row.partial = true;
      series.set(p, row);
    }
    const cities = new Map<string, { atlasId: string; label: string }>();
    for (const d of days.filter(scopeMatches))
      if (d.source === 'city') cities.set(d.atlasId, { atlasId: d.atlasId, label: d.label });
    const totals = empty(),
      sources = new Map<string, Data>();
    for (const d of days.filter(matches)) {
      const p = series.get(period(d.day))!,
        source = sources.get(d.source) || { source: d.source, ...empty() };
      for (const k of metricKeys) {
        const n = Number(d[k]) || 0;
        totals[k] += n;
        p[k] += n;
        source[k] += n;
      }
      sources.set(d.source, source);
    }
    const accounts = new Set<string>(),
      guests = new Set<string>();
    for (const p of people.filter(matches)) (p.account ? accounts : guests).add(p.actor);
    summary = {
      range,
      trackingSince,
      totals: { ...totals, accounts: accounts.size, guests: guests.size },
      cities: [...cities.values()].sort((a, b) => a.label.localeCompare(b.label)),
      sources: [...sources.values()],
      series: [...series.values()],
      updatedAt: new Date().toISOString(),
      coverage: {
        unrecorded: !trackingSince || range.to < trackingSince.slice(0, 10),
        partial: !trackingSince || range.from <= trackingSince.slice(0, 10),
      },
    };
    // Bounded per-instance cache: a report never starts an AI request or provider lookup.
    if (caches.size >= 30) caches.delete(caches.keys().next().value!);
    caches.set(key, { until: Date.now() + 30000, value: summary });
  }
  const recentFrom = input.recentFrom || range.from,
    recentTo = input.recentTo || range.to;
  if (
    typeof recentFrom !== 'string' ||
    typeof recentTo !== 'string' ||
    recentFrom < range.from ||
    recentTo > range.to ||
    recentFrom > recentTo ||
    !/^\d{4}-\d{2}-\d{2}$/.test(recentFrom) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(recentTo)
  )
    throw new HttpsError('invalid-argument', 'Choose a recent activity date within this report.');
  let query: FirebaseFirestore.Query = sessions
    .where('startedAt', '>=', Date.parse(recentFrom))
    .where('startedAt', '<', Date.parse(recentTo) + DAY);
  if (!range.includeInternal) query = query.where('internal', '==', false);
  if (range.source !== 'all') query = query.where('source', '==', range.source);
  if (range.atlasId) query = query.where('atlasId', '==', range.atlasId);
  if (['text', 'voice'].includes(input.mode)) query = query.where('mode', '==', input.mode);
  query = query.orderBy('startedAt', 'desc').orderBy('__name__', 'desc');
  if (input.cursor) {
    if (!input.cursor || typeof input.cursor.startedAt !== 'number' || !id(input.cursor.id))
      throw new HttpsError('invalid-argument', 'Invalid analytics page.');
    query = query.startAfter(input.cursor.startedAt, input.cursor.id);
  }
  const limit = input.export === true ? 20000 : 25,
    snapshot = await query.limit(limit + 1).get();
  if (input.export === true && snapshot.size > limit)
    throw new HttpsError(
      'resource-exhausted',
      'Export exceeds 20,000 conversations. Choose a shorter date range.',
    );
  const docs = snapshot.docs.slice(0, limit);
  const rows = docs.map((doc) => {
    const d = doc.data();
    return {
      id: doc.id,
      source: d.source,
      label: d.label,
      atlasId: d.atlasId,
      mode: d.mode,
      startedAt: new Date(d.startedAt).toISOString(),
      messages: d.messages,
      seconds: d.mode === 'voice' ? d.seconds : Math.max(0, (d.lastAt - d.startedAt) / 1000),
      status: d.status === 'active' && Date.now() - d.lastAt >= IDLE ? 'completed' : d.status,
      failures: d.failures || 0,
      internal: d.internal === true,
    };
  });
  const last = docs.at(-1);
  return {
    ...summary,
    rows,
    nextCursor:
      snapshot.size > limit && last ? { id: last.id, startedAt: last.data().startedAt } : null,
  };
}
export const getPicamoAnalytics = onCall(
  { ...options, timeoutSeconds: 60, memory: '512MiB' },
  async (request) => {
    await requirePlatformAnalyticsAdmin(request.auth?.uid);
    return readPicamoAnalytics(request.data || {});
  },
);
