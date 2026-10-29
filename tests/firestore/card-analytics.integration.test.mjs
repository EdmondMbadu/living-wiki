import assert from 'node:assert/strict';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { before, after, test } from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../functions/package.json', import.meta.url));
process.env.GCLOUD_PROJECT='demo-living-wiki';
const { db }=require('./lib/firebase');
const { Timestamp }=require('firebase-admin/firestore');
const api=require('./lib/card-analytics');
const { recordBoardAnalyticsEvent, getBoardInsights, analyticsDay }=require('./lib/board-analytics');
const owner='analytics-owner', boardId='analytics-board', cardId='analytics-card', otherCard='analytics-card-two', atlasId='analytics-avatar';
const atlas={id:atlasId,user_id:owner,admin_user_ids:['analytics-avatar-admin']};
const cards=[{id:cardId,title:'First card',conversation:{provider:'atlas',atlasId}},{id:otherCard,title:'Second card',conversation:{provider:'atlas',atlasId}},{id:'ordinary-card',title:'Ordinary card'}];
const visitor='browser_analytics_123456789';
let serial=0;
const request=(extra={},uid)=>({data:{boardId,cardId,atlasId,anonymousVisitorId:'anonymous_analytics_123456',analyticsVisitorId:visitor,analyticsSessionId:'session_analytics_123456',analyticsRequestId:`request_analytics_${++serial}`,question:'Wrapped system context',visitorQuestion:'Actual visitor question',...extra},auth:uid?{uid}:undefined,rawRequest:{headers:{'user-agent':'Mozilla/5.0'},ip:'127.0.0.1'}});
const report=(card=cardId,uid=owner)=>api.getCardAnalytics.run(request({cardId:card,days:30},uid));
const event=(type,card=cardId,extra={})=>recordBoardAnalyticsEvent.run(request({visitorId:visitor,sessionId:'session_analytics_123456',eventId:`event_analytics_${++serial}`,eventType:type,cardId:card,...extra}));
before(async()=>{
 assert.ok(process.env.FIRESTORE_EMULATOR_HOST,'Use emulator, never production.');
 await db.collection('boards').doc(boardId).set({owner_user_id:owner,title:'Analytics board',visibility:'public',cards});
 await db.collection('atlases').doc(atlasId).set(atlas);
});
after(async()=>{
 await db.recursiveDelete(db.collection('board_tracking').doc(boardId));
 for(const c of ['card_analytics_conversations','card_analytics_voice_sessions','card_analytics_questions','board_analytics_daily_shards']){
  const docs=await db.collection(c).where('board_id','==',boardId).get();for(const doc of docs.docs)await db.recursiveDelete(doc.ref);
 }
 await db.collection('boards').doc(boardId).delete();await db.collection('atlases').doc(atlasId).delete();
});
test('board event receipts are idempotent; forged cards are rejected',async()=>{
 const r=request({visitorId:visitor,sessionId:'session_analytics_123456',eventId:'event_duplicate_123456',eventType:'board_view',cardId:null});
 assert.equal((await recordBoardAnalyticsEvent.run(r)).accepted,true);
 assert.equal((await recordBoardAnalyticsEvent.run(r)).reason,'duplicate');
 await assert.rejects(event('card_open','forged-card'),{code:'invalid-argument'});
});
test('period uniques deduplicate a browser across days and do not sum daily totals',async()=>{
 const from=analyticsDay(new Date(Date.now()-86400000));
 await api.trackingRef(boardId).collection('visitors').doc(api.hashAnalytics(visitor)).set({days:[from,analyticsDay()],last_day:analyticsDay()});
 await db.collection('board_analytics_daily_shards').doc(`${boardId}__${from}__0`).set({board_id:boardId,day:from,counts:{views:1,unique_visitors:1}});
 const r=await getBoardInsights.run(request({days:30},owner));assert.equal(r.totals.uniqueVisitors,1);assert.equal(r.totals.views,2);
});
test('only meaningful card activity creates a card visitor; normal cards work',async()=>{
 await event('card_open');await event('talking_card_open');await event('outbound_click','ordinary-card');
 const r=await report();assert.equal(r.visitors,1);assert.equal(r.opens,2);assert.equal(r.conversations.length,0);
 const ordinary=await report('ordinary-card');assert.equal(ordinary.card.talking,false);assert.equal(ordinary.outboundClicks,1);assert.equal(ordinary.visitors,1);
});
test('historical opens agree between board and card reports without fabricating visitor identities',async()=>{
 const day=analyticsDay(new Date(Date.now()-2*86400000));
 await db.collection('board_analytics_daily_shards').doc(`${boardId}__${day}__0`).set({board_id:boardId,day,counts:{card_opens:2},cards:{[otherCard]:{card_opens:2}}});
 const boardReport=await getBoardInsights.run(request({days:30},owner)),cardReport=await report(otherCard);
 assert.equal(boardReport.cards.find(c=>c.cardId===otherCard).opens,2);assert.equal(cardReport.opens,2);assert.equal(cardReport.visitors,0);
});
test('typed conversation saves actual visitor wording and actual response; retry cannot double count',async()=>{
 const r=request();const context=await api.beginCardText(r,atlas);
 await api.finishCardText(context,{answer:'Actual model answer',threadId:'thread_one',knowledgeGap:true});
 await api.finishCardText(context,{answer:'Duplicate'});
 await assert.rejects(api.beginCardText(r,atlas),{code:'already-exists'});
 const reportData=await report();assert.equal(reportData.conversations.length,1);assert.equal(reportData.visitorsWhoChatted,1);assert.equal(reportData.conversations[0].questions,1);assert.equal(reportData.popularQuestions[0].question,'Actual visitor question');assert.equal(reportData.popularQuestions[0].count,1);
 const detail=await api.getCardConversation.run(request({conversationId:context.ref.id},owner));
 assert.deepEqual(detail.turns.map(t=>t.text),['Actual visitor question','Actual model answer']);
 assert.equal(detail.conversation.knowledgeGaps,1);assert.equal(detail.conversation.durationKind,'estimated');
});
test('same avatar on a second card has independent sessions, visitor conversion and transcripts',async()=>{
 const ctx=await api.beginCardText(request({cardId:otherCard}),atlas);await api.finishCardText(ctx,{answer:'Other card answer',threadId:'thread_two'});
 const r=await report(otherCard);assert.equal(r.conversations.length,1);assert.equal(r.visitors,1);
 const first=await report();assert.equal(first.conversations.length,1);
 await assert.rejects(api.getCardConversation.run(request({conversationId:ctx.ref.id},owner)),{code:'not-found'});
});
test('subsequent turns reuse only the matching server thread and cap idle duration',async()=>{
 const one=await api.beginCardText(request({analyticsSessionId:'session_duration_123456'}),atlas);await api.finishCardText(one,{answer:'First',threadId:'thread_duration'});
 await one.ref.update({last_activity_at:Timestamp.fromMillis(Date.now()-5*60000),duration_seconds:0});
 const next=await api.beginCardText(request({analyticsSessionId:'session_duration_123456'}),atlas);assert.equal(next.threadId,'thread_duration');
 await api.finishCardText(next,{answer:'Second',threadId:'thread_duration'});
 const data=(await next.ref.get()).data();assert.equal(data.questions,2);assert.ok(data.duration_seconds>=60&&data.duration_seconds<62);
 await next.ref.update({last_activity_at:Timestamp.fromMillis(Date.now()-31*60000)});
 await assert.rejects(api.beginCardText(request({analyticsSessionId:'session_duration_123456'}),atlas),{code:'failed-precondition'});
});
test('failed model responses remain visible without a fabricated assistant answer',async()=>{
 const ctx=await api.beginCardText(request({analyticsSessionId:'session_failure_123456'}),atlas);await api.finishCardText(ctx);
 const data=await api.getCardConversation.run(request({conversationId:ctx.ref.id},owner));assert.equal(data.turns.length,1);assert.equal(data.turns[0].status,'failed');assert.equal(data.conversation.failedAnswers,1);
});
for(const [label,uid,ua] of [['board owner',owner],['avatar administrator','analytics-avatar-admin'],['recognized bot',undefined,'SearchBot/1.0']]){
 test(`${label} is excluded from conversation counts`,async()=>{
  const r=request({analyticsSessionId:`session_excluded_${++serial}`},uid);if(ua)r.rawRequest.headers['user-agent']=ua;
  assert.equal(await api.beginCardText(r,atlas),null);assert.equal(await api.issueCardVoice(r,atlas,'agent_fixture'),null);
 });
}
test('missing browser metadata never fabricates historical attribution',async()=>{
 assert.equal(await api.beginCardText(request({analyticsVisitorId:null}),atlas),null);
});
test('reports and transcripts reject anonymous, unauthorized and cross-board requests',async()=>{
 await assert.rejects(report(cardId,null),{code:'unauthenticated'});
 await assert.rejects(report(cardId,'other-owner'),{code:'permission-denied'});
 const r=await report(cardId,'analytics-avatar-admin');assert.equal(r.canReadTranscripts,true);assert.equal(r.canViewBoardAnalytics,false);
 await db.collection('boards').doc('analytics-other-board').set({owner_user_id:owner,visibility:'public',cards});
 const first=(await report()).conversations[0];await assert.rejects(api.getCardConversation.run(request({boardId:'analytics-other-board',conversationId:first.id},owner)),{code:'not-found'});
 await db.collection('boards').doc('analytics-other-board').delete();
});
test('board owner cannot read a foreign avatar transcript, including first-question previews',async()=>{
 await db.collection('atlases').doc(atlasId).update({user_id:'foreign-avatar-owner',admin_user_ids:[]});
 const r=await report();assert.equal(r.canReadTranscripts,false);assert.ok(r.conversations.every(c=>c.firstQuestion===''));assert.deepEqual(r.popularQuestions,[]);
 await assert.rejects(api.getCardConversation.run(request({conversationId:r.conversations[0].id},owner)),{code:'permission-denied'});
 await db.collection('atlases').doc(atlasId).set(atlas);
});
test('long transcripts paginate in full chronological order without a 100-message truncation',async()=>{
 const ctx=await api.beginCardText(request({analyticsSessionId:'session_long_12345678'}),atlas);await api.finishCardText(ctx,{answer:'Initial'});
 const writer=db.bulkWriter();for(let i=0;i<105;i++)writer.set(ctx.ref.collection('analytics_turns').doc(`long_turn_${String(i).padStart(4,'0')}`),{question:`Question ${i}`,answer:`Answer ${i}`,created_at:Timestamp.fromMillis(Date.now()+i),answered_at:Timestamp.fromMillis(Date.now()+i),status:'answered'});await writer.close();
 let cursor=null;const turns=[];let pages=0;do{const p=await api.getCardConversation.run(request({conversationId:ctx.ref.id,cursor},owner));turns.push(...p.turns);cursor=p.nextCursor;pages++;}while(cursor);
 assert.equal(pages,3);assert.equal(turns.length,212);assert.equal(turns.at(-1).text,'Answer 104');
});
test('voice calls use verified provider identity, transcript and duration; repeat sync is idempotent',async()=>{
 process.env.ELEVENLABS_API_KEY='fixture_key';const original=globalThis.fetch;
 const nonce=await api.issueCardVoice(request(),atlas,'agent_fixture');let done=false;
 globalThis.fetch=async()=>new Response(JSON.stringify({user_id:nonce,agent_id:'agent_fixture',conversation_id:'conv_fixture',status:done?'done':'in-progress',metadata:{start_time_unix_secs:Math.floor(Date.now()/1000),call_duration_secs:83},transcript:[{role:'agent',message:'Welcome',time_in_call_secs:0},{role:'user',message:'A real voice question',time_in_call_secs:3},{role:'agent',message:'A real voice answer',time_in_call_secs:10}]}),{status:200});
 try{
  const r=request({sessionId:nonce,conversationId:'conv_fixture'});assert.equal((await api.syncCardVoiceAnalytics.run(r)).pending,true);
  assert.equal((await report()).conversations.filter(c=>c.mode==='voice').length,0);
  done=true;assert.equal((await api.syncCardVoiceAnalytics.run(r)).pending,false);await api.syncCardVoiceAnalytics.run(r);
  const rows=(await report()).conversations.filter(c=>c.mode==='voice');assert.equal(rows.length,1);assert.equal(rows[0].durationSeconds,83);
  const detail=await api.getCardConversation.run(request({conversationId:nonce},owner));assert.equal(detail.turns[1].text,'A real voice question');
 }finally{globalThis.fetch=original;}
});
test('forged provider conversation identity is rejected and never recorded',async()=>{
 const nonce=await api.issueCardVoice(request(),atlas,'agent_fixture');const original=globalThis.fetch;
 globalThis.fetch=async()=>new Response(JSON.stringify({user_id:'someone_else',agent_id:'agent_fixture'}),{status:200});
 try{await assert.rejects(api.syncCardVoiceAnalytics.run(request({sessionId:nonce,conversationId:'conv_forged'})),{code:'permission-denied'});assert.equal((await db.collection('card_analytics_conversations').doc(nonce).get()).exists,false);}finally{globalThis.fetch=original;}
});
test('voice greeting without a visitor message is not counted as a conversation',async()=>{
 const nonce=await api.issueCardVoice(request(),atlas,'agent_fixture');const original=globalThis.fetch;
 globalThis.fetch=async()=>new Response(JSON.stringify({user_id:nonce,agent_id:'agent_fixture',conversation_id:'conv_greeting',status:'done',metadata:{start_time_unix_secs:Math.floor(Date.now()/1000),call_duration_secs:5},transcript:[{role:'agent',message:'Welcome'}]}),{status:200});
 try{await api.syncCardVoiceAnalytics.run(request({sessionId:nonce,conversationId:'conv_greeting'}));assert.equal((await db.collection('card_analytics_conversations').doc(nonce).get()).exists,false);}finally{globalThis.fetch=original;}
});
test('historical legacy events are never relabeled as conversations',async()=>{
 await event('talking_card_message');await event('talking_card_voice_start');
 const expected=(await report()).conversations.length;const board=await getBoardInsights.run(request({days:30},owner));assert.equal(board.totals.conversations,expected+(await report(otherCard)).conversations.length);assert.equal(board.cards.length,3);
});

