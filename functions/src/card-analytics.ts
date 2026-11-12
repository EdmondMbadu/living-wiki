import { trafficVisitors, trafficStartedAt } from './analytics-traffic';
import { analyticsAudience, analyticsRange, includesAudience, readAnalyticsActivity } from './analytics-activity';
import { recoverPicamoVoice } from './picamo-analytics';
import { createHash, randomUUID } from 'node:crypto';
import { FieldValue, Timestamp, type Query, type DocumentData } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
import * as logger from 'firebase-functions/logger';
import { db } from './firebase';
import { isLinkReadableVisibility } from './board-visibility';
import { isActiveTeamMember } from './teams';
import { recordPlatformVerifiedVoice, hasPlatformVisitorMessage, enrichPlatformVoiceIdentity } from './platform-analytics';

type Data = Record<string, any>;
type Actor = { auth?: { uid: string }; data: Data; rawRequest?: { headers: Data } };
const idPattern = /^[A-Za-z0-9_-]{1,180}$/;
const clientPattern = /^[A-Za-z0-9_-]{12,100}$/;
export const hashAnalytics = (s: string): string => createHash('sha256').update(s).digest('hex');
export const trackingRef = (boardId: string) => db.collection('board_tracking').doc(boardId);
const sessions = db.collection('card_analytics_conversations');
const jobs = db.collection('card_analytics_voice_sessions');
const questionsCollection = db.collection('card_analytics_questions');
function questionRollup(boardId: string, cardId: string, day: string, question: string, atlasId: string) {
  const normalized = question.trim().replace(/\s+/g,' ').toLowerCase();
  const questionKey = hashAnalytics(normalized);
  return { ref: questionsCollection.doc(hashAnalytics(`${boardId}:${cardId}:${atlasId}:${day}:${questionKey}`)),
    data: { board_id:boardId, card_id:cardId, atlas_id:atlasId, day, question_key:questionKey, question:question.trim().slice(0,1000), expires_at:expires() } };
}
const key = defineSecret('ELEVENLABS_API_KEY');
const expires = () => Timestamp.fromMillis(Date.now() + 90 * 86400000);
export function flattenAnalyticsCards(values: unknown, includeHidden = false, depth = 0): Data[] {
  if (!Array.isArray(values) || depth > 10) return [];
  return values.flatMap(card => {
    if (!card || typeof card !== 'object' || (!includeHidden && (card.authorOnly === true || card.tags?.includes('author-only')))) return [];
    return [card, ...flattenAnalyticsCards(card.relatedCards, includeHidden, depth + 1)];
  });
}
export async function analyticsTarget(boardId: string, cardId: string, uid?: string) {
  if (!idPattern.test(boardId) || !idPattern.test(cardId)) throw new HttpsError('invalid-argument', 'Choose a valid board and card.');
  const board = (await db.collection('boards').doc(boardId).get()).data();
  if (!board) throw new HttpsError('not-found', 'This board could not be found.');
  const card = flattenAnalyticsCards(board.cards, board.owner_user_id === uid).find(c => c.id === cardId);
  if (!card) throw new HttpsError('not-found', 'This card is no longer available on this board.');
  return { board, card };
}
async function authorized(request: Actor) {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to view analytics.');
  const boardId = String(request.data.boardId || ''), cardId = String(request.data.cardId || '');
  const { board, card } = await analyticsTarget(boardId, cardId, uid);
  const profile = (await db.collection('users').doc(uid).get()).data();
  const atlasId = card.conversation?.provider === 'atlas' ? card.conversation.atlasId : '';
  const atlas = atlasId ? (await db.collection('atlases').doc(atlasId).get()).data() : null;
  const avatarAdmin = !!atlas && (atlas.user_id === uid || atlas.admin_user_ids?.includes(uid));
  const boardAccess = board.owner_user_id === uid || isLinkReadableVisibility(board.visibility);
  if (profile?.role !== 'admin' && board.owner_user_id !== uid && !(avatarAdmin && boardAccess)) {
    throw new HttpsError('permission-denied', 'Only authorized card administrators can view analytics.');
  }
  return { boardId, cardId, board, card, atlasId, canViewBoardAnalytics: board.owner_user_id === uid || profile?.role === 'admin', canReadTranscripts: !!avatarAdmin && boardAccess };
}
export async function allAnalyticsDocs(query: Query<DocumentData>) {
  const result: Array<{ id: string; data: () => Data }> = [];
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  for (;;) {
    const page = await (cursor ? query.startAfter(cursor) : query).limit(500).get();
    result.push(...page.docs);
    if (result.length > 20000) throw new HttpsError('resource-exhausted', 'This report is too large. Choose a shorter date range.');
    if (page.size < 500) return result;
    cursor = page.docs.at(-1);
  }
}
export async function uniqueAnalyticsVisitors(boardId: string, from: string, cardId?: string, audience: 'all'|'visitors'|'internal' = 'visitors', to = new Date().toISOString().slice(0,10)) {
  return trafficVisitors(boardId, from, to, audience, cardId);
}
export async function analyticsConversations(boardId: string, from: string, cardId?: string) {
  let query=sessions.where('board_id', '==', boardId).where('day', '>=', from).orderBy('day');
  if(cardId) query=query.where('card_id','==',cardId);
  return allAnalyticsDocs(query);
}
async function actorBinding(request: Actor, board: Data, atlas: Data, includeInternal = false) {
  const uid = request.auth?.uid;
  const anonymous = String(request.data.anonymousVisitorId || '');
  if (!uid && !clientPattern.test(anonymous)) throw new HttpsError('unauthenticated', 'A visitor session is required.');
  const visitor = String(request.data.analyticsVisitorId || '');
  if (!clientPattern.test(visitor) && !includeInternal) return null; // Older clients continue without inventing attribution.
  const ua = String(request.rawRequest?.headers?.['user-agent'] || '');
  const internal = uid && (uid === board.owner_user_id || uid === atlas.user_id || atlas.admin_user_ids?.includes(uid)
    || (await db.collection('users').doc(uid).get()).data()?.role === 'admin'
    || (board.team_id && await isActiveTeamMember(board.team_id, uid)));
  if ((internal && !includeInternal) || /bot|crawler|spider|headless|preview/i.test(ua) || (!isLinkReadableVisibility(board.visibility) && !internal)) return null;
  const ownerId=String(board.owner_user_id||''), teamId=String(board.team_id||'');
  return { actor_hash: hashAnalytics(uid ? `uid:${uid}` : `anonymous:${anonymous}`), visitor_hash: clientPattern.test(visitor)?hashAnalytics(visitor):'',
    internal:!!internal, platform_only:!clientPattern.test(visitor), owner_id:ownerId, team_id:teamId, owner_key:teamId?`team:${teamId}`:`user:${ownerId||'unknown'}`, board_title:board.title||'' };
}
export async function beginCardText(request: Actor, atlas: Data, eventHistory = false) {
  if (!request.data.boardId || !request.data.cardId) return null;
  const boardId = String(request.data.boardId), cardId = String(request.data.cardId);
  const { board, card } = await analyticsTarget(boardId, cardId, request.auth?.uid);
  if (!isLinkReadableVisibility(board.visibility) && board.owner_user_id !== request.auth?.uid) throw new HttpsError('permission-denied', 'This board is not available.');
  if (card.conversation?.atlasId !== atlas.id || card.conversation?.provider !== 'atlas') throw new HttpsError('permission-denied', 'This avatar does not belong to this card.');
  const actor = await actorBinding(request, board, atlas, eventHistory);
  if (!actor) return null;
  const sessionId = String(request.data.analyticsSessionId || '');
  const requestId = String(request.data.analyticsRequestId || '');
  if (!clientPattern.test(sessionId) || !clientPattern.test(requestId)) return null;
  const ref = sessions.doc(hashAnalytics(`${boardId}:${cardId}:${actor.actor_hash}:${sessionId}`));
  const turn = ref.collection('analytics_turns').doc(requestId);
  const now = Timestamp.now();
  const question = String(request.data.visitorQuestion || request.data.question || '').trim();
  if (!question || question.length > 30000) throw new HttpsError('invalid-argument', 'The visitor question is invalid.');
  const state = await db.runTransaction(async tx => {
    const coverageRef = trackingRef(boardId);
    const [existing, oldTurn, coverage] = await Promise.all([tx.get(ref), tx.get(turn), tx.get(coverageRef)]);
    if (!coverage.exists) tx.create(coverageRef, { started_at: now });
    if (oldTurn.exists) throw new HttpsError('already-exists', 'This question has already been submitted.');
    const previous = existing.data();
    if (previous && now.toMillis() - previous.last_activity_at.toMillis() > 30 * 60000) throw new HttpsError('failed-precondition', 'This conversation expired. Close it and start a new conversation.');
    const elapsed = previous ? Math.min(60, Math.max(0, (now.toMillis() - previous.last_activity_at.toMillis()) / 1000)) : 0;
    tx.set(ref, {
      ...actor, board_id: boardId, card_id: cardId, card_title:card.title||'', atlas_id: atlas.id, mode: 'text',
      ...(eventHistory ? { event_history: true } : {}),
      ...(previous ? {} : { started_at: now, day: now.toDate().toISOString().slice(0,10), first_question: question.slice(0,1000), duration_kind: 'estimated' }),
      last_activity_at: now, status: 'active', questions: FieldValue.increment(1),
      duration_seconds: FieldValue.increment(elapsed), expires_at: expires(),
    }, { merge: true });
    if (!actor.internal && !actor.platform_only) {
      const rollup = questionRollup(boardId,cardId,now.toDate().toISOString().slice(0,10),question,atlas.id);
      tx.set(rollup.ref, { ...rollup.data, count:FieldValue.increment(1) }, { merge:true });
    }
    tx.create(turn, { question, answer: null, status: 'pending', created_at: now, expires_at: expires() });
    return { threadId: previous?.thread_id || null, now };
  });
  return { ref, turn, ...state };
}
export async function finishCardText(context: Awaited<ReturnType<typeof beginCardText>>, result?: Data) {
  if (!context) return;
  const now = Timestamp.now();
  await db.runTransaction(async tx => {
    const [s, t] = await Promise.all([tx.get(context.ref), tx.get(context.turn)]);
    if (!s.exists || t.data()?.status !== 'pending') return;
    const elapsed = Math.min(60, Math.max(0, (now.toMillis() - s.data()!.last_activity_at.toMillis()) / 1000));
    tx.update(context.turn, { answer: result?.answer ?? null, status: result ? 'answered' : 'failed', knowledge_gap: result?.knowledgeGap === true, answered_at: now });
    tx.update(context.ref, { last_activity_at: now, duration_seconds: FieldValue.increment(elapsed),
      ...(result?.threadId ? { thread_id: result.threadId } : {}),
      ...(result?.knowledgeGap ? { knowledge_gaps: FieldValue.increment(1) } : {}),
      ...(!result ? { failed_answers: FieldValue.increment(1) } : {}) });
  });
}
export const endCardTextAnalytics = onCall({ region:'us-central1', cors:true, timeoutSeconds:15 }, async request => {
  const boardId=String(request.data?.boardId||''), cardId=String(request.data?.cardId||''), sessionId=String(request.data?.sessionId||'');
  const anonymous=String(request.data?.anonymousVisitorId||'');
  if(!idPattern.test(boardId)||!idPattern.test(cardId)||!clientPattern.test(sessionId)) throw new HttpsError('invalid-argument','Invalid conversation session.');
  if(!request.auth?.uid&&!clientPattern.test(anonymous)) throw new HttpsError('unauthenticated','A visitor session is required.');
  const actor=hashAnalytics(request.auth?.uid?`uid:${request.auth.uid}`:`anonymous:${anonymous}`);
  const ref=sessions.doc(hashAnalytics(`${boardId}:${cardId}:${actor}:${sessionId}`));
  const now=Timestamp.now();
  await db.runTransaction(async tx=>{
    const snapshot=await tx.get(ref), data=snapshot.data();
    if(!data||data.actor_hash!==actor||data.mode!=='text'||data.status==='completed')return;
    const elapsed=Math.min(60,Math.max(0,(now.toMillis()-data.last_activity_at.toMillis())/1000));
    tx.update(ref,{status:'completed',ended_at:now,last_activity_at:now,duration_seconds:FieldValue.increment(elapsed)});
  });
  return {accepted:true};
});

