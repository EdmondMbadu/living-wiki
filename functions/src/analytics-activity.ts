import { createHash } from 'node:crypto';
import { type Query } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { db } from './firebase';

type Data = Record<string, any>;
export type AnalyticsAudience = 'all' | 'visitors' | 'internal';
export function analyticsAudience(value: unknown): AnalyticsAudience {
  if (value === undefined || value === null) return 'visitors'; // Existing API clients keep their scope.
  if (value === 'all' || value === 'visitors' || value === 'internal') return value;
  throw new HttpsError('invalid-argument', 'Choose a valid activity audience.');
}
export const includesAudience = (audience: AnalyticsAudience, internal: boolean) =>
  audience === 'all' || (audience === 'internal') === internal;
const DAY = 86400000;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const iso = (value: any): string | null => {
  const date = value?.toDate ? value.toDate() : typeof value === 'string' ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
};
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;

export function analyticsRange(input: Data) {
  const today = new Date().toISOString().slice(0, 10);
  const days = [7, 30, 90].includes(Number(input.days)) ? Number(input.days) : 30;
  const from = input.from ?? new Date(Date.parse(today) - (days - 1) * DAY).toISOString().slice(0, 10);
  const to = input.to ?? today;
  const valid = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
    && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
  if (!valid(from) || !valid(to) || from > to || to > today || Date.parse(to) - Date.parse(from) > 89 * DAY) {
    throw new HttpsError('invalid-argument', 'Choose a date range of up to 90 days.');
  }
  const dates = Array.from({length: Math.round((Date.parse(to) - Date.parse(from)) / DAY) + 1}, (_, i) =>
    new Date(Date.parse(from) + i * DAY).toISOString().slice(0, 10));
  return {from, to, days: dates.length, dates};
}

async function read(query: Query) {
  const docs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  for (;;) {
    const page = await (cursor ? query.startAfter(cursor) : query).limit(500).get();
    docs.push(...page.docs);
    if (docs.length > 20000) throw new HttpsError('resource-exhausted', 'Choose a shorter analytics period.');
    if (page.size < 500) return docs;
    cursor = page.docs.at(-1);
  }
}

async function readWindow(boardId:string, range:ReturnType<typeof analyticsRange>) {
  const base=db.collection('platform_analytics_usage').where('value.boardId','==',boardId);
  try{return await read(base.where('value.startedAt','>=',new Date(Date.parse(range.from)-7*DAY).toISOString())
    .where('value.startedAt','<',new Date(Date.parse(range.to)+DAY).toISOString()).orderBy('value.startedAt'));}
  catch(error){
    // Preserve existing reporting while the new composite index builds during rollout.
    const code=(error as {code?:unknown})?.code;
    if(code!==9&&code!=='failed-precondition')throw error;
    return read(base);
  }
}

export type ActivityConversation = {
  id: string; cardId: string; internal: boolean; mode: 'voice' | 'text'; startedAt: string;
  durationSeconds: number | null; durationKind: 'recorded' | 'estimated'; questions: number;
  failedAnswers: number; knowledgeGaps: number; status: string; visitorKey: string; participantKey: string;
  firstQuestion: string; atlasId: string; transcriptId: string | null; verifiedAt: string | null;
};
export const emptyActivity = () => ({conversations: 0, voice: 0, text: 0, seconds: 0, questions: 0,
  failedAnswers: 0, unknownDurations: 0, unattributedConversations: 0});

/** Calls are counted on their start date; verified seconds are clipped to each UTC day. */
export function activityDays(rows: ActivityConversation[], dates: string[]) {
  const daily = new Map(dates.map(day => [day, {day, ...emptyActivity()}]));
  for (const row of rows) {
    const day = daily.get(row.startedAt.slice(0, 10));
    if (day) {
      day.conversations++; day[row.mode]++; day.questions += row.questions; day.failedAnswers += row.failedAnswers;
      if (row.mode === 'voice' && row.durationSeconds === null) day.unknownDurations++;
      if (!row.visitorKey) day.unattributedConversations++;
    }
    if (row.mode !== 'voice' || row.durationSeconds === null) continue;
    const start = Date.parse(row.startedAt), end = start + row.durationSeconds * 1000;
    for (const [date, value] of daily) {
      const from = Date.parse(date), to = from + DAY;
      value.seconds += Math.max(0, Math.min(end, to) - Math.max(start, from)) / 1000;
    }
  }
  return [...daily.values()];
}

/** The durable ledger supplies internal/expired records; raw records only enrich authorized detail.
 * A provider conversation or source receipt is counted once even when both sources exist.
 */
