import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, DestroyRef, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { AuthService } from '../auth.service';
import { CardAnalyticsService, type CardAnalyticsReport, type AnalyticsConversation, type AnalyticsTurn } from '../card-analytics.service';
import { WorkspaceSidebarComponent } from '../workspace-sidebar/workspace-sidebar';
import { MobileMenuComponent } from '../mobile-menu/mobile-menu';
import { ThemeToggleComponent } from '../theme-toggle/theme-toggle';

export function analyticsDuration(seconds: number | null): string {
  if (seconds === null) return $localize`Not recorded`;
  if (seconds < 1) return '<1s';
  const rounded = Math.round(seconds);
  return rounded >= 60 ? `${Math.floor(rounded / 60)}m ${rounded % 60}s` : `${rounded}s`;
}
export function analyticsCsv(rows: unknown[][]): string {
  return '\uFEFF' + rows.map(row => row.map(value => {
    const s = String(value ?? '');
    return '"' + (/^[\s]*[=+\-@]/.test(s) ? "'" + s : s).replace(/"/g, '""') + '"';
  }).join(',')).join('\r\n');
}
@Component({
  selector: 'app-card-analytics',
  imports: [DatePipe, DecimalPipe, RouterLink, WorkspaceSidebarComponent, MobileMenuComponent, ThemeToggleComponent],
  templateUrl: './card-analytics.html', styleUrl: './card-analytics.css',
})
export class CardAnalyticsComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);
  private readonly api = inject(CardAnalyticsService);
  private readonly title = inject(Title);
  private readonly destroyRef = inject(DestroyRef);
  readonly drawer = viewChild<ElementRef<HTMLDialogElement>>('drawer');
  readonly boardId = signal(''); readonly cardId = signal(''); readonly days = signal(30);
  readonly report = signal<CardAnalyticsReport | null>(null);
  readonly loading = signal(true); readonly refreshing = signal(false); readonly error = signal('');
  readonly query = signal(''); readonly mode = signal('all'); readonly oldest = signal(false);
  readonly page = signal(1); readonly pageSize = 25;
  readonly selected = signal<AnalyticsConversation | null>(null); readonly turns = signal<AnalyticsTurn[]>([]);
  readonly detailLoading = signal(false); readonly detailError = signal(''); readonly cursor = signal<string | null>(null);
  readonly downloading = signal(false);
  readonly rangeOptions = [{ days:7,label:$localize`7 days` },{ days:30,label:$localize`30 days` },{ days:90,label:$localize`90 days` }];
  readonly modeOptions = [{value:'all',label:$localize`All`},{value:'text',label:$localize`Text`},{value:'voice',label:$localize`Voice`}];
  readonly boardPath = computed(() => ['/boards', this.boardId()]);
  readonly boardAnalyticsPath = computed(() => ['/manage/boards',this.boardId(),'analytics']);
  readonly qaPath = computed(() => ['/manage/boards',this.boardId(),'cards',this.cardId(),'qa']);
  readonly rows = computed(() => {
    const q = this.query().trim().toLocaleLowerCase();
    const rows = (this.report()?.conversations ?? []).filter(c => (this.mode() === 'all' || c.mode === this.mode()) && (!q || `${c.firstQuestion} ${c.visitor}`.toLocaleLowerCase().includes(q)));
    return this.oldest() ? rows.slice().reverse() : rows;
  });
  readonly shownRows = computed(() => this.rows().slice((this.page()-1)*this.pageSize,this.page()*this.pageSize));
  readonly pages = computed(() => Math.max(1, Math.ceil(this.rows().length / this.pageSize)));
  readonly textCount = computed(() => this.report()?.conversations.filter(c => c.mode === 'text').length ?? 0);
  readonly voiceCount = computed(() => this.report()?.conversations.filter(c => c.mode === 'voice').length ?? 0);
  readonly visitorCountUnavailable = computed(() => {
    const report = this.report();
    return !!report && report.opens > 0 && report.visitors === 0;
  });
  readonly chatRate = computed(() => { const r = this.report(); return r?.visitors ? (r.visitorsWhoChatted/r.visitors)*100 : 0; });
  readonly average = computed(() => {
    const rows = this.report()?.conversations.filter(c=>c.durationSeconds !== null) ?? [];
    return rows.length ? rows.reduce((n,c)=>n+c.durationSeconds!,0)/rows.length : null;
  });
  readonly trend = computed(() => {
    const report = this.report(); if (!report) return [];
    const counts = new Map<string, number>(); report.conversations.forEach(c=>{const d=c.startedAt.slice(0,10);counts.set(d,(counts.get(d)||0)+1);});
    return Array.from({length:report.range.days},(_,i)=>{const day=new Date(Date.parse(report.range.from+'T00:00:00Z')+i*86400000).toISOString().slice(0,10);return {day,count:counts.get(day)||0};});
  });
  readonly maxTrend = computed(()=>Math.max(1,...this.trend().map(d=>d.count)));
  readonly needsAttention = computed(()=>this.report()?.conversations.filter(c=>c.knowledgeGaps || c.failedAnswers) ?? []);
  readonly duration = analyticsDuration;
  private loadSequence=0; private detailSequence=0;
  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(p=>{
      this.closeDetails(); this.boardId.set(p.get('boardId')||''); this.cardId.set(p.get('cardId')||'');
      this.report.set(null); void this.load();
    });
  }
  async load(): Promise<void> {
    const sequence=++this.loadSequence; this.report() ? this.refreshing.set(true) : this.loading.set(true); this.error.set('');
    try { await this.auth.waitForReady(); const data=await this.api.report(this.boardId(),this.cardId(),this.days());
      if(sequence!==this.loadSequence)return; this.report.set(data);this.page.set(1);this.title.setTitle(`${data.card.title} · Card analytics | LivingWiki`);
    } catch(e){if(sequence===this.loadSequence)this.error.set(this.friendlyError(e));}
    finally{if(sequence===this.loadSequence){this.loading.set(false);this.refreshing.set(false);}}
  }
  selectRange(days:number):void {if(days===this.days())return;this.closeDetails();this.days.set(days);this.report.set(null);void this.load();}
  setQuery(value:string):void{this.query.set(value);this.page.set(1);}
  setMode(value:string):void{this.mode.set(value);this.page.set(1);}
  label(mode:string):string{return mode==='voice'?$localize`Voice`:$localize`Text`;}
  status(value:string):string{return ({active:$localize`Active`,completed:$localize`Completed`,interrupted:$localize`Interrupted`})[value]||value;}
  async openDetails(row:AnalyticsConversation):Promise<void>{
    if(!this.report()?.canReadTranscripts || row.canReadTranscript===false)return;
    this.selected.set(row);this.turns.set([]);this.cursor.set(null);this.drawer()?.nativeElement.showModal();await this.loadDetails();
  }
  async loadDetails(more=false):Promise<void>{
    const selected=this.selected();if(!selected)return;
    const sequence=++this.detailSequence;this.detailLoading.set(true);this.detailError.set('');
    try{const result=await this.api.conversation(this.boardId(),this.cardId(),selected.id,more?this.cursor():null);
      if(sequence!==this.detailSequence)return;
      this.selected.set(result.conversation);this.turns.update(old=>more?[...old,...result.turns]:result.turns);this.cursor.set(result.nextCursor);
    }catch(e){if(sequence===this.detailSequence)this.detailError.set(this.friendlyError(e));}
    finally{if(sequence===this.detailSequence)this.detailLoading.set(false);}
  }
  closeDetails():void{++this.detailSequence;this.drawer()?.nativeElement.close();this.selected.set(null);this.detailLoading.set(false);this.detailError.set('');}
  downloadCsv():void{
    const rows=this.rows(); const headings=[$localize`Started (UTC)`,$localize`Visitor`,$localize`Mode`,$localize`Duration (seconds)`,$localize`Duration type`,$localize`Questions`,$localize`Status`,$localize`First question`];
    this.download(`card-analytics-${this.cardId()}-${this.days()}days.csv`,analyticsCsv([headings,...rows.map(c=>[c.startedAt,c.visitor,c.mode,c.durationSeconds,c.durationKind,c.questions,c.status,c.firstQuestion])]),'text/csv;charset=utf-8');
  }
  async downloadTranscript():Promise<void>{
    const row=this.selected();if(!row||this.downloading())return;this.downloading.set(true);
    try { let cursor:string|null=null;const turns:AnalyticsTurn[]=[];
      do{const page=await this.api.conversation(this.boardId(),this.cardId(),row.id,cursor);turns.push(...page.turns);cursor=page.nextCursor;}while(cursor);
      this.download(`conversation-${row.id}.txt`,`${row.visitor}\n${row.startedAt} (UTC)\n${this.label(row.mode)} · ${this.duration(row.durationSeconds)}\n\n`+turns.map(t=>`${t.at} ${t.role==='user'?$localize`Visitor`:$localize`Avatar`}\n${t.text}`).join('\n\n'),'text/plain;charset=utf-8');
    }catch(e){this.detailError.set(this.friendlyError(e));}finally{this.downloading.set(false);}
  }
  private download(name:string,content:string,type:string):void{const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  private friendlyError(error:unknown):string{return error instanceof Error?error.message.replace(/^FirebaseError:\s*/,''):$localize`Analytics could not be loaded. Please try again.`;}
}
