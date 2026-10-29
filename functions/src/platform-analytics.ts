import { createHash, randomUUID } from 'node:crypto';
import { FieldValue, Timestamp, type Transaction } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentCreated, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
import { db } from './firebase';
import { isActiveTeamMember } from './teams';

type Data = Record<string, any>;
const options = { region: 'us-central1' };
const SHARDS = 32;
const DAY = 86400000;
const inventory = db.collection('platform_analytics_inventory');
const boardCreations = db.collection('platform_analytics_board_creations');
const shards = db.collection('platform_analytics_inventory_shards');
const usage = db.collection('platform_analytics_usage');
const daily = db.collection('platform_analytics_daily');
const meta = db.collection('platform_analytics_meta').doc('state');
const jobs = db.collection('platform_analytics_jobs');
const batches = db.collection('platform_analytics_batches');
const sourcePointers = db.collection('platform_analytics_sources');
const providers = db.collection('platform_analytics_providers');
const pending = db.collection('platform_analytics_pending');
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const validId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,180}$/.test(value);
const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : 0);
const iso = (v: any): string | null => {
  const date = v?.toDate
    ? v.toDate()
    : typeof v === 'number'
      ? new Date(v)
      : typeof v === 'string'
        ? new Date(v)
        : null;
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
};
const text = (v: unknown, max = 180) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const deleted = (v: Data | undefined) =>
  !v || v.deleted === true || v.is_deleted === true || !!v.deleted_at || !!v.deletedAt;

/** Use saved dates only; an analytics import or edit is never a board creation. */
export function platformBoardCreatedAt(...values: unknown[]): string | null {
  return (
    values
      .map(iso)
      .filter((value): value is string => !!value && Date.parse(value) <= Date.now())
      .sort()[0] || null
  );
}

export function platformBoardCreationSeries(
  records: Data[],
  dates: { from: string; to: string; group: string },
) {
  const period = (day: string) =>
    dates.group === 'year' ? day.slice(0, 4) : dates.group === 'month' ? day.slice(0, 7) : day;
  const series = new Map<string, { period: string; boards: number }>();
  for (let stamp = Date.parse(dates.from); stamp <= Date.parse(dates.to); stamp += DAY) {
    const key = period(new Date(stamp).toISOString().slice(0, 10));
    if (!series.has(key)) series.set(key, { period: key, boards: 0 });
  }
  let total = 0,
    missingDates = 0;
  for (const record of records) {
    const created = platformBoardCreatedAt(record.created_at);
    if (!created) {
      missingDates++;
      continue;
    }
    const day = created.slice(0, 10);
    if (day < dates.from || day > dates.to) continue;
    series.get(period(day))!.boards++;
    total++;
  }
  const datedBoards = records.length - missingDates;
  return {
    preparing: false,
    total: !datedBoards && missingDates ? null : total,
    datedBoards,
    missingDates,
    series: [...series.values()],
  };
}

export async function requirePlatformAnalyticsAdmin(uid?: string): Promise<void> {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to view platform analytics.');
  if ((await db.collection('users').doc(uid).get()).data()?.role !== 'admin') {
    throw new HttpsError(
      'permission-denied',
      'Platform analytics is restricted to platform administrators.',
    );
  }
}
export function platformCards(values: unknown, depth = 0, seen = new Set<string>()): Data[] {
  if (!Array.isArray(values) || depth > 10) return [];
  const result: Data[] = [];
  for (const c of values) {
    if (!c || typeof c !== 'object' || Array.isArray(c)) continue;
    if (validId(c.id) && !seen.has(c.id)) {
      seen.add(c.id);
      result.push(c);
    }
    result.push(...platformCards(c.relatedCards, depth + 1, seen));
  }
  return result;
}
function inventoryRecord(boardId: string, published?: Data, draft?: Data): Data | null {
  const source = !deleted(draft) ? draft : !deleted(published) ? published : null;
  if (!source) return null;
  const cards = platformCards(source.cards);
  const publicCards = new Map(platformCards(published?.cards).map((c) => [c.id, c]));
  const talking = cards.filter(
    (c) => c.conversation?.provider === 'atlas' && validId(c.conversation.atlasId),
  );
  const ownerId = text(source.owner_user_id || source.ownerUserId);
  const teamId = text(source.team_id || source.teamId);
  return {
    board_id: boardId,
    title: text(source.title, 240) || 'Untitled board',
    owner_id: ownerId,
    team_id: teamId,
    owner_key: teamId ? `team:${teamId}` : `user:${ownerId || 'unknown'}`,
    visibility: source.visibility || 'private',
    cards: cards.length,
    talking_cards: talking.length,
    created_at: platformBoardCreatedAt(source.created_at, source.created_at_iso, source.createdAt),
    published: !deleted(published),
    talking: talking.map((c) => ({
      id: c.id,
      title: text(c.title, 240) || 'Untitled card',
      atlasId: c.conversation.atlasId,
      analyticsAvailable:
        !!publicCards.get(c.id) && c.authorOnly !== true && !c.tags?.includes('author-only'),
    })),
  };
}
/** Read current canonical sources inside the transaction: delayed/repeated events cannot restore stale counts. */
export async function syncPlatformInventoryBoard(
  boardId: string,
  observedSources: Data[] = [],
): Promise<void> {
  if (!validId(boardId)) return;
  const ref = inventory.doc(boardId);
  await db.runTransaction(async (tx) => {
    const [published, draft, previous, creation] = await tx.getAll(
      db.collection('boards').doc(boardId),
      db.collection('team_boards').doc(boardId),
      ref,
      boardCreations.doc(boardId),
    );
    const next = inventoryRecord(boardId, published.data(), draft.data());
    const before = previous.data();
    const savedDate = platformBoardCreatedAt(
      creation.data()?.created_at,
      before?.created_at,
      ...[draft.data(), published.data(), ...observedSources].flatMap((source) => [
        source?.created_at,
        source?.created_at_iso,
        source?.createdAt,
      ]),
    );
    if (next) next.created_at = savedDate;
    // This ledger survives deletion and counts a draft/published pair only once.
    if (
      (next || before || observedSources.length) &&
      (!creation.exists || creation.data()?.created_at !== savedDate)
    ) {
      tx.set(
        creation.ref,
        {
          created_at: savedDate,
          ...(creation.exists ? {} : { first_recorded_at: Timestamp.now() }),
        },
        { merge: true },
      );
    }
    const fingerprint = hash(JSON.stringify(next));
    if (before?.fingerprint === fingerprint || (!before && !next)) return;
    const shard = Number.parseInt(hash(boardId).slice(0, 8), 16) % SHARDS;
    const delta = {
      boards: Number(!!next) - Number(!!before),
      cards: count(next?.cards) - count(before?.cards),
      talking_cards: count(next?.talking_cards) - count(before?.talking_cards),
    };
    tx.set(
      shards.doc(String(shard)),
      {
        boards: FieldValue.increment(delta.boards),
        cards: FieldValue.increment(delta.cards),
        talking_cards: FieldValue.increment(delta.talking_cards),
        updated_at: Timestamp.now(),
      },
      { merge: true },
    );
    if (next) tx.set(ref, { ...next, fingerprint, updated_at: Timestamp.now() });
    else tx.delete(ref);
  });
  inventoryCache = null;
  creationCache = null;
  reportCache.clear();
}
export const syncPlatformBoardInventory = onDocumentWritten(
  { ...options, document: 'boards/{boardId}', retry: true },
  (event) =>
    syncPlatformInventoryBoard(
      event.params.boardId,
      [event.data?.before.data(), event.data?.after.data()].filter(
        (source): source is Data => !!source,
      ),
    ),
);
export const syncPlatformTeamInventory = onDocumentWritten(
  { ...options, document: 'team_boards/{boardId}', retry: true },
  (event) =>
    syncPlatformInventoryBoard(
      event.params.boardId,
      [event.data?.before.data(), event.data?.after.data()].filter(
        (source): source is Data => !!source,
      ),
    ),
);