export async function readAnalyticsActivity(boardId: string, range: ReturnType<typeof analyticsRange>, audience: AnalyticsAudience, cardId?: string) {
  const [ledger, raw, jobs] = await Promise.all([
    readWindow(boardId,range),
    read(db.collection('card_analytics_conversations').where('board_id', '==', boardId).where('day', '>=',
      new Date(Date.parse(range.from) - 7 * DAY).toISOString().slice(0, 10)).where('day','<=',range.to).orderBy('day')),
    read(db.collection('card_analytics_voice_sessions').where('board_id', '==', boardId).where('day','>=',new Date(Date.parse(range.from)-8*DAY).toISOString().slice(0,10)).where('day','<=',range.to).orderBy('day')),
  ]);
  const jobByProvider = new Map(jobs.filter(d => d.data().conversation_id).map(d => [d.data().conversation_id, d]));
  const jobById = new Map(jobs.map(d => [d.id, d]));
  const records = new Map<string, ActivityConversation>();
  const end = Date.parse(range.to) + DAY, start = Date.parse(range.from);
  const relevant = (row: ActivityConversation) => {
    const stamp = Date.parse(row.startedAt);
    return (!cardId || row.cardId === cardId) && stamp < end
      && (stamp >= start || row.mode === 'voice' && row.durationSeconds !== null && stamp + row.durationSeconds * 1000 > start);
  };
  for (const doc of ledger) {
    const value = doc.data().value;
    if (!value || doc.data().alias || !iso(value.startedAt) || !['voice', 'text'].includes(value.mode)) continue;
    const job = value.providerId ? jobByProvider.get(value.providerId)?.data() : null;
    const visitorKey = value.visitorKey || job?.visitor_hash || '';
    const row: ActivityConversation = {
      id: doc.id, cardId: value.cardId, internal: value.internal === true, mode: value.mode,
      startedAt: iso(value.startedAt)!, durationSeconds: value.mode === 'voice' && typeof value.seconds === 'number' && value.seconds >= 0 && value.seconds <= 7 * 86400 ? value.seconds : null,
      durationKind: 'recorded', questions: number(value.questions), failedAnswers: number(value.failedAnswers), knowledgeGaps: 0,
      status: value.status || 'completed', visitorKey, participantKey: value.actorKey || job?.actor_hash || visitorKey,
      firstQuestion: '', atlasId: value.atlasId || job?.atlas_id || '', transcriptId: null,
      verifiedAt: iso(value.verifiedAt) || iso(doc.data().updatedAt),
    };
    if (relevant(row)) records.set(value.providerId ? `voice:${value.providerId}` : `source:${doc.id}`, row);
  }
  for (const doc of raw) {
    const data = doc.data(), job = jobById.get(doc.id)?.data();
    const stamp = iso(data.started_at); if (!stamp || !['voice', 'text'].includes(data.mode)) continue;
    const provider = data.provider_conversation_id || job?.conversation_id;
    const key = provider ? `voice:${provider}` : `source:${hash(`card:${doc.id}`)}`;
    const prior = records.get(key);
    const row: ActivityConversation = {
      id: doc.id, cardId: data.card_id, internal: prior?.internal ?? (data.internal === true || job?.internal === true), mode: prior?.mode || data.mode, startedAt: prior?.startedAt || stamp,
      durationSeconds: typeof data.duration_seconds === 'number' && data.duration_seconds >= 0 && data.duration_seconds <= 7*86400 && (data.mode!=='voice'||data.duration_kind==='recorded') ? data.duration_seconds : null,
      durationKind: data.duration_kind === 'estimated' ? 'estimated' : 'recorded', questions: number(data.questions),
      failedAnswers: number(data.failed_answers), knowledgeGaps: number(data.knowledge_gaps),
      status: data.mode === 'text' && Date.now() - (data.last_activity_at?.toMillis?.() || 0) > 30 * 60000 ? 'completed' : data.status,
      visitorKey: data.visitor_hash || prior?.visitorKey || '', participantKey: data.actor_hash || prior?.participantKey || data.visitor_hash || '',
      firstQuestion: data.first_question || '', atlasId: data.atlas_id || '',
      transcriptId: (data.event_history === true || (!prior?.internal && !data.internal && !job?.internal))
        && (!data.expires_at || data.expires_at.toMillis() >= Date.now()) ? doc.id : null,
      verifiedAt: prior?.verifiedAt || iso(data.last_activity_at),
    };
    // Verified ledger timing remains authoritative if an older raw record is incomplete.
    if (prior && row.mode === 'voice') row.durationSeconds = prior.durationSeconds;
    if (relevant(row)) records.set(key, row);
  }
  const visitorConversations = [...records.values()].filter(row=>!row.internal && row.startedAt.slice(0,10)>=range.from);
  const conversations = [...records.values()].filter(row=>includesAudience(audience,row.internal)).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const daily = activityDays(conversations, range.dates);
  const totals = daily.reduce((sum, row) => {
    for (const field of Object.keys(sum) as Array<keyof ReturnType<typeof emptyActivity>>) sum[field] += row[field];
    return sum;
  }, emptyActivity());
  const pending = jobs.filter(doc => {
    const data = doc.data(), issued = iso(data.issued_at);
    return (!cardId || data.card_id === cardId) && includesAudience(audience, data.internal === true)
      && issued && issued.slice(0, 10) >= range.from && issued.slice(0, 10) <= range.to && data.status !== 'done';
  });
  const pendingVoice = pending.filter(d => d.data().status !== 'unavailable' && d.data().issued_at.toMillis() > Date.now() - DAY).length;
  const unverifiedVoice = pending.length - pendingVoice;
  const verifiedAt = conversations.map(row => row.verifiedAt).filter((v): v is string => !!v).sort().at(-1) || null;
  return {audience, conversations, daily, totals, pendingVoice, unverifiedVoice, verifiedAt,
    knownVisitors: new Set(visitorConversations.map(c => c.visitorKey).filter(Boolean)),
    audienceVisitors: new Set(conversations.filter(c=>c.startedAt.slice(0,10)>=range.from).map(c=>c.visitorKey).filter(Boolean)),
    knownParticipants: new Set(conversations.map(c => c.participantKey).filter(Boolean))};
}
