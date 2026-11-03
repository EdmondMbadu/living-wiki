import assert from 'node:assert/strict';
import {before,beforeEach,after,test} from 'node:test';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
process.env.GCLOUD_PROJECT='demo-living-wiki';
process.env.FIREBASE_CONFIG=JSON.stringify({projectId:'demo-living-wiki',storageBucket:'demo-living-wiki.appspot.com'});
const require=createRequire(new URL('../../functions/package.json',import.meta.url));
const {db}=require('./lib/firebase');
const {Timestamp}=require('firebase-admin/firestore');
const card=require('./lib/card-analytics');
const platform=require('./lib/platform-analytics');
const {buildBoardInsights}=require('./lib/board-analytics');
const activity=require('./lib/analytics-activity');
const shares=require('./lib/analytics-report-sharing');
const boardId='reliable-board',cardId='talking-card',owner='analytics-owner';
const today=()=>new Date().toISOString().slice(0,10);
const request=(data={},uid=owner)=>({data:{boardId,cardId,...data},...(uid?{auth:{uid,token:{}}}:{}),rawRequest:{headers:{'user-agent':'Analytics tests'}}});
const board=()=>({owner_user_id:owner,title:'Reliable museum',custom_slug:'the-tate-top-20',visibility:'public',cards:[
 {id:cardId,title:'George Washington',conversation:{provider:'atlas',atlasId:'atlas-reliable'}},
 {id:'hidden-card',title:'Private author instructions',authorOnly:true},
]});
before(()=>assert(process.env.FIRESTORE_EMULATOR_HOST,'Requires Firestore emulator.'));
beforeEach(async()=>{
 await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-living-wiki/databases/(default)/documents`,{method:'DELETE'});
 await db.doc(`boards/${boardId}`).set(board());await db.doc(`users/${owner}`).set({role:'user'});
 await db.doc('atlases/atlas-reliable').set({user_id:owner});
});
after(()=>db.terminate());
async function verified(id,seconds=164,internal=true,start=Date.now()-300000){
 const job={board_id:boardId,card_id:cardId,atlas_id:'atlas-reliable',agent_id:'agent-reliable',conversation_id:`conv_${id}`,
   internal,visitor_hash:internal?'staff-browser':'visitor-browser',actor_hash:internal?'staff-account':'visitor-account',
   issued_at:Timestamp.fromMillis(start),day:new Date(start).toISOString().slice(0,10),status:'done'};
 await db.doc(`card_analytics_voice_sessions/${id}`).set(job);
 await platform.recordPlatformVerifiedVoice(id,job,{conversation_id:job.conversation_id,status:'done',metadata:{start_time_unix_secs:Math.floor(start/1000),call_duration_secs:seconds},transcript:[{role:'user',message:'Private visitor question'}]});
 return job;
}
test('card and board views agree on verified calls, scopes and provider deduplication',async()=>{
 const job=await verified('public-call',83,false);
 const raw={board_id:boardId,card_id:cardId,atlas_id:'atlas-reliable',provider_conversation_id:job.conversation_id,
   started_at:job.issued_at,last_activity_at:Timestamp.now(),day:today(),mode:'voice',duration_kind:'recorded',duration_seconds:83,
   visitor_hash:'visitor-browser',actor_hash:'visitor-account',status:'completed',questions:1,first_question:'Private visitor question'};
 await db.doc('card_analytics_conversations/public-call').set(raw);
 await platform.ingestPlatformConversation('public-call',raw);
 await verified('internal-call');
 for(const [audience,count,seconds] of [['all',2,247],['visitors',1,83],['internal',1,164]]){
  const c=await card.getCardAnalytics.run(request({audience,days:30}));
  const b=await buildBoardInsights(request({audience,days:30}));
  assert.equal(c.conversations.length,count);assert.equal(c.activity.totals.seconds,seconds);
  assert.equal(b.totals.conversations,count);assert.equal(b.activity.totals.seconds,seconds);
  assert.equal(c.visitors,1,'Visitor traffic must not change with the conversation scope');assert.equal(b.totals.uniqueVisitors,1);
  if(audience==='all'){
   const internal=c.conversations.find(row=>row.internal);assert.equal(internal.durationSeconds,164);
   assert.equal(internal.canReadTranscript,false);assert.equal(internal.firstQuestion,'');
   assert.equal(c.visitors,1);assert.equal(c.activity.knownParticipants,2);
  }
 }
 const legacy=await card.getCardAnalytics.run(request());assert.equal(legacy.conversations.length,1);
});
test('unknown durations, text activity and pending verification are separate from verified seconds',async()=>{
 await verified('unknown-duration',null);
 await platform.capturePlatformUsage('internal:text-only',{boardId,cardId,ownerKey:`user:${owner}`,ownerId:owner,teamId:'',boardTitle:'Museum',cardTitle:'George',mode:'text',internal:true,startedAt:new Date().toISOString(),seconds:null,questions:2,failedAnswers:0});
 await db.doc('card_analytics_voice_sessions/pending-call').set({board_id:boardId,card_id:cardId,issued_at:Timestamp.now(),day:today(),status:'waiting',internal:true});
 const report=await card.getCardAnalytics.run(request({audience:'all'}));
 assert.equal(report.activity.totals.conversations,2);assert.equal(report.activity.totals.voice,1);assert.equal(report.activity.totals.text,1);
 assert.equal(report.activity.totals.seconds,0);assert.equal(report.activity.totals.unknownDurations,1);
 assert.equal(report.pendingVoice,1);assert.equal(report.activity.totals.unattributedConversations,1);
 assert.equal(report.activity.knownParticipants,1);
});
test('UTC date boundaries split verified seconds without counting a conversation twice',async()=>{
 const start=Date.parse(today())-60000;await verified('overnight',120,true,start);
 const range=activity.analyticsRange({from:today(),to:today()});
 const report=await activity.readAnalyticsActivity(boardId,range,'all',cardId);
 assert.equal(report.totals.seconds,60);assert.equal(report.totals.conversations,0);
});
test('reconciliation enriches existing verified calls without fetching or double counting',async()=>{
 await verified('legacy-internal');const original=globalThis.fetch;
 globalThis.fetch=async()=>{throw Error('Existing verified calls must not be fetched again');};
 try{
  for(let i=0;i<2;i++){const result=await card.reconcileBoardAnalytics.run(request());assert.equal(result.recovered,1);}
  const report=await card.getCardAnalytics.run(request({audience:'all'}));assert.equal(report.conversations.length,1);assert.equal(report.activity.totals.seconds,164);
  await assert.rejects(card.reconcileBoardAnalytics.run(request({},'someone-else')),e=>e.code==='permission-denied');
 }finally{globalThis.fetch=original;}
});
test('sharing is owner controlled, aggregate only, uses the saved slug and a hashed capability',async()=>{
 await verified('private-staff-call');
 const result=await shares.manageAnalyticsReportShares.run(request({action:'create',days:7,audience:'all',expiresDays:30}));
 assert.match(result.url,/^https:\/\/livingwiki.com\/reports\/boards\/the-tate-top-20#access=/);
 const token=new URL(result.url).hash.slice('#access='.length);
 assert.equal(result.id,createHash('sha256').update(token).digest('hex'));
 const stored=(await db.doc(`analytics_report_shares/${result.id}`).get()).data();assert(!JSON.stringify(stored).includes(token));
 const read=await shares.getSharedAnalyticsReport.run({data:{token,boardId:'another-board',audience:'visitors'}});
 assert.equal(read.report.totals.seconds,164);assert.equal(read.report.audience,'all');assert.equal(read.report.totals.knownParticipants,1);
 await verified('after-snapshot',50);const unchanged=await shares.getSharedAnalyticsReport.run({data:{token}});assert.equal(unchanged.report.totals.seconds,164,'A shared snapshot must not drift after new calls');
 const listed=await shares.manageAnalyticsReportShares.run(request({action:'list'}));assert.equal(listed.links.length,1);assert.equal(listed.links[0].audience,'all');
 assert(!JSON.stringify(read).includes('Private visitor question'));assert(!JSON.stringify(read).includes('staff-browser'));
 assert(!JSON.stringify(read).includes('Private author instructions'));assert(!JSON.stringify(read).includes('conv_private'));
 await assert.rejects(shares.manageAnalyticsReportShares.run(request({action:'list'},null)),e=>e.code==='unauthenticated');
 for(const action of ['create','list','revoke'])await assert.rejects(shares.manageAnalyticsReportShares.run(request({action,id:result.id},'other-user')),e=>e.code==='permission-denied');
 await shares.manageAnalyticsReportShares.run(request({action:'revoke',id:result.id}));
 await assert.rejects(shares.getSharedAnalyticsReport.run({data:{token}}),e=>e.code==='not-found');
});
test('expired, guessed and ownership-transferred links do not disclose a report',async()=>{
 const result=await shares.manageAnalyticsReportShares.run(request({action:'create',days:30,audience:'visitors'}));
 const token=new URL(result.url).hash.slice('#access='.length);
 await db.doc(`analytics_report_shares/${result.id}`).update({expires_at:Timestamp.fromMillis(Date.now()-1)});
 await assert.rejects(shares.getSharedAnalyticsReport.run({data:{token}}),e=>e.code==='not-found');
 const another=await shares.manageAnalyticsReportShares.run(request({action:'create'}));
 await db.doc(`boards/${boardId}`).update({owner_user_id:'new-owner'});
 await assert.rejects(shares.getSharedAnalyticsReport.run({data:{token:new URL(another.url).hash.slice('#access='.length)}}),e=>e.code==='not-found');
 await assert.rejects(shares.getSharedAnalyticsReport.run({data:{token:'x'.repeat(43)}}),e=>e.code==='not-found');
});