/** ASR silence markers (for example "...") are not visitor messages. */
export function hasPlatformVisitorMessage(turn: Data): boolean {
  return (
    turn.role === 'user' && typeof turn.message === 'string' && /[\p{L}\p{N}]/u.test(turn.message)
  );
}
export type PlatformUsage = {
  boardId: string;
  cardId: string;
  ownerKey: string;
  ownerId: string;
  teamId: string;
  boardTitle: string;
  cardTitle: string;
  mode: 'text' | 'voice';
  internal: boolean;
  startedAt: string;
  seconds: number | null;
  questions: number;
  failedAnswers: number;
  providerId?: string;
};
export function platformUsageDays(value: PlatformUsage): Record<string, Data> {
  const start = Date.parse(value.startedAt);
  if (!Number.isFinite(start)) throw new Error('Invalid usage timestamp.');
  const startDay = new Date(start).toISOString().slice(0, 10);
  const result: Record<string, Data> = {};
  const row = (day: string) =>
    (result[day] ||= {
      conversations: 0,
      voice: 0,
      text: 0,
      seconds: 0,
      unknownDurations: 0,
      questions: 0,
      failedAnswers: 0,
    });
  Object.assign(row(startDay), {
    conversations: 1,
    [value.mode]: 1,
    questions: value.questions,
    failedAnswers: value.failedAnswers,
    unknownDurations: value.mode === 'voice' && value.seconds === null ? 1 : 0,
  });
  if (value.mode === 'voice' && value.seconds !== null) {
    let cursor = start,
      finish = start + value.seconds * 1000;
    while (cursor < finish) {
      const boundary = Math.floor(cursor / DAY) * DAY + DAY;
      const end = Math.min(boundary, finish);
      row(new Date(cursor).toISOString().slice(0, 10)).seconds += (end - cursor) / 1000;
      cursor = end;
    }
  }
  return result;
}
function dayRef(value: PlatformUsage, day: string, usageId: string) {
  const shard = Number.parseInt(usageId.slice(0, 8), 16) % 8;
  return daily.doc(
    hash(`${value.boardId}:${value.cardId}:${value.ownerKey}:${day}:${value.internal}:${shard}`),
  );
}
function applyContribution(
  tx: Transaction,
  id: string,
  value: PlatformUsage,
  rows: Record<string, Data>,
  sign: number,
) {
  for (const [day, row] of Object.entries(rows)) {
    const increments = Object.fromEntries(
      Object.entries(row).map(([key, n]) => [key, FieldValue.increment(sign * Number(n))]),
    );
    tx.set(
      dayRef(value, day, id),
      {
        ...increments,
        day,
        boardId: value.boardId,
        cardId: value.cardId,
        ownerKey: value.ownerKey,
        ownerId: value.ownerId,
        teamId: value.teamId,
        internal: value.internal,
        boardTitle: value.boardTitle,
        cardTitle: value.cardTitle,
        updatedAt: Timestamp.now(),
      },
      { merge: true },
    );
  }
}
/** Minimal durable metadata only. Provider/source receipts make retries and dual ingestion idempotent. */
export async function capturePlatformUsage(source: string, input: PlatformUsage): Promise<void> {
  if (
    !validId(input.boardId) ||
    !validId(input.cardId) ||
    !Number.isFinite(Date.parse(input.startedAt))
  )
    return;
  const seconds =
    input.seconds !== null &&
    Number.isFinite(input.seconds) &&
    input.seconds >= 0 &&
    input.seconds <= 7 * 86400
      ? input.seconds
      : null;
  const value: PlatformUsage = {
    ...input,
    seconds,
    questions: count(input.questions),
    failedAnswers: count(input.failedAnswers),
  };
  const sourceRef = sourcePointers.doc(hash(source));
  const providerRef =
    value.mode === 'voice' && value.providerId
      ? providers.doc(hash(`elevenlabs:${value.providerId}`))
      : null;
  await db.runTransaction(async (tx) => {
    const [pointer, provider] = await Promise.all([
      tx.get(sourceRef),
      providerRef ? tx.get(providerRef) : Promise.resolve(null),
    ]);
    const oldId = pointer.data()?.usageId as string | undefined;
    const registeredId = provider?.data()?.usageId as string | undefined;
    const id = registeredId || oldId || hash(source);
    const ref = usage.doc(id);
    const [snapshot, alias] = await Promise.all([
      tx.get(ref),
      oldId && oldId !== id ? tx.get(usage.doc(oldId)) : Promise.resolve(null),
    ]);
    const aliasValue = alias?.data()?.value as PlatformUsage | undefined;
    if (alias?.exists && !alias.data()?.alias) {
      const previous = alias.data()!;
      applyContribution(tx, oldId!, previous.value, previous.days, -1);
      tx.set(alias.ref, { alias: id, updatedAt: Timestamp.now() });
    }
    const previous = snapshot.data();
    // Keep the original call scope, ownership, and fullest counters when sources converge.
    if (aliasValue) {
      value.questions = Math.max(value.questions, aliasValue.questions);
      value.failedAnswers = Math.max(value.failedAnswers, aliasValue.failedAnswers);
      if (value.seconds === null) value.seconds = aliasValue.seconds;
    }
    if (previous?.value) {
      if (value.seconds === null && previous.value.seconds !== null)
        value.seconds = previous.value.seconds;
      value.questions = Math.max(value.questions, previous.value.questions || 0);
      value.failedAnswers = Math.max(value.failedAnswers, previous.value.failedAnswers || 0);
      for (const field of [
        'ownerKey',
        'ownerId',
        'teamId',
        'boardId',
        'cardId',
        'internal',
        'mode',
        'startedAt',
      ] as const) {
        (value as Data)[field] = previous.value[field];
      }
    }
    const fingerprint = hash(JSON.stringify(value));
    if (previous?.fingerprint !== fingerprint) {
      if (previous?.value) applyContribution(tx, id, previous.value, previous.days, -1);
      const days = platformUsageDays(value);
      applyContribution(tx, id, value, days, 1);
      tx.set(ref, { value, days, fingerprint, updatedAt: Timestamp.now() });
    }
    tx.set(sourceRef, { usageId: id });
    if (providerRef) tx.set(providerRef, { usageId: id });
  });
  reportCache.clear();
}
async function usageContext(
  boardId: string,
  cardId: string,
  raw: Data = {},
): Promise<Pick<PlatformUsage, 'ownerKey' | 'ownerId' | 'teamId' | 'boardTitle' | 'cardTitle'>> {
  const [draft, published] = await db.getAll(
    db.collection('team_boards').doc(boardId),
    db.collection('boards').doc(boardId),
  );
  const board = draft.data() || published.data() || {};
  const card = platformCards(board.cards).find((c) => c.id === cardId);
  const ownerId = text(raw.owner_id || board.owner_user_id),
    teamId = text(raw.team_id || raw.teamId || board.team_id);
  return {
    ownerId,
    teamId,
    ownerKey: raw.owner_key || (teamId ? `team:${teamId}` : `user:${ownerId || 'unknown'}`),
    boardTitle: text(raw.board_title || raw.boardTitle || board.title, 240) || 'Deleted board',
    cardTitle: text(raw.card_title || raw.cardTitle || card?.title, 240) || 'Deleted card',
  };
}
export async function ingestPlatformConversation(
  id: string,
  data: Data,
  source = 'card',
): Promise<void> {
  const boardId = text(data.board_id || data.boardId),
    cardId = text(data.card_id || data.cardId);
  const startedAt = iso(data.started_at || data.startedAt);
  if (!validId(boardId) || !validId(cardId) || !startedAt) return;
  const voice = source === 'team' || data.mode === 'voice';
  const questions =
    count(data.questions) ||
    (Array.isArray(data.transcript) ? data.transcript.filter(hasPlatformVisitorMessage).length : 0);
  if (!questions) return;
  let providerId = text(data.provider_conversation_id || data.providerId);
  if (voice && !providerId) {
    if (source === 'team') providerId = id;
    else
      providerId = text(
        (await db.collection('card_analytics_voice_sessions').doc(id).get()).data()
          ?.conversation_id,
      );
  }
  const context = await usageContext(boardId, cardId, data);
  await capturePlatformUsage(`${source}:${id}`, {
    ...context,
    boardId,
    cardId,
    startedAt,
    internal: data.internal === true,
    mode: voice ? 'voice' : 'text',
    seconds:
      voice && (source === 'team' || data.duration_kind === 'recorded')
        ? typeof (data.duration_seconds ?? data.durationSeconds) === 'number'
          ? (data.duration_seconds ?? data.durationSeconds)
          : null
        : null,
    questions,
    failedAnswers: count(data.failed_answers),
    ...(providerId ? { providerId } : {}),
  });
}
export async function recordPlatformVerifiedVoice(
  id: string,
  job: Data,
  details: Data,
): Promise<void> {
  const boardId = String(job.board_id),
    cardId = String(job.card_id);
  const questions = (Array.isArray(details.transcript) ? details.transcript : []).filter(
    hasPlatformVisitorMessage,
  ).length;
  const startedAt = iso(Number(details.metadata?.start_time_unix_secs) * 1000);
  if (!questions || !startedAt) return;
  const context = await usageContext(boardId, cardId, job);
  await capturePlatformUsage(`card:${id}`, {
    ...context,
    boardId,
    cardId,
    startedAt,
    mode: 'voice',
    internal: job.internal === true,
    seconds:
      typeof details.metadata?.call_duration_secs === 'number'
        ? details.metadata.call_duration_secs
        : null,
    questions,
    failedAnswers: 0,
    providerId: String(details.conversation_id),
  });
}
export const syncPlatformConversationUsage = onDocumentWritten(
  { ...options, document: 'card_analytics_conversations/{id}', retry: true },
  async (event) => {
    if (event.data?.after.exists)
      await ingestPlatformConversation(event.params.id, event.data.after.data()!);
  },
);
export const syncPlatformTeamUsage = onDocumentWritten(
  { ...options, document: 'team_conversations/{id}', retry: true },
  async (event) => {
    if (event.data?.after.exists) {
      const data = event.data.after.data()!;
      // Older team records have no card ID. Recover it only from a matching verified session.
      if (!data.cardId && !data.card_id) {
        const match = await db
          .collection('team_voice_sessions')
          .where('conversationId', '==', event.params.id)
          .limit(2)
          .get();
        if (match.size === 1) data.cardId = match.docs[0].data().cardId;
      }
      await ingestPlatformConversation(event.params.id, data, 'team');
    }
  },
);
export async function syncPlatformPending(id: string, data?: Data) {
  const ref = pending.doc(hash(id));
  if (!data || data.status === 'done') {
    await ref.delete();
    return;
  }
  await ref.set({
    boardId: data.board_id,
    cardId: data.card_id,
    internal: data.internal === true,
    issuedAt: iso(data.issued_at),
    status: data.status === 'unavailable' ? 'unverified' : 'pending',
  });
}
export const syncPlatformVoiceStatus = onDocumentWritten(
  { ...options, document: 'card_analytics_voice_sessions/{id}', retry: true },
  (event) => syncPlatformPending(event.params.id, event.data?.after.data()),
);

