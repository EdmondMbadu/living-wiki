import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { AuthService } from '../auth.service';
import { AtlasService } from '../atlas.service';
import { TeamsService } from '../teams/teams.service';
import { teamsServiceStub } from '../teams/teams.testing';
import { CardAnalyticsService, type CardAnalyticsReport } from '../card-analytics.service';
import { CardAnalyticsComponent, analyticsCsv, analyticsDuration } from './card-analytics';
const report:CardAnalyticsReport={board:{id:'board1',title:'History board'},card:{id:'card1',title:'George Washington',talking:true},range:{days:30,from:'2026-10-01',to:'2026-10-30'},trackingStartedAt:null,canViewBoardAnalytics:true,canReadTranscripts:true,visitors:10,visitorsWhoChatted:2,opens:12,outboundClicks:1,pendingVoice:0,conversations:[
 {id:'new',mode:'voice',startedAt:'2026-10-28T12:00:00Z',visitor:'Visitor abc',durationSeconds:120,durationKind:'recorded',status:'completed',questions:3,knowledgeGaps:0,failedAnswers:0,firstQuestion:'How was Mount Vernon?'},
 {id:'old',mode:'text',startedAt:'2026-10-27T11:00:00Z',visitor:'Visitor def',durationSeconds:60,durationKind:'estimated',status:'completed',questions:2,knowledgeGaps:1,failedAnswers:0,firstQuestion:'Who was Lafayette?'},
]};
describe('CardAnalyticsComponent',()=>{
 let params:BehaviorSubject<ReturnType<typeof convertToParamMap>>;
 const api={report:jasmine.createSpy('report'),conversation:jasmine.createSpy('conversation')};
 beforeEach(async()=>{
  params=new BehaviorSubject(convertToParamMap({boardId:'board1',cardId:'card1'}));api.report.calls.reset();api.conversation.calls.reset();api.report.and.resolveTo(structuredClone(report));
  await TestBed.configureTestingModule({imports:[CardAnalyticsComponent],providers:[provideZonelessChangeDetection(),provideRouter([]),
   {provide:ActivatedRoute,useValue:{paramMap:params}}, {provide:CardAnalyticsService,useValue:api},
   {provide:TeamsService,useFactory:teamsServiceStub},
   {provide:AuthService,useValue:{waitForReady:async()=>{},uid:signal('owner'),profile:signal({preferredCitySlug:'philly'}),isAuthenticated:signal(true),signOut:async()=>{}}},
   {provide:AtlasService,useValue:{activeAtlasWikiLink:signal('/wiki/philly')}},
  ]}).compileComponents();
 });
 async function render(){const f=TestBed.createComponent(CardAnalyticsComponent);f.detectChanges();await f.componentInstance.load();f.detectChanges();return f;}
 it('uses the card visitor denominator and real mode totals',async()=>{
  const f=await render();expect(api.report).toHaveBeenCalledWith('board1','card1',30);expect(f.componentInstance.chatRate()).toBe(20);expect(f.componentInstance.average()).toBe(90);
  expect(f.nativeElement.textContent).toContain('20% of this card’s visitors');expect(f.nativeElement.textContent).toContain('1 text · 1 voice');expect(f.nativeElement.textContent).toContain('Activity for this card only');f.destroy();
 });
 it('filters by mode and question, sorts dates and resets pagination',async()=>{
  const f=await render(),c=f.componentInstance;c.setMode('text');expect(c.rows().map(r=>r.id)).toEqual(['old']);c.setMode('all');c.setQuery('Mount Vernon');expect(c.rows().map(r=>r.id)).toEqual(['new']);c.setQuery('');c.oldest.set(true);expect(c.rows().map(r=>r.id)).toEqual(['old','new']);f.destroy();
 });
 it('shows honest empty states with no sample data or invented duration',async()=>{
  api.report.and.resolveTo({...report,conversations:[],visitors:0,visitorsWhoChatted:0,opens:0});const f=await render();expect(f.componentInstance.average()).toBeNull();expect(f.nativeElement.textContent).toContain('No conversations recorded yet');expect(f.nativeElement.textContent).toContain('Not recorded');f.destroy();
 });
 it('uses interaction-only metrics for an ordinary card',async()=>{
  api.report.and.resolveTo({...report,card:{...report.card,talking:false},conversations:[]});const f=await render();expect(f.nativeElement.textContent).toContain('Outbound clicks');expect(f.nativeElement.querySelector('.conversation-panel')).toBeNull();f.destroy();
 });
 it('loads a paginated transcript and safely renders all text',async()=>{
  api.conversation.and.resolveTo({conversation:report.conversations[0],turns:[{id:'q',role:'user',text:'<script>alert(1)</script>',at:'2026-10-28T12:00:00Z',status:'answered'}],nextCursor:'page2'});
  const f=await render(),c=f.componentInstance;await c.openDetails(report.conversations[0]);f.detectChanges();expect(f.nativeElement.querySelector('dialog').open).toBeTrue();expect(f.nativeElement.querySelector('.transcript script')).toBeNull();expect(f.nativeElement.querySelector('.transcript').textContent).toContain('<script>');
  api.conversation.and.resolveTo({conversation:report.conversations[0],turns:[{id:'a',role:'assistant',text:'Recorded answer',at:'2026-10-28T12:00:01Z',status:'answered'}],nextCursor:null});await c.loadDetails(true);expect(c.turns().length).toBe(2);expect(api.conversation).toHaveBeenCalledWith('board1','card1','new','page2');c.closeDetails();expect(f.nativeElement.querySelector('dialog').open).toBeFalse();f.destroy();
 });
 it('discards a late transcript result after the drawer closes',async()=>{
  let resolve!:(x:unknown)=>void;api.conversation.and.returnValue(new Promise(r=>resolve=r));const f=await render(),c=f.componentInstance;const pending=c.openDetails(report.conversations[0]);c.closeDetails();resolve({conversation:report.conversations[0],turns:[{id:'stale'}],nextCursor:null});await pending;expect(c.selected()).toBeNull();expect(c.turns()).toEqual([]);f.destroy();
 });
 it('does not request transcripts for a board owner without avatar permission',async()=>{
  api.report.and.resolveTo({...report,canReadTranscripts:false,conversations:report.conversations.map(c=>({...c,firstQuestion:''}))});const f=await render();await f.componentInstance.openDetails(report.conversations[0]);expect(api.conversation).not.toHaveBeenCalled();expect(f.nativeElement.textContent).toContain('Only this avatar’s administrators');f.destroy();
 });
 it('rejects stale report responses after navigation to another card',async()=>{
  const f=await render();let resolve!:(x:unknown)=>void;api.report.and.returnValue(new Promise(r=>resolve=r));const oldLoad=f.componentInstance.load();api.report.and.resolveTo({...report,card:{...report.card,id:'card2',title:'Second card'}});params.next(convertToParamMap({boardId:'board1',cardId:'card2'}));await f.componentInstance.load();resolve(report);await oldLoad;expect(f.componentInstance.report()?.card.title).toBe('Second card');f.destroy();
 });
});
describe('analytics exports',()=>{
 it('preserves CSV quotes, newlines, UTC dates and neutralizes spreadsheet formula injection',()=>{const s=analyticsCsv([['=SUM(1,2)','He said "hello"','two\nlines',null]]);expect(s).toContain('"\'=SUM(1,2)"');expect(s).toContain('"He said ""hello"""');expect(s).toContain('"two\nlines"');});
 it('does not turn missing duration into zero',()=>{expect(analyticsDuration(null)).toBe('Not recorded');expect(analyticsDuration(0)).toBe('<1s');expect(analyticsDuration(83)).toBe('1m 23s');});
});
