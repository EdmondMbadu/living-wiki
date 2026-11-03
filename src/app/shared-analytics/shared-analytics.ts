import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Meta, Title } from '@angular/platform-browser';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AnalyticsSharingService, type SharedAnalyticsReport } from '../analytics-sharing.service';
import { analyticsAudiences } from '../analytics-activity';
import { LanguageSwitcherComponent } from '../language-switcher/language-switcher';
import { ThemeToggleComponent } from '../theme-toggle/theme-toggle';

@Component({selector:'app-shared-analytics',imports:[DatePipe,DecimalPipe,ThemeToggleComponent,LanguageSwitcherComponent],templateUrl:'./shared-analytics.html',styleUrl:'./shared-analytics.css'})
export class SharedAnalyticsComponent {
  private readonly api=inject(AnalyticsSharingService);private readonly route=inject(ActivatedRoute);
  private readonly destroy=inject(DestroyRef);private readonly meta=inject(Meta);private readonly title=inject(Title);
  readonly report=signal<SharedAnalyticsReport|null>(null);readonly loading=signal(true);readonly error=signal('');readonly expiresAt=signal('');
  private sequence=0;
  constructor(){this.meta.updateTag({name:'robots',content:'noindex,nofollow'});this.meta.updateTag({name:'referrer',content:'no-referrer'});
    this.route.fragment.pipe(takeUntilDestroyed(this.destroy)).subscribe(fragment=>void this.load(new URLSearchParams(fragment||'').get('access')||''));
    this.destroy.onDestroy(()=>{this.sequence++;this.meta.removeTag('name="robots"');this.meta.removeTag('name="referrer"');});
  }
  private async load(token:string){const sequence=++this.sequence;this.loading.set(true);this.error.set('');this.report.set(null);
    try{if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw Error($localize`This report link has expired or is no longer available.`);
      const result=await this.api.read(token);if(sequence!==this.sequence)return;
      this.report.set(result.report);this.expiresAt.set(result.expiresAt);this.title.setTitle(`${result.report.board.title} · Analytics report | LivingWiki`);
    }catch{if(sequence===this.sequence)this.error.set($localize`This report link has expired or is no longer available.`);}
    finally{if(sequence===this.sequence)this.loading.set(false);}
  }
  audience(){return analyticsAudiences.find(item=>item.value===this.report()?.audience)?.label||'';}
  voiceTime(){const totals=this.report()?.totals;if(!totals)return null;return totals.voice>0&&totals.unknownDurations===totals.voice&&totals.seconds===0?null:totals.seconds/60;}
}