/** Captures real owner/admin text requests while leaving public visitor histories and automated QA isolated. */
export function withPlatformTextUsage<T>(
  handler: (request: any) => Promise<T>,
): (request: any) => Promise<T> {
  return async (request) => {
    const d = request.data || {},
      uid = request.auth?.uid;
    let ref: FirebaseFirestore.DocumentReference | null = null;
    let receipt: FirebaseFirestore.DocumentReference | null = null;
    try {
      if (
        uid &&
        validId(d.atlasId) &&
        validId(d.boardId) &&
        validId(d.cardId) &&
        validId(d.analyticsSessionId) &&
        validId(d.analyticsRequestId)
      ) {
        const [board, draft, atlas] = await db.getAll(
          db.collection('boards').doc(d.boardId),
          db.collection('team_boards').doc(d.boardId),
          db.collection('atlases').doc(String(d.atlasId || 'invalid')),
        );
        const b = !deleted(draft.data()) ? draft.data() : board.data(),
          a = atlas.data();
        const card = platformCards(b?.cards).find((c) => c.id === d.cardId);
        const internal =
          b &&
          a &&
          (a.user_id === uid ||
            a.admin_user_ids?.includes(uid) ||
            b.owner_user_id === uid ||
            (await db.collection('users').doc(uid).get()).data()?.role === 'admin' ||
            (b.team_id && (await isActiveTeamMember(b.team_id, uid))));
        if (internal && card?.conversation?.atlasId === d.atlasId) {
          const key = hash(`${uid}:${d.boardId}:${d.cardId}:${d.analyticsSessionId}`);
          ref = db.collection('platform_analytics_text_sessions').doc(key);
          receipt = ref.collection('platform_analytics_attempts').doc(hash(d.analyticsRequestId));
          try {
            await db.runTransaction(async (tx) => {
              const [prior, turn] = await tx.getAll(ref!, receipt!);
              if (turn.exists) return;
              const now = Timestamp.now();
              tx.set(
                ref!,
                {
                  board_id: d.boardId,
                  card_id: d.cardId,
                  atlas_id: d.atlasId,
                  internal: true,
                  owner_id: b.owner_user_id || '',
                  team_id: b.team_id || '',
                  board_title: b.title || '',
                  card_title: card?.title || '',
                  mode: 'text',
                  questions: FieldValue.increment(1),
                  ...(prior.exists ? {} : { started_at: now }),
                  expires_at: Timestamp.fromMillis(Date.now() + 90 * DAY),
                },
                { merge: true },
              );
              tx.create(receipt!, {
                status: 'pending',
                expires_at: Timestamp.fromMillis(Date.now() + 90 * DAY),
              });
            });
          } catch (error) {
            logger.error('Internal text analytics unavailable', { error: String(error) });
            ref = null;
            receipt = null;
          }
        }
      }
    } catch (error) {
      logger.warn('Internal text analytics preparation unavailable', { error: String(error) });
      ref = null;
      receipt = null;
    }
    try {
      const result = await handler(request);
      if (receipt)
        await receipt
          .update({ status: 'answered' })
          .catch((error) =>
            logger.warn('Internal text status unavailable', { error: String(error) }),
          );
      return result;
    } catch (error) {
      if (ref && receipt)
        await db
          .runTransaction(async (tx) => {
            const turn = await tx.get(receipt!);
            if (turn.data()?.status === 'pending') {
              tx.update(receipt!, { status: 'failed' });
              tx.update(ref!, { failed_answers: FieldValue.increment(1) });
            }
          })
          .catch((e) =>
            logger.warn('Internal text failure status unavailable', { error: String(e) }),
          );
      throw error;
    }
  };
}
export const syncPlatformInternalTextUsage = onDocumentWritten(
  { ...options, document: 'platform_analytics_text_sessions/{id}', retry: true },
  async (event) => {
    if (event.data?.after.exists)
      await ingestPlatformConversation(event.params.id, event.data.after.data()!, 'internal');
  },
);

