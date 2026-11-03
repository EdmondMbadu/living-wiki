import { createHash, randomBytes } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db } from './firebase';
import { buildBoardInsights } from './board-analytics';
import { flattenAnalyticsCards } from './card-analytics';

const reports = db.collection('analytics_report_shares');
const digest = (token: string) => createHash('sha256').update(token).digest('hex');
const publicOrigin = 'https://livingwiki.com';
type Data = Record<string, any>;
const unavailable = () => new HttpsError('not-found', 'This report link has expired or is no longer available.');

async function authorized(uid: string | undefined, boardId: unknown) {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to manage report links.');
  if (typeof boardId !== 'string' || !/^[A-Za-z0-9_-]{1,180}$/.test(boardId)) throw new HttpsError('invalid-argument', 'Choose a valid board.');
  const [board, profile] = await db.getAll(db.collection('boards').doc(boardId), db.collection('users').doc(uid));
  if (!board.exists) throw new HttpsError('not-found', 'This board is no longer available.');
  if (board.data()!.owner_user_id !== uid && profile.data()?.role !== 'admin') throw new HttpsError('permission-denied', 'Only the owner or a platform administrator can share this report.');
  return {boardId, board:board.data()!};
}

/** Explicit allowlist: questions, transcripts, browser IDs, contacts and campaign labels never enter a shared report. */
export function sharedAnalyticsSnapshot(report: Data, board: Data) {
  const allowed = new Set(flattenAnalyticsCards(board.cards).map(card => card.id));
  const visibleCards = report.cards.filter((card: Data) => allowed.has(card.cardId));
  const slug = report.board.customSlug || report.board.id;
  const scalarTotals = (value: Data) => ({
    conversations:value.conversations || 0, voice:value.voice || 0, text:value.text || 0,
    seconds:value.seconds || 0, unknownDurations:value.unknownDurations || 0,
    unattributedConversations:value.unattributedConversations || 0,
  });
  return {
    board:{title:report.board.title, customSlug:report.board.customSlug,
      publicUrl: ['public','unlisted'].includes(report.board.visibility) ? `${publicOrigin}/boards/${encodeURIComponent(slug)}` : null},
    range:{from:report.range.from,to:report.range.to}, audience:report.audience,
    generatedAt:new Date().toISOString(), verifiedAt:report.activity.verifiedAt,
    trackingStartedAt:report.trackingStartedAt,
    totals:{views:report.totals.views,uniqueVisitors:report.totals.uniqueVisitors,knownParticipants:report.activity.knownParticipants,
      cardOpens:report.totals.cardOpens + (report.totals.talkingCardOpens || 0),
      outboundClicks:report.totals.outboundClicks,engagedVisits:report.totals.engagedVisits,
      ...scalarTotals(report.activity.totals)},
    status:{pendingVoice:report.activity.pendingVoice,unverifiedVoice:report.activity.unverifiedVoice,
      partial:!report.trackingStartedAt || report.range.from < report.trackingStartedAt.slice(0,10)},
    daily:report.daily.map((day:Data)=>({day:day.day,views:day.views,
      ...scalarTotals(report.activity.daily.find((row:Data)=>row.day===day.day) || {})})),
    cards:visibleCards.slice(0,200).map((card:Data)=>({title:card.title,opens:card.opens+(card.talkingCardOpens||0),
      conversations:card.conversations||0,outboundClicks:card.outboundClicks||0})),
    shownCards:Math.min(200,visibleCards.length),totalCards:visibleCards.length,
  };
}

export const manageAnalyticsReportShares = onCall({region:'us-central1',cors:true,timeoutSeconds:90,memory:'512MiB'},async request=>{
  const {boardId,board} = await authorized(request.auth?.uid, request.data?.boardId);
  const action = request.data?.action;
  if (action === 'revoke') {
    const id = request.data?.id;
    if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) throw new HttpsError('invalid-argument','Choose a valid report link.');
    const ref=reports.doc(id), value=(await ref.get()).data();
    if (!value || value.board_id!==boardId) throw unavailable();
    await ref.update({revoked_at:Timestamp.now()});
    return {revoked:true};
  }
  if (action === 'list') {
    const rows=await reports.where('board_id','==',boardId).select('created_at','expires_at','revoked_at','snapshot.audience','snapshot.range').get();
    return {links:rows.docs.map(doc=>({id:doc.id,createdAt:doc.data().created_at.toDate().toISOString(),
      expiresAt:doc.data().expires_at.toDate().toISOString(),revoked:!!doc.data().revoked_at,
      audience:doc.data().snapshot.audience,range:doc.data().snapshot.range}))
      .sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,50)};
  }
  if (action !== 'create') throw new HttpsError('invalid-argument','Choose a valid sharing action.');
  const lifetime=Number(request.data?.expiresDays ?? 30);
  if (![7,30,90].includes(lifetime)) throw new HttpsError('invalid-argument','Choose a valid expiry.');
  const report=await buildBoardInsights({auth:{uid:request.auth!.uid},data:{boardId,days:request.data?.days,
    audience:request.data?.audience ?? 'visitors',from:request.data?.from,to:request.data?.to}});
  const snapshot=sharedAnalyticsSnapshot(report,board);
  if (Buffer.byteLength(JSON.stringify(snapshot))>700000) throw new HttpsError('resource-exhausted','Choose a shorter report period.');
  const token=randomBytes(32).toString('base64url'), now=Timestamp.now();
  const expiresAt=Timestamp.fromMillis(now.toMillis()+lifetime*86400000);
  const ref=reports.doc(digest(token)), quota=db.collection('analytics_report_share_limits').doc(boardId);
  await db.runTransaction(async tx=>{
    const state=(await tx.get(quota)).data();
    const day=now.toDate().toISOString().slice(0,10);
    const count=state?.day===day?Number(state.count)||0:0;
    if(count>=50)throw new HttpsError('resource-exhausted','Too many report links created today. Reuse an existing link or try tomorrow.');
    tx.set(quota,{day,count:count+1});
    tx.create(ref,{board_id:boardId,owner_id:String(board.owner_user_id||''),created_by:request.auth!.uid,
      created_at:now,expires_at:expiresAt,revoked_at:null,snapshot});
  });
  const path=`/reports/boards/${encodeURIComponent(report.board.customSlug||boardId)}#access=${token}`;
  return {id:ref.id,url:`${publicOrigin}${path}`,path,expiresAt:expiresAt.toDate().toISOString(),snapshot};
});

export const getSharedAnalyticsReport = onCall({region:'us-central1',cors:true,timeoutSeconds:20,maxInstances:5},async request=>{
  const token=request.data?.token;
  if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))throw unavailable();
  const share=(await reports.doc(digest(token)).get()).data();
  if(!share||share.revoked_at||share.expires_at.toMillis()<=Date.now())throw unavailable();
  // Deleting/transferring a board invalidates previously issued report grants.
  const board=(await db.collection('boards').doc(share.board_id).get()).data();
  if(!board||String(board.owner_user_id||'')!==share.owner_id)throw unavailable();
  return {report:share.snapshot,expiresAt:share.expires_at.toDate().toISOString()};
});