export async function issueCardVoice(request: Actor, atlas: Data, agentId: string, trusted?: { sessionId:string; board:Data; internal:boolean }, eventHistory = false): Promise<string | null> {
  if (!request.data.boardId || !request.data.cardId) return null;
  const target = trusted ? { board:trusted.board, card:flattenAnalyticsCards(trusted.board.cards,trusted.internal).find(c=>c.id===request.data.cardId) } : await analyticsTarget(String(request.data.boardId), String(request.data.cardId), request.auth?.uid);
  const {board,card}=target;
  if(!card) throw new HttpsError('not-found','This card is no longer available.');
  if (!trusted?.internal && !isLinkReadableVisibility(board.visibility) && board.owner_user_id !== request.auth?.uid) throw new HttpsError('permission-denied', 'This board is not available.');
  if (card.conversation?.atlasId !== atlas.id) throw new HttpsError('permission-denied', 'This avatar does not belong to this card.');
  const actor = await actorBinding(request, board, atlas, true);
  if (!actor) return null;
  const nonce = trusted?.sessionId || `card_${randomUUID()}`;
  await jobs.doc(nonce).create({ ...actor, board_id: String(request.data.boardId), card_id: String(request.data.cardId), card_title:card.title||'', atlas_id: atlas.id, agent_id: agentId,
    ...(eventHistory ? { event_history: true } : {}),
    day: new Date().toISOString().slice(0,10), issued_at: Timestamp.now(), next_sync_at: Timestamp.fromMillis(Date.now() + 30000), status: 'waiting', expires_at: expires(), attempts: 0 });
  return nonce;
}
async function syncVoice(id: string, apiKey: string, verifiedDetails?: Data) {
  const ref = jobs.doc(id), snapshot = await ref.get(), job = snapshot.data();
  if (!job || job.status === 'done' || !job.conversation_id) return;
  const data = verifiedDetails || await providerDetails(job.conversation_id, apiKey);
  if (data.user_id !== id || data.agent_id !== job.agent_id || data.conversation_id !== job.conversation_id) throw new HttpsError('permission-denied', 'The voice conversation could not be verified.');
  if (!['done','failed'].includes(data.status)) {
    await ref.update({ next_sync_at: Timestamp.fromMillis(Date.now()+30000), attempts: FieldValue.increment(1) });
    return;
  }
  const transcript = (Array.isArray(data.transcript) ? data.transcript : []).filter((m: Data) => ['user','agent'].includes(m.role) && typeof m.message === 'string' && m.message.trim());
  const questions = transcript.filter(hasPlatformVisitorMessage);
  if (questions.length) {
    const started = Number(data.metadata?.start_time_unix_secs);
    if (!Number.isFinite(started) || Math.abs(started*1000 - job.issued_at.toMillis()) > 24*3600000) throw new Error('Invalid voice start time.');
    const start = Timestamp.fromMillis(started*1000), duration = typeof data.metadata?.call_duration_secs==='number'?data.metadata.call_duration_secs:NaN;
    if (job.event_history || (!job.internal && !job.platform_only)) {
    const conversation = sessions.doc(id);
    // Provider turns are separate documents: long conversations are never silently truncated.
    const writer = db.bulkWriter();
    transcript.forEach((m: Data, i: number) => writer.set(conversation.collection('analytics_turns').doc(String(i).padStart(8,'0')), {
      role: m.role === 'agent' ? 'assistant' : 'user', text: m.message,
      created_at: Timestamp.fromMillis(started*1000 + Math.max(0, Number(m.time_in_call_secs)||0)*1000), expires_at: expires(),
    }));
    await writer.close();
    await conversation.set({ board_id: job.board_id, card_id: job.card_id, atlas_id: job.atlas_id,
      owner_id:job.owner_id||'', team_id:job.team_id||'', owner_key:job.owner_key||'', board_title:job.board_title||'', card_title:job.card_title||'', provider_conversation_id:job.conversation_id,
      actor_hash: job.actor_hash, visitor_hash: job.visitor_hash, mode:'voice', started_at:start, day:start.toDate().toISOString().slice(0,10),
      ...(job.event_history ? { event_history: true, internal: job.internal === true, has_audio: data.has_audio === true } : {}),
      last_activity_at: Timestamp.now(), status: data.status === 'done' ? 'completed' : 'interrupted',
      first_question: questions[0].message.slice(0,1000), questions: questions.length,
      duration_seconds: Number.isFinite(duration) && duration >= 0 ? duration : null, duration_kind:'recorded', expires_at: expires(),
    });
    const groups = new Map<string, {ref: FirebaseFirestore.DocumentReference; data: Data; count:number}>();
    for (const question of questions) {
      const rollup = questionRollup(job.board_id,job.card_id,start.toDate().toISOString().slice(0,10),question.message,job.atlas_id);
      const previous = groups.get(rollup.ref.id);
      groups.set(rollup.ref.id,{...rollup,count:(previous?.count || 0)+1});
    }
    const orderedGroups = [...groups.values()].sort((a,b)=>a.ref.id.localeCompare(b.ref.id));
    // Durable chunk receipts prevent double counting on retries and stay below Firestore's write limit.
    for (let offset=0; !job.internal && !job.platform_only && offset<orderedGroups.length; offset+=400) {
      const chunkId=String(offset/400);
      await db.runTransaction(async tx => {
        const latest=await tx.get(ref);
        if (latest.data()?.question_chunks?.includes(chunkId)) return;
        for (const group of orderedGroups.slice(offset,offset+400)) tx.set(group.ref,{...group.data,count:FieldValue.increment(group.count)},{merge:true});
        tx.update(ref,{question_chunks:FieldValue.arrayUnion(chunkId)});
      });
    }
    }
    await recordPlatformVerifiedVoice(id,job,data);
  }
  await ref.update({ status:'done', synced_at: Timestamp.now(), next_sync_at:FieldValue.delete(),
    outcome:questions.length?'conversation':'no_visitor_message', verified_questions:questions.length,
    verified_duration_seconds: typeof data.metadata?.call_duration_secs==='number'?data.metadata.call_duration_secs:null,
    last_error:FieldValue.delete() });
}
export const syncCardVoiceAnalytics = onCall({ region:'us-central1', cors:true, timeoutSeconds:60, secrets:[key] }, async request => {
  const nonce = String(request.data?.sessionId || ''), conversationId = String(request.data?.conversationId || '');
  if (!/^(?:card|team)_[A-Za-z0-9-]{36}$/.test(nonce) || !idPattern.test(conversationId)) throw new HttpsError('invalid-argument','Invalid voice session.');
  const ref = jobs.doc(nonce), job = (await ref.get()).data();
  const actorHash = hashAnalytics(request.auth?.uid ? `uid:${request.auth.uid}` : `anonymous:${String(request.data?.anonymousVisitorId || '')}`);
  if (!job || job.actor_hash !== actorHash) throw new HttpsError('permission-denied','This voice session is not available.');
  if (job.conversation_id && job.conversation_id !== conversationId) throw new HttpsError('permission-denied','This voice session is already attached.');
  if (job.status==='done') return {pending:false};
  // Verify before attaching an ID supplied by the browser; never trust its transcript or duration.
  const response = await fetch(`https://api.elevenlabs.io/v1/convai/conversations/${encodeURIComponent(conversationId)}`, { headers:{'xi-api-key':key.value()}, signal:AbortSignal.timeout(20000) });
  if (!response.ok) { await ref.update({next_sync_at:Timestamp.fromMillis(Date.now()+30000),last_error:'Provider verification will retry.'}); return {pending:true}; }
  const details = await response.json() as Data;
  if (details.user_id !== nonce || details.agent_id !== job.agent_id) throw new HttpsError('permission-denied','The voice conversation could not be verified.');
  await ref.update({ conversation_id:conversationId, next_sync_at:Timestamp.now() });
  try { await syncVoice(nonce,key.value(),details); }
  catch (error) {
    await ref.update({next_sync_at:Timestamp.fromMillis(Date.now()+30000),last_error:'Provider verification will retry.'});
    logger.warn('Card voice verification deferred',{sessionId:nonce});
    if (error instanceof HttpsError && error.code==='permission-denied') throw error;
  }
  return { pending:(await ref.get()).data()?.status !== 'done' };
});
export const recoverCardVoiceAnalytics = onSchedule({ schedule:'every 1 minutes', region:'us-central1', timeoutSeconds:540, secrets:[key] }, async () => {
  const pending = await jobs.where('next_sync_at','<=',Timestamp.now()).orderBy('next_sync_at').limit(40).get();
  const deadline=Date.now()+45000;
  for (const doc of pending.docs) {
    if(Date.now()>deadline) break;
    const value = doc.data();
    if (value.status === 'done') await enrichPlatformVoiceIdentity(doc.id,value);
    if (value.status === 'done' || Date.now()-value.issued_at.toMillis()>24*3600000) { await doc.ref.update({ next_sync_at:FieldValue.delete(), status: value.status === 'done' ? 'done' : 'unavailable' }); continue; }
    try {
      if (!value.conversation_id) {
        // Recover calls even if the browser closed before attaching the provider ID.
        const response = await fetch(`https://api.elevenlabs.io/v1/convai/conversations?user_id=${encodeURIComponent(doc.id)}&agent_id=${encodeURIComponent(value.agent_id)}&page_size=10`, { headers:{'xi-api-key':key.value()}, signal:AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error(`Voice recovery returned ${response.status}`);
        const data = await response.json() as Data;
        const match = data.conversations?.find((c: Data) => c.agent_id === value.agent_id);
        if (match) await doc.ref.update({ conversation_id:match.conversation_id });
      }
      await syncVoice(doc.id,key.value());
    } catch (error) { logger.warn('Card voice analytics pending', { sessionId:doc.id, error:String(error) }); }
    if ((await doc.ref.get()).data()?.status !== 'done') await doc.ref.update({ next_sync_at:Timestamp.fromMillis(Date.now()+60000),attempts:FieldValue.increment(1) });
  }
  if (new Date().getUTCMinutes()%5===0) await recoverPicamoVoice(key.value());
});
function serializedConversation(id: string, data: Data) {
  return { id, mode:data.mode, startedAt:data.started_at.toDate().toISOString(), visitor:`Visitor ${data.visitor_hash.slice(0,8)}`,
    visitorKey:data.visitor_hash, durationSeconds:typeof data.duration_seconds === 'number' ? data.duration_seconds : null,
    durationKind:data.duration_kind, status:data.mode === 'text' && Date.now()-data.last_activity_at.toMillis()>30*60000 ? 'completed' : data.status,
    questions:data.questions||0, knowledgeGaps:data.knowledge_gaps||0, failedAnswers:data.failed_answers||0, firstQuestion:data.first_question||'' };
}
export const getCardAnalytics = onCall({ region:'us-central1', cors:true, timeoutSeconds:60, memory:'512MiB' }, async request => {
  const target = await authorized(request);
  const range = analyticsRange(request.data);
  const {days, from} = range;
  const audience = analyticsAudience(request.data.audience);
  const [visitors, rows, tracking, traffic, questionDocs] = await Promise.all([
    uniqueAnalyticsVisitors(target.boardId,from,target.cardId,audience,range.to), readAnalyticsActivity(target.boardId,range,audience,target.cardId), trackingRef(target.boardId).get(),
    allAnalyticsDocs(db.collection('board_analytics_daily_shards').where('board_id','==',target.boardId).where('day','>=',from).orderBy('day')),
    target.canReadTranscripts && audience !== 'internal' ? allAnalyticsDocs(questionsCollection.where('board_id','==',target.boardId).where('card_id','==',target.cardId).where('day','>=',from).orderBy('day')) : Promise.resolve([]),
  ]);
  const conversations = rows.conversations.filter(row=>row.startedAt.slice(0,10)>=from).map(row=>({
    ...row, visitor: row.visitorKey ? `Visitor ${row.visitorKey.slice(0,8)}` : row.participantKey ? `Participant ${row.participantKey.slice(0,8)}` : 'Not attributed',
    canReadTranscript: !!row.transcriptId && target.canReadTranscripts && row.atlasId === target.atlasId,
  }));
  const questionCounts = new Map<string, { question:string; count:number }>();
  for (const doc of questionDocs) { const q=doc.data(); if(q.card_id!==target.cardId || q.atlas_id!==target.atlasId)continue; const previous=questionCounts.get(q.question_key); questionCounts.set(q.question_key,{question:q.question,count:(previous?.count||0)+(Number(q.count)||0)}); }
  const chatting = rows.audienceVisitors;
  const scopedTraffic = traffic.filter(doc=>includesAudience(audience,doc.data().internal===true) && doc.data().day<=range.to);
  const cardVisitors = new Set([...visitors,...chatting]);
  return { audience, activity: {totals:rows.totals,daily:rows.daily,knownParticipants:rows.knownParticipants.size,unverifiedVoice:rows.unverifiedVoice,verifiedAt:rows.verifiedAt}, board:{id:target.boardId,title:target.board.title||'Untitled board',customSlug:target.board.custom_slug||''}, card:{id:target.cardId,title:target.card.title||'Untitled card', talking:!!target.atlasId},
    popularQuestions:[...questionCounts.values()].sort((a,b)=>b.count-a.count || a.question.localeCompare(b.question)).slice(0,10),
    range:{days,from,to:range.to}, trackingStartedAt:trafficStartedAt(tracking.data(),audience),internalTrackingStartedAt:tracking.data()?.internal_started_at?.toDate().toISOString()||null,
    opens:scopedTraffic.reduce((sum,d)=>{const c=d.data().cards?.[target.cardId];return sum+(Number(c?.card_opens)||0)+(Number(c?.talking_card_opens)||0);},0),
    outboundClicks:scopedTraffic.reduce((sum,d)=>sum+(Number(d.data().cards?.[target.cardId]?.outbound_clicks)||0),0),
    canViewBoardAnalytics:target.canViewBoardAnalytics, canReadTranscripts:target.canReadTranscripts, visitors:cardVisitors.size, visitorsWhoChatted:chatting.size,
    conversations:conversations.map(({visitorKey,participantKey,atlasId,transcriptId,...c})=>({...c, firstQuestion: c.canReadTranscript ? c.firstQuestion : ''})),
    pendingVoice:rows.pendingVoice,
  };
});
export const getCardConversation = onCall({ region:'us-central1', cors:true, timeoutSeconds:30 }, async request => {
  const { ref, data, id } = await authorizedConversation(request);
  let query = ref.collection('analytics_turns').orderBy('created_at').orderBy('__name__').limit(50);
  const cursor = String(request.data.cursor || '');
  if (cursor) { if (!idPattern.test(cursor)) throw new HttpsError('invalid-argument','Invalid page.'); const snapshot=await ref.collection('analytics_turns').doc(cursor).get(); if(!snapshot.exists) throw new HttpsError('invalid-argument','This page has expired.'); query=query.startAfter(snapshot); }
  const page = await query.get();
  return { conversation:serializedConversation(id,data), hasAudio: data.event_history === true && data.has_audio === true,
    turns:page.docs.flatMap(d=>readAnalyticsTurn(data.mode, d.id, d.data())), nextCursor:page.size===50 ? page.docs.at(-1)!.id : null };
});

async function authorizedConversation(request: Actor) {
  const target = await authorized(request);
  if (!target.canReadTranscripts) throw new HttpsError('permission-denied','Only avatar administrators can read visitor transcripts.');
  const id = String(request.data.conversationId||'');
  if (!idPattern.test(id)) throw new HttpsError('invalid-argument','Choose a valid conversation.');
  const ref = sessions.doc(id), data = (await ref.get()).data();
  if (!data || data.expires_at?.toMillis() < Date.now() || data.board_id!==target.boardId || data.card_id!==target.cardId || data.atlas_id!==target.atlasId) throw new HttpsError('not-found','This conversation is not available for this card.');
  return { ref, data, id };
}

function readAnalyticsTurn(mode: string, id: string, t: Data) {
  const at = t.created_at.toDate().toISOString();
  return mode === 'text'
    ? [{ id: `${id}-q`, role: 'user', text: t.question, at, status: t.status },
        ...(t.answer ? [{ id: `${id}-a`, role: 'assistant', text: t.answer, at: t.answered_at.toDate().toISOString(), status: t.status }] : [])]
    : [{ id, role: t.role, text: t.text, at, status: 'answered' }];
}

export const getEventConversationAudio = onCall({ region:'us-central1', cors:true, timeoutSeconds:45, memory:'256MiB', secrets:[key] }, async request => {
  const { data } = await authorizedConversation(request);
  const providerId = data.provider_conversation_id;
  if (data.event_history !== true || data.mode !== 'voice' || data.has_audio !== true || !idPattern.test(providerId || '')) {
    throw new HttpsError('not-found', 'This conversation has no available recording.');
  }
  let response: Response;
  try {
    response = await fetch(`https://api.elevenlabs.io/v1/convai/conversations/${encodeURIComponent(providerId)}/audio`,
      { headers: { 'xi-api-key': key.value() }, signal: AbortSignal.timeout(30000) });
  } catch {
    throw new HttpsError('unavailable', 'The recording could not be loaded. Try again.');
  }
  if (response.status === 404) throw new HttpsError('not-found', 'This recording is no longer available.');
  if (!response.ok || !response.headers.get('content-type')?.startsWith('audio/')) {
    throw new HttpsError('unavailable', 'The recording could not be loaded. Try again.');
  }
  const maxBytes = 12 * 1024 * 1024;
  if (Number(response.headers.get('content-length')) > maxBytes) throw new HttpsError('resource-exhausted', 'This recording is too large to play here.');
  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.length > maxBytes) throw new HttpsError('resource-exhausted', 'This recording is too large to play here.');
  return { audio: audio.toString('base64'), contentType: 'audio/mpeg' };
});

export async function readEventRecapTurns(request: Actor, atlasId: string) {
  const voice = Array.isArray(request.data.voiceSessions) ? request.data.voiceSessions : [];
  const typed = Array.isArray(request.data.textSessions) ? request.data.textSessions : [];
  if (!voice.length && !typed.length) return [];
  if (voice.length + typed.length > 16 || voice.some(id => typeof id !== 'string' || !/^card_[a-f0-9-]{36}$/.test(id))
    || typed.some(id => typeof id !== 'string' || !clientPattern.test(id))) {
    throw new HttpsError('invalid-argument', 'Invalid event conversation.');
  }
  const anonymous = String(request.data.anonymousVisitorId || '');
  if (!request.auth?.uid && !clientPattern.test(anonymous)) throw new HttpsError('unauthenticated', 'A visitor session is required.');
  const actor = hashAnalytics(request.auth?.uid ? `uid:${request.auth.uid}` : `anonymous:${anonymous}`);
  const { boardId, cardId } = request.data;
  const matches = (data: Data | undefined) => data?.event_history === true && data.actor_hash === actor
    && data.board_id === boardId && data.card_id === cardId && data.atlas_id === atlasId
    && data.expires_at?.toMillis() > Date.now();
  const read = async (id: string, mode: 'voice' | 'text') => {
    const ref = sessions.doc(id);
    if (mode === 'voice') {
      const job = (await jobs.doc(id).get()).data();
      if (!matches(job)) throw new HttpsError('permission-denied', 'This conversation is not available.');
      if (job?.outcome === 'no_visitor_message') return [];
      if (job?.status !== 'done') throw new HttpsError('failed-precondition', 'Your call recap is still being prepared. Try again in a moment.');
    }
    const data = (await ref.get()).data();
    if (!matches(data) || data?.mode !== mode) throw new HttpsError('permission-denied', 'This conversation is not available.');
    const page = await ref.collection('analytics_turns').orderBy('created_at', 'desc').orderBy('__name__', 'desc').limit(30).get();
    return page.docs.flatMap(doc => readAnalyticsTurn(mode, doc.id, doc.data()));
  };
  const groups = await Promise.all([
    ...[...new Set<string>(voice)].map(id => read(id, 'voice')),
    ...[...new Set<string>(typed)].map(id => read(hashAnalytics(`${boardId}:${cardId}:${actor}:${id}`), 'text')),
  ]);
  return groups.flat().sort((a, b) => a.at.localeCompare(b.at)).slice(-24).map(turn => ({
    role: turn.role === 'user' ? 'user' as const : 'assistant' as const,
    text: String(turn.text || '').trim().slice(0, 2000),
  })).filter(turn => turn.text);
}

async function providerDetails(conversationId: string, apiKey: string): Promise<Data> {
  const response=await fetch(`https://api.elevenlabs.io/v1/convai/conversations/${encodeURIComponent(conversationId)}`,
    {headers:{'xi-api-key':apiKey},signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error(`Voice provider returned ${response.status}`);
  return response.json() as Promise<Data>;
}
export const reconcileBoardAnalytics = onCall({region:'us-central1',cors:true,timeoutSeconds:300,memory:'512MiB',secrets:[key]},async request=>{
  const boardId=String(request.data?.boardId||'');
  if(!idPattern.test(boardId))throw new HttpsError('invalid-argument','Choose a valid board.');
  const uid=request.auth?.uid;
  if(!uid)throw new HttpsError('unauthenticated','Sign in to reconcile analytics.');
  const [board,user]=await db.getAll(db.collection('boards').doc(boardId),db.collection('users').doc(uid));
  if(!board.exists)throw new HttpsError('not-found','This board is not available.');
  if(board.data()?.owner_user_id!==uid&&user.data()?.role!=='admin')throw new HttpsError('permission-denied','Only the owner or a platform administrator can reconcile analytics.');
  const cursor=request.data?.cursor;
  let query=jobs.where('board_id','==',boardId).orderBy('__name__').limit(20);
  if(cursor){if(typeof cursor!=='string'||!idPattern.test(cursor))throw new HttpsError('invalid-argument','Invalid recovery cursor.');query=query.startAfter(cursor);}
  const page=await query.get();let recovered=0,unavailable=0,processed=0,lastId:string|null=null;const deadline=Date.now()+240000;
  for(const doc of page.docs){
    if(Date.now()>deadline)break;processed++;lastId=doc.id;
    const job=doc.data();
    if(!job.event_history && await enrichPlatformVoiceIdentity(doc.id,job)){recovered++;continue;}
    if(job.outcome==='no_visitor_message')continue;
    if(job.event_history && job.status==='done'){recovered++;continue;}
    try{
      let conversationId=job.conversation_id;
      if(!conversationId){
        const response=await fetch(`https://api.elevenlabs.io/v1/convai/conversations?user_id=${encodeURIComponent(doc.id)}&agent_id=${encodeURIComponent(job.agent_id)}&page_size=10`,{headers:{'xi-api-key':key.value()},signal:AbortSignal.timeout(15000)});
        if(!response.ok)throw new Error('Provider history unavailable.');
        const result=await response.json() as Data;
        conversationId=result.conversations?.find((c:Data)=>c.agent_id===job.agent_id)?.conversation_id;
      }
      if(!conversationId){unavailable++;continue;}
      const details=await providerDetails(conversationId,key.value());
      if(details.user_id!==doc.id||details.agent_id!==job.agent_id||details.conversation_id!==conversationId)throw new Error('Provider binding mismatch.');
      const started=Number(details.metadata?.start_time_unix_secs)*1000;
      if(!Number.isFinite(started)||Math.abs(started-job.issued_at.toMillis())>86400000)throw new Error('Invalid provider timestamp.');
      if(!['done','failed'].includes(details.status)){unavailable++;continue;}
      if (job.event_history) {
        await doc.ref.update({ conversation_id: conversationId });
        await syncVoice(doc.id, key.value(), details);
        recovered++;
        continue;
      }
      await recordPlatformVerifiedVoice(doc.id,job,details);
      await doc.ref.update({conversation_id:conversationId,status:'done',synced_at:Timestamp.now(),next_sync_at:FieldValue.delete(),outcome:(details.transcript||[]).some(hasPlatformVisitorMessage)?'conversation':'no_visitor_message'});
      recovered++;
    }catch{unavailable++;}
  }
  return {processed,recovered,unavailable,nextCursor:processed<page.size||page.size===20?lastId:null};
});