const STAGES = [
  'boards',
  'team_boards',
  'platform_analytics_inventory',
  'card_analytics_conversations',
  'team_conversations',
  'platform_analytics_text_sessions',
  'card_analytics_voice_sessions',
];
export async function startPlatformSync(): Promise<string> {
  return db.runTransaction(async (tx) => {
    const state = (await tx.get(meta)).data();
    const current = state?.jobId ? await tx.get(jobs.doc(state.jobId)) : null;
    if (current?.exists && ['queued', 'running'].includes(current.data()!.status))
      return current.id;
    const jobId = randomUUID(),
      now = Timestamp.now();
    tx.set(
      meta,
      { jobId, ...(state ? {} : { trackingSince: now }), updatedAt: now },
      { merge: true },
    );
    tx.create(jobs.doc(jobId), {
      status: 'queued',
      stage: 0,
      cursor: null,
      step: 0,
      processed: 0,
      failures: 0,
      createdAt: now,
    });
    tx.create(batches.doc(), {
      jobId,
      step: 0,
      expires_at: Timestamp.fromMillis(Date.now() + 7 * DAY),
    });
    return jobId;
  });
}
/** Requeue a stalled handoff, at most once a minute, without replacing an active lease. */
export async function wakePlatformSync(jobId: string, observed?: Data): Promise<void> {
  const stale = (value?: Data) =>
    value &&
    ['queued', 'running'].includes(value.status) &&
    !(value.leaseUntil?.toMillis() > Date.now()) &&
    (value.updatedAt || value.createdAt)?.toMillis() < Date.now() - 45000 &&
    !(value.lastWakeAt?.toMillis() > Date.now() - 60000);
  if (observed && !stale(observed)) return;
  await db.runTransaction(async (tx) => {
    const ref = jobs.doc(jobId),
      job = (await tx.get(ref)).data();
    if (!stale(job)) return;
    const batch = batches.doc(`${jobId}_${job!.step}_${Math.floor(Date.now() / 60000)}`);
    if ((await tx.get(batch)).exists) return;
    tx.create(batch, {
      jobId,
      step: job!.step,
      expires_at: Timestamp.fromMillis(Date.now() + 7 * DAY),
    });
    tx.update(ref, { lastWakeAt: Timestamp.now() });
  });
}
export const startPlatformAnalyticsSync = onCall({ ...options, cors: true }, async (request) => {
  await requirePlatformAnalyticsAdmin(request.auth?.uid);
  const jobId = await startPlatformSync();
  await wakePlatformSync(jobId);
  return { jobId };
});
export async function processPlatformBatch(jobId: string, step: number): Promise<void> {
  const ref = jobs.doc(jobId);
  const lease = await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref),
      data = snapshot.data();
    if (
      !data ||
      !['queued', 'running'].includes(data.status) ||
      data.step !== step ||
      data.leaseUntil?.toMillis() > Date.now()
    )
      return null;
    tx.update(ref, { status: 'running', leaseUntil: Timestamp.fromMillis(Date.now() + 480000) });
    return data;
  });
  if (!lease) return;
  try {
    const collection = STAGES[lease.stage];
    let query = db.collection(collection).orderBy('__name__').limit(100);
    if (lease.cursor) query = query.startAfter(lease.cursor);
    const page = await query.get();
    for (let offset = 0; offset < page.size; offset += 10) {
      await Promise.all(
        page.docs.slice(offset, offset + 10).map(async (doc) => {
          if (lease.stage < 3) await syncPlatformInventoryBoard(doc.id);
          else if (collection === 'card_analytics_voice_sessions')
            await syncPlatformPending(doc.id, doc.data());
          else
            await ingestPlatformConversation(
              doc.id,
              doc.data(),
              collection === 'team_conversations'
                ? 'team'
                : collection === 'platform_analytics_text_sessions'
                  ? 'internal'
                  : 'card',
            );
        }),
      );
    }
    await db.runTransaction(async (tx) => {
      const current = (await tx.get(ref)).data();
      if (!current || current.step !== step) return;
      const stage = page.size < 100 ? lease.stage + 1 : lease.stage;
      const finished = stage >= STAGES.length;
      tx.update(ref, {
        stage,
        cursor: stage === lease.stage ? page.docs.at(-1)?.id || null : null,
        step: step + 1,
        processed: FieldValue.increment(page.size),
        leaseUntil: FieldValue.delete(),
        failures: 0,
        status: finished ? 'complete' : 'queued',
        updatedAt: Timestamp.now(),
      });
      if (finished)
        tx.set(
          meta,
          {
            inventoryReady: true,
            boardCreationsReady: true,
            updatedAt: Timestamp.now(),
            lastSyncAt: Timestamp.now(),
          },
          { merge: true },
        );
      else
        tx.create(batches.doc(), {
          jobId,
          step: step + 1,
          expires_at: Timestamp.fromMillis(Date.now() + 7 * DAY),
        });
    });
    inventoryCache = null;
    reportCache.clear();
  } catch (error) {
    const failures = (lease.failures || 0) + 1;
    await ref.update({
      status: failures >= 3 ? 'error' : 'queued',
      failures,
      error: String(error).slice(0, 400),
      leaseUntil: FieldValue.delete(),
      updatedAt: Timestamp.now(),
    });
    throw error;
  }
}
/** Continue while this invocation owns the queue; delayed events cannot strand the next page. */
export async function drainPlatformBatches(
  jobId: string,
  step: number,
  budgetMs = 420000,
): Promise<void> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    await processPlatformBatch(jobId, step);
    const next = (await jobs.doc(jobId).get()).data();
    if (!next || next.status !== 'queued' || next.leaseUntil?.toMillis() > Date.now()) return;
    step = next.step;
  }
}
export const platformAnalyticsWorker = onDocumentCreated(
  {
    ...options,
    document: 'platform_analytics_batches/{batchId}',
    timeoutSeconds: 540,
    memory: '1GiB',
    retry: true,
  },
  async (event) => {
    const data = event.data?.data();
    if (data) await drainPlatformBatches(data.jobId, data.step);
  },
);
export const reconcilePlatformAnalytics = onSchedule(
  { ...options, schedule: 'every 30 minutes', timeoutSeconds: 60 },
  async () => {
    const state = (await meta.get()).data();
    if (state?.jobId) {
      const ref = jobs.doc(state.jobId),
        job = (await ref.get()).data();
      if (job && ['queued', 'running'].includes(job.status)) {
        if (!job.leaseUntil || job.leaseUntil.toMillis() < Date.now())
          await batches.add({
            jobId: state.jobId,
            step: job.step,
            expires_at: Timestamp.fromMillis(Date.now() + 7 * DAY),
          });
        return;
      }
      if (state.lastSyncAt?.toMillis() > Date.now() - DAY) return;
    }
    await startPlatformSync();
  },
);