test('voice calls are recovered and verified even when the browser never attached their ID',async()=>{
 const nonce=await api.issueCardVoice(request(),atlas,'agent_fixture');
 await db.collection('card_analytics_voice_sessions').doc(nonce).update({next_sync_at:Timestamp.fromMillis(Date.now()-1000)});
 const original=globalThis.fetch;
 globalThis.fetch=async url=>new Response(JSON.stringify(String(url).includes('?') ? {conversations:String(url).includes(encodeURIComponent(nonce))?[{conversation_id:'conv_recovered_fixture',agent_id:'agent_fixture'}]:[]} : {user_id:nonce,agent_id:'agent_fixture',conversation_id:'conv_recovered_fixture',status:'done',metadata:{start_time_unix_secs:Math.floor(Date.now()/1000),call_duration_secs:42},transcript:[{role:'user',message:'Recovered question',time_in_call_secs:1},{role:'agent',message:'Recovered answer',time_in_call_secs:2}]}),{status:200});
 try{await api.recoverCardVoiceAnalytics.run({});const record=(await db.collection('card_analytics_conversations').doc(nonce).get()).data();assert.equal(record.duration_seconds,42);assert.equal(record.questions,1);const r=await report();assert.equal(r.popularQuestions.find(q=>q.question==='Recovered question').count,1);}finally{globalThis.fetch=original;}
});

