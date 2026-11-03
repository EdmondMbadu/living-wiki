import { DatePipe } from '@angular/common';
import { Component, ElementRef, inject, input, signal, viewChild } from '@angular/core';
import { AnalyticsSharingService, type AnalyticsReportLink } from '../analytics-sharing.service';
import { analyticsAudiences, type AnalyticsAudience } from '../analytics-activity';

@Component({selector:'app-analytics-report-sharing',imports:[DatePipe],templateUrl:'./analytics-report-sharing.html',styleUrl:'./analytics-report-sharing.css'})
export class AnalyticsReportSharingComponent {
  readonly copyLabel=$localize`Copy report link`;readonly copiedLabel=$localize`Copied to clipboard`;
  audienceLabel(value:AnalyticsAudience=this.audience()){return analyticsAudiences.find(item=>item.value===value)?.label||'';}
  readonly boardId=input.required<string>(); readonly days=input.required<number>(); readonly audience=input.required<AnalyticsAudience>();
  readonly from=input('');readonly to=input('');
  private readonly api=inject(AnalyticsSharingService);
  readonly dialog=viewChild<ElementRef<HTMLDialogElement>>('dialog');
  readonly links=signal<AnalyticsReportLink[]>([]);readonly busy=signal(false);readonly loading=signal(false);
  readonly error=signal('');readonly expiresDays=signal(30);readonly url=signal('');readonly previewPath=signal('');readonly copied=signal(false);
  async open(){this.error.set('');this.url.set('');this.previewPath.set('');this.copied.set(false);this.dialog()?.nativeElement.showModal();await this.load();}
  close(){if(!this.busy())this.dialog()?.nativeElement.close();}
  private async load(){this.loading.set(true);try{this.links.set((await this.api.list(this.boardId())).links);}catch(e){this.error.set(this.message(e));}finally{this.loading.set(false);}}
  async create(){if(this.busy())return;this.busy.set(true);this.error.set('');try{
    const result=await this.api.create(this.boardId(),this.days(),this.audience(),this.expiresDays(),this.from(),this.to());
    this.url.set(result.url);this.previewPath.set(result.path);this.copied.set(false);await this.load();
  }catch(e){this.error.set(this.message(e));}finally{this.busy.set(false);}}
  async revoke(id:string){if(this.busy())return;this.busy.set(true);this.error.set('');try{
    await this.api.revoke(this.boardId(),id);this.links.update(rows=>rows.map(row=>row.id===id?{...row,revoked:true}:row));
    this.url.set('');this.previewPath.set('');
  }catch(e){this.error.set(this.message(e));}finally{this.busy.set(false);}}
  async copy(){try{await navigator.clipboard.writeText(this.url());this.copied.set(true);}catch{this.error.set($localize`Copy the report link from the field below.`);}}
  expired(value:string){return Date.parse(value)<=Date.now();}
  private message(e:unknown){return e instanceof Error?e.message:$localize`Report sharing is unavailable. Please try again.`;}
}