async function readAll(
  collection: FirebaseFirestore.Query,
  max = 200000,
): Promise<FirebaseFirestore.QueryDocumentSnapshot[]> {
  const result: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  for (;;) {
    const page = await (cursor ? collection.startAfter(cursor) : collection).limit(500).get();
    result.push(...page.docs);
    if (result.length > max)
      throw new HttpsError(
        'resource-exhausted',
        'This report is too large. Choose a shorter date range or a more specific search.',
      );
    if (page.size < 500) return result;
    cursor = page.docs.at(-1);
  }
}
let inventoryCache: {
  until: number;
  records: Data[];
  totals: Data;
  updatedAt: string | null;
} | null = null;
const reportCache = new Map<string, { until: number; value: Data }>();
let creationCache: { until: number; records: Data[] } | null = null;
async function creationSnapshot(): Promise<Data[]> {
  if (creationCache && creationCache.until > Date.now()) return creationCache.records;
  const records = (await readAll(boardCreations.orderBy('__name__'))).map((doc) => doc.data());
  creationCache = { until: Date.now() + 30000, records };
  return records;
}
async function inventorySnapshot() {
  if (inventoryCache && inventoryCache.until > Date.now()) return inventoryCache;
  const [docs, counters] = await Promise.all([
    readAll(inventory.orderBy('__name__'), 50000),
    db.getAll(...Array.from({ length: SHARDS }, (_, i) => shards.doc(String(i)))),
  ]);
  const totals = counters.reduce(
    (s, d) => ({
      boards: s.boards + count(d.data()?.boards),
      cards: s.cards + count(d.data()?.cards),
      talkingCards: s.talkingCards + count(d.data()?.talking_cards),
    }),
    { boards: 0, cards: 0, talkingCards: 0 },
  );
  const records = docs.map((d) => d.data());
  // A counter drift never becomes a convincing but incorrect number.
  const check = records.reduce(
    (s, d) => ({
      boards: s.boards + 1,
      cards: s.cards + count(d.cards),
      talkingCards: s.talkingCards + count(d.talking_cards),
    }),
    { boards: 0, cards: 0, talkingCards: 0 },
  );
  if (JSON.stringify(check) !== JSON.stringify(totals)) {
    // Concurrent writes can cross the two reads. The canonical index is the reconciled snapshot for this response.
    Object.assign(totals, check);
  }
  const updatedAt =
    records
      .map((d) => iso(d.updated_at))
      .filter(Boolean)
      .sort()
      .at(-1) || null;
  inventoryCache = { until: Date.now() + 30000, records, totals, updatedAt };
  return inventoryCache;
}
function range(input: Data) {
  const today = new Date().toISOString().slice(0, 10);
  const from = text(input.from, 10) || new Date(Date.now() - 29 * DAY).toISOString().slice(0, 10);
  const to = text(input.to, 10) || today;
  const valid = (d: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(d) &&
    Number.isFinite(Date.parse(d)) &&
    new Date(d).toISOString().slice(0, 10) === d;
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
    includeInternal: input.includeInternal === true,
  };
}
export const getPlatformAnalytics = onCall(
  { ...options, cors: true, timeoutSeconds: 180, memory: '1GiB' },
  async (request) => {
    await requirePlatformAnalyticsAdmin(request.auth?.uid);
    const input = request.data || {},
      dates = range(input);
    let state = (await meta.get()).data();
    if (!state?.jobId) {
      await startPlatformSync();
      state = (await meta.get()).data();
    }
    let job = state?.jobId ? (await jobs.doc(state.jobId).get()).data() : null;
    // Upgrade existing installations in the background while keeping usage reports available.
    if (
      state?.inventoryReady &&
      !state.boardCreationsReady &&
      (!job || job.status === 'complete')
    ) {
      await startPlatformSync();
      state = (await meta.get()).data();
      job = (await jobs.doc(state!.jobId).get()).data() || null;
    }
    if (state?.jobId && job) await wakePlatformSync(state.jobId, job);
    const progress = job
      ? {
          status: job.status,
          stage: STAGES[job.stage] || 'complete',
          processed: job.processed || 0,
        }
      : null;
    if (!state?.inventoryReady)
      return {
        preparing: true,
        progress,
        inventory: null,
        trackingSince: iso(state?.trackingSince),
        error:
          job?.status === 'error' ? 'The initial sync could not finish. Retry the sync.' : null,
      };
    const cacheKey = JSON.stringify([
      dates,
      state.lastSyncAt?.toMillis(),
      state.boardCreationsReady === true,
    ]);
    let cached = reportCache.get(cacheKey);
    if (input.refresh === true) {
      inventoryCache = null;
      creationCache = null;
      reportCache.delete(cacheKey);
      cached = undefined;
    }
    let report = cached && cached.until > Date.now() ? cached.value : null;
    if (!report) {
      const [inv, docs, statuses, creations] = await Promise.all([
        inventorySnapshot(),
        readAll(daily.where('day', '>=', dates.from).where('day', '<=', dates.to).orderBy('day')),
        readAll(pending.orderBy('__name__'), 20000),
        state.boardCreationsReady ? creationSnapshot() : Promise.resolve(null),
      ]);
      const empty = () => ({
        conversations: 0,
        voice: 0,
        text: 0,
        seconds: 0,
        questions: 0,
        failedAnswers: 0,
        unknownDurations: 0,
      });
      const totals = empty(),
        dayRows = new Map<string, Data>(),
        activity = new Map<string, Data>();
      const activeCards = new Set<string>();
      for (const doc of docs) {
        const row = doc.data();
        if (row.internal && !dates.includeInternal) continue;
        const hasActivity = count(row.conversations) > 0 || count(row.seconds) > 0;
        if (!hasActivity) continue;
        const key = `${row.boardId}:${row.cardId}`;
        if (hasActivity) activeCards.add(key);
        const day = dayRows.get(row.day) || { day: row.day, ...empty() };
        const activityKey = `${key}:${row.ownerKey}`;
        const a = activity.get(activityKey) || {
          key,
          boardId: row.boardId,
          cardId: row.cardId,
          ownerKey: row.ownerKey,
          ownerId: row.ownerId,
          teamId: row.teamId,
          boardTitle: row.boardTitle,
          cardTitle: row.cardTitle,
          ...empty(),
        };
        for (const field of Object.keys(totals)) {
          const n = count(row[field]);
          (totals as Data)[field] += n;
          day[field] += n;
          a[field] += n;
        }
        dayRows.set(row.day, day);
        activity.set(activityKey, a);
      }
      const trackingSince = iso(state.trackingSince)!;
      const series = new Map<string, Data>();
      for (let stamp = Date.parse(dates.from); stamp <= Date.parse(dates.to); stamp += DAY) {
        const day = new Date(stamp).toISOString().slice(0, 10),
          key =
            dates.group === 'year'
              ? day.slice(0, 4)
              : dates.group === 'month'
                ? day.slice(0, 7)
                : day;
        const b = series.get(key) || { period: key, ...empty(), recorded: false, partial: false };
        const row = dayRows.get(day);
        if (row || day >= trackingSince.slice(0, 10)) b.recorded = true;
        if (day < trackingSince.slice(0, 10)) b.partial = true;
        if (row) for (const field of Object.keys(totals)) b[field] += row[field];
        series.set(key, b);
      }
      const statusRows = statuses
        .map((d) => d.data())
        .filter((d) => dates.includeInternal || !d.internal);
      const livePending = statusRows.filter(
        (d) => d.status === 'pending' && Date.parse(d.issuedAt) > Date.now() - DAY,
      ).length;
      const unverified = statusRows.filter(
        (d) => d.status === 'unverified' || Date.parse(d.issuedAt) <= Date.now() - DAY,
      ).length;
      report = {
        preparing: false,
        inventory: inv.totals,
        inventoryRecords: inv.records,
        totals: { ...totals, activeCards: activeCards.size },
        series: [...series.values()],
        boardCreation: creations
          ? platformBoardCreationSeries(creations, dates)
          : { preparing: true },
        activity: [...activity.values()],
        trackingSince,
        coverage: {
          partial: dates.from < trackingSince.slice(0, 10),
          unrecorded: !dayRows.size && dates.to < trackingSince.slice(0, 10),
        },
        pending: livePending,
        unverified,
        updatedAt: new Date().toISOString(),
        range: dates,
      };
      if (reportCache.size > 10) reportCache.clear();
      reportCache.set(cacheKey, { until: Date.now() + 30000, value: report });
    }
    const view = ['users', 'boards', 'cards'].includes(input.view) ? input.view : 'cards';
    const rows = await breakdownRows(report!, view);
    const q = text(input.search, 120).toLowerCase();
    const filtered = rows.filter(
      (row) =>
        !q ||
        [row.title, row.owner, row.boardTitle].some((v) =>
          String(v || '')
            .toLowerCase()
            .includes(q),
        ),
    );
    filtered.sort(
      (a, b) =>
        b.seconds - a.seconds ||
        b.conversations - a.conversations ||
        a.title.localeCompare(b.title),
    );
    const page = Math.max(1, Math.floor(Number(input.page) || 1)),
      pageSize = 25;
    if (input.export === true && filtered.length > 20000)
      throw new HttpsError('resource-exhausted', 'Filter this export to fewer than 20,000 rows.');
    const { inventoryRecords, activity, ...publicReport } = report!;
    return {
      ...publicReport,
      progress,
      breakdown: {
        view,
        total: filtered.length,
        page,
        pageSize,
        rows:
          input.export === true ? filtered : filtered.slice((page - 1) * pageSize, page * pageSize),
      },
    };
  },
);
async function breakdownRows(report: Data, view: string): Promise<Data[]> {
  const records: Data[] = report.inventoryRecords,
    activity: Data[] = report.activity;
  const owners = new Map<string, string>();
  const ownerRecords = new Map<string, { id: string; team: boolean }>();
  for (const r of [...records, ...activity])
    if (r.ownerKey || r.owner_key)
      ownerRecords.set(r.ownerKey || r.owner_key, {
        id: r.teamId || r.team_id || r.ownerId || r.owner_id,
        team: !!(r.teamId || r.team_id),
      });
  const ownerEntries = [...ownerRecords.entries()];
  for (let offset = 0; offset < ownerEntries.length; offset += 100) {
    const group = ownerEntries.slice(offset, offset + 100).filter(([, v]) => validId(v.id));
    if (!group.length) continue;
    const snapshots = await db.getAll(
      ...group.map(([, v]) => db.collection(v.team ? 'teams' : 'users').doc(v.id)),
    );
    snapshots.forEach((d, i) =>
      owners.set(
        group[i][0],
        text(d.data()?.displayName || d.data()?.name || d.data()?.team_name, 100) ||
          (group[i][1].team ? 'Team ' : 'User ') + group[i][1].id.slice(0, 8),
      ),
    );
  }
  const rows = new Map<string, Data>();
  const add = (key: string, initial: Data) => {
    if (!rows.has(key))
      rows.set(key, {
        key,
        boards: 0,
        cards: 0,
        talkingCards: 0,
        conversations: 0,
        voice: 0,
        text: 0,
        seconds: 0,
        unknownDurations: 0,
        ...initial,
      });
    return rows.get(key)!;
  };
  for (const r of records) {
    const owner = owners.get(r.owner_key) || 'Unknown owner';
    if (view === 'users') {
      const row = add(r.owner_key, {
        title: owner,
        ownerKey: r.owner_key,
        owner,
        boardTitle: '',
        kind: r.team_id ? 'team' : 'user',
      });
      row.boards++;
      row.cards += r.cards;
      row.talkingCards += r.talking_cards;
    } else if (view === 'boards')
      add(r.board_id, {
        title: r.title,
        owner,
        boardTitle: r.title,
        boardId: r.board_id,
        boards: 1,
        cards: r.cards,
        talkingCards: r.talking_cards,
        analyticsAvailable: r.published,
      });
    else
      for (const c of r.talking || [])
        add(`${r.board_id}:${c.id}`, {
          title: c.title,
          owner,
          boardTitle: r.title,
          boardId: r.board_id,
          cardId: c.id,
          atlasId: c.atlasId,
          cards: 1,
          talkingCards: 1,
          analyticsAvailable: c.analyticsAvailable,
        });
  }
  for (const a of activity) {
    const key = view === 'users' ? a.ownerKey : view === 'boards' ? a.boardId : a.key;
    const row = add(key, {
      title:
        view === 'users'
          ? owners.get(a.ownerKey) || 'Unknown owner'
          : view === 'boards'
            ? a.boardTitle
            : a.cardTitle,
      owner: owners.get(a.ownerKey) || 'Unknown owner',
      boardTitle: a.boardTitle,
      boardId: a.boardId,
      cardId: a.cardId,
      analyticsAvailable: false,
      deleted: true,
    });
    for (const field of ['conversations', 'voice', 'text', 'seconds', 'unknownDurations'])
      row[field] += a[field];
  }
  return [...rows.values()];
}

export const getPlatformInventory = onCall(
  { ...options, cors: true, timeoutSeconds: 180, memory: '1GiB' },
  async (request) => {
    await requirePlatformAnalyticsAdmin(request.auth?.uid);
    let state = (await meta.get()).data();
    if (!state?.jobId) {
      await startPlatformSync();
      state = (await meta.get()).data();
    }
    if (!state?.inventoryReady) {
      if (state?.jobId) await wakePlatformSync(state.jobId);
      return { preparing: true, inventory: null };
    }
    const result = await inventorySnapshot();
    return { preparing: false, inventory: result.totals, updatedAt: result.updatedAt };
  },
);