test('Firestore clients cannot read visitor identities, transcripts or question summaries, even as the owner',async()=>{
 const env=await initializeTestEnvironment({projectId:'demo-living-wiki'});
 try{
  for(const uid of [owner,'unrelated-user',null]){
   const client=uid?env.authenticatedContext(uid).firestore():env.unauthenticatedContext().firestore();
   for(const path of [`board_tracking/${boardId}`,`board_tracking/${boardId}/visitors/browser`, 'card_analytics_conversations/private_conversation', 'card_analytics_conversations/private_conversation/analytics_turns/private_turn', 'card_analytics_voice_sessions/private_session', 'card_analytics_questions/private_question']){
    await assertFails(getDoc(doc(client,path)));await assertFails(setDoc(doc(client,path),{forged:true}));
   }
  }
 }finally{await env.cleanup();}
});

test('reassigning the card to another avatar never exposes previous private question previews',async()=>{
 const otherAtlas='analytics-replacement-avatar';await db.collection('atlases').doc(otherAtlas).set({user_id:owner,admin_user_ids:[]});
 await db.collection('boards').doc(boardId).update({cards:cards.map(c=>c.id===cardId?{...c,conversation:{provider:'atlas',atlasId:otherAtlas}}:c)});
 try{const r=await report();assert.equal(r.canReadTranscripts,true);assert.ok(r.conversations.length>0);assert.ok(r.conversations.every(c=>c.firstQuestion===''&&c.canReadTranscript===false));assert.deepEqual(r.popularQuestions,[]);await assert.rejects(api.getCardConversation.run(request({conversationId:r.conversations[0].id},owner)),{code:'not-found'});}finally{await db.collection('boards').doc(boardId).update({cards});await db.collection('atlases').doc(otherAtlas).delete();}
});

test('ending a text conversation is idempotent and cannot close another visitor session',async()=>{
 const input=request({analyticsSessionId:'session_end_123456789'}), context=await api.beginCardText(input,atlas);await api.finishCardText(context,{answer:'Completed answer'});
 const end=request({sessionId:input.data.analyticsSessionId});
 await api.endCardTextAnalytics.run({...end,data:{...end.data,anonymousVisitorId:'another_visitor_123456789'}});assert.equal((await context.ref.get()).data().status,'active');
 await api.endCardTextAnalytics.run(end);const first=(await context.ref.get()).data();assert.equal(first.status,'completed');
 await api.endCardTextAnalytics.run(end);assert.equal((await context.ref.get()).data().duration_seconds,first.duration_seconds);
});
