import { analyticsAudiences, type AnalyticsAudience } from '../analytics-activity';
import { AnalyticsReportSharingComponent } from '../analytics-report-sharing/analytics-report-sharing';
import { AnalyticsSharingService } from '../analytics-sharing.service';
import { getPublicAppUrl } from '../firebase.config';
import { DatePipe, DecimalPipe, isPlatformBrowser } from '@angular/common';
import { Component, DestroyRef, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../auth.service';
import {
  BoardAnalyticsService,
  buildTrackedBoardUrl,
  type BoardInsights,
  type BoardInsightsRange,
} from '../board-analytics.service';
import { ThemeToggleComponent } from '../theme-toggle/theme-toggle';
import { WorkspaceSidebarComponent } from '../workspace-sidebar/workspace-sidebar';
import { MobileMenuComponent } from '../mobile-menu/mobile-menu';

type TrackingSourceOption = {
  value: string;
  label: string;
  description: string;
};

@Component({
  selector: 'app-board-insights',
  imports: [RouterLink, DatePipe, DecimalPipe, ThemeToggleComponent, WorkspaceSidebarComponent, MobileMenuComponent, AnalyticsReportSharingComponent],
  templateUrl: './board-insights.html',
  styleUrl: './board-insights.css',
})
export class BoardInsightsComponent {
  readonly copyBoardLabel=$localize`Copy board URL`;
  readonly templateText = {
    message1: $localize`Copied to clipboard`,
    message2: $localize`Copy tracked link`,
    message3: $localize`view`,
    message4: $localize`views`,
    message5: $localize` views, `,
    message6: $localize` unique visitors, `,
    message7: $localize` engaged visits`,
  };
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly authService = inject(AuthService);
  private readonly analytics = inject(BoardAnalyticsService);
  private readonly title = inject(Title);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private readonly sharing = inject(AnalyticsSharingService);
  readonly audience=signal<AnalyticsAudience>('all');
  readonly audiences=analyticsAudiences;
  readonly recovering=signal(false);readonly recoveryNotice=signal('');readonly boardLinkCopied=signal(false);
  readonly boardId = signal('');
  readonly range = signal<BoardInsightsRange>(30);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly insights = signal<BoardInsights | null>(null);
  readonly source = signal('facebook');
  readonly campaign = signal('');
  readonly copied = signal(false);
  readonly copyError = signal('');
  readonly rangeOptions: Array<{ days: BoardInsightsRange; label: string }> = [
    { days: 7, label: $localize`7 days` },
    { days: 30, label: $localize`30 days` },
    { days: 90, label: $localize`90 days` },
  ];
  readonly trackingSources: TrackingSourceOption[] = [
    { value: 'facebook', label: $localize`Facebook`, description: $localize`Posts, pages, and groups` },
    { value: 'instagram', label: $localize`Instagram`, description: $localize`Bio, story, and direct shares` },
    { value: 'email', label: $localize`Email newsletter`, description: $localize`Campaigns and personal email` },
    { value: 'linkedin', label: $localize`LinkedIn`, description: $localize`Posts and organization pages` },
    { value: 'x-twitter', label: $localize`X / Twitter`, description: $localize`Posts and direct shares` },
    { value: 'whatsapp', label: $localize`Text / WhatsApp`, description: $localize`Messages and group chats` },
    { value: 'qr-code', label: $localize`QR code`, description: $localize`Print, signs, and in-person sharing` },
    { value: 'partner-website', label: $localize`Partner website`, description: $localize`Links from another site` },
    { value: 'other', label: $localize`Other`, description: $localize`Any channel not listed above` },
  ];

  readonly publicPath = computed(() => {
    const board = this.insights()?.board;
    return board ? `/boards/${encodeURIComponent(board.customSlug || board.id)}` : '/boards';
  });
  readonly publicUrl = computed(() => {
    if (!this.isBrowser) return this.publicPath();
    return `${getPublicAppUrl() || window.location.origin}${this.publicPath()}`;
  });
  readonly trackedUrl = computed(() => {
    const base = this.publicUrl();
    if (!base) return '';
    return buildTrackedBoardUrl(base, this.source(), this.campaign() || this.insights()?.board.title || 'board-share');
  });
  readonly selectedTrackingSource = computed(() =>
    this.trackingSources.find((option) => option.value === this.source()) ?? this.trackingSources[0]);
  readonly trackedParameters = computed(() => {
    try {
      const url = new URL(this.trackedUrl(), this.isBrowser ? window.location.origin : 'https://www.livingwiki.com');
      return [
        { label: $localize`Source`, value: url.searchParams.get('utm_source') ?? '' },
        { label: $localize`Medium`, value: url.searchParams.get('utm_medium') ?? '' },
        { label: $localize`Campaign`, value: url.searchParams.get('utm_campaign') ?? '' },
      ];
    } catch {
      return [];
    }
  });
  readonly clickThroughRate = computed(() => {
    const totals = this.insights()?.totals;
    return totals?.views ? (totals.outboundClicks / totals.views) * 100 : 0;
  });
  readonly engagementRate = computed(() => {
    const totals = this.insights()?.totals;
    return totals?.views ? (totals.engagedVisits / totals.views) * 100 : 0;
  });
  readonly verifiedMinutes=computed(()=>{
    const totals=this.insights()?.activity?.totals;
    return totals&&totals.voice>0&&totals.unknownDurations===totals.voice&&!totals.seconds?null:(totals?.seconds||0)/60;
  });
  readonly maxDailyViews = computed(() => Math.max(1, ...((this.insights()?.daily ?? []).map((day) => day.views))));
  readonly dailyAxisMax = computed(() => this.niceAxisMaximum(this.maxDailyViews()));
  readonly dailyYAxisTicks = computed(() => {
    const maximum = this.dailyAxisMax();
    return Array.from({ length: 5 }, (_, index) => maximum - ((maximum / 4) * index));
  });
  readonly maxSourceViews = computed(() => Math.max(1, ...((this.insights()?.sources ?? []).map((source) => source.views))));
  readonly maxCampaignViews = computed(() => Math.max(1, ...((this.insights()?.campaigns ?? []).map((campaign) => campaign.views))));
  readonly trackedCampaignViews = computed(() =>
    (this.insights()?.campaigns ?? []).reduce((total, campaign) => total + campaign.views, 0));
  private loadSequence = 0;

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const boardId = params.get('boardId')?.trim() ?? '';
      this.boardId.set(boardId);
      void this.load();
    });
  }

  selectAudience(value:AnalyticsAudience):void{this.audience.set(value);void this.load();}
  async copyBoardLink(){try{await navigator.clipboard.writeText(this.publicUrl());this.boardLinkCopied.set(true);}catch{this.copyError.set($localize`Copy the board URL shown above.`);}}
  async reconcile(){if(this.recovering())return;this.recovering.set(true);this.recoveryNotice.set('');
    let cursor:string|null=null,processed=0,unavailable=0;
    try{do{const result=await this.sharing.reconcile(this.boardId(),cursor);processed+=result.processed;unavailable+=result.unavailable;cursor=result.nextCursor;}while(cursor);
      this.recoveryNotice.set($localize`Checked ${processed}:PROCESSED: voice sessions; ${unavailable}:UNAVAILABLE: could not be verified. Unknown history has not been estimated.`);await this.load();
    }catch(e){this.recoveryNotice.set(this.errorMessage(e));}finally{this.recovering.set(false);}}
  selectRange(days: BoardInsightsRange): void {
    if (this.range() === days) return;
    this.range.set(days);
    void this.load();
  }

  setSource(value: string): void {
    this.source.set(value);
    this.copied.set(false);
    this.copyError.set('');
  }

  setCampaign(value: string): void {
    this.campaign.set(value);
    this.copied.set(false);
    this.copyError.set('');
  }

  async copyTrackedLink(): Promise<void> {
    if (!this.isBrowser || !this.trackedUrl()) return;
    const url = this.trackedUrl();
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        copied = true;
      }
    } catch {
      copied = false;
    }
    if (!copied) copied = this.copyWithSelection(url);
    this.copied.set(copied);
    this.copyError.set(copied ? '' : $localize`Copy was blocked. Select the tracked URL and copy it manually.`);
  }

  private copyWithSelection(value: string): boolean {
    try {
      const input = document.createElement('textarea');
      input.value = value;
      input.setAttribute('readonly', '');
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.appendChild(input);
      input.select();
      const copied = document.execCommand('copy');
      input.remove();
      return copied;
    } catch {
      return false;
    }
  }

  dailyBarHeight(views: number): number {
    if (!views) return 0;
    return Math.max(2, (views / this.dailyAxisMax()) * 100);
  }

  sourceBarWidth(views: number): number {
    return Math.max(2, Math.round((views / this.maxSourceViews()) * 100));
  }

  campaignBarWidth(views: number): number {
    return Math.max(2, Math.round((views / this.maxCampaignViews()) * 100));
  }

  sourceShare(views: number): number {
    const total = this.insights()?.totals.views ?? 0;
    return total ? (views / total) * 100 : 0;
  }

  campaignShare(views: number): number {
    const total = this.trackedCampaignViews();
    return total ? (views / total) * 100 : 0;
  }

  showDailyLabel(index: number, total: number): boolean {
    if (total <= 7 || index === 0 || index === total - 1) return true;
    return index % (total <= 30 ? 7 : 15) === 0;
  }

  formatAxisValue(value: number): string {
    return new Intl.NumberFormat(undefined, {
      notation: value >= 1_000 ? 'compact' : 'standard',
      maximumFractionDigits: value >= 1_000 ? 1 : 0,
    }).format(value);
  }

  sourceLabel(value: string): string {
    const labels: Record<string, string> = {
      direct: 'Direct',
      facebook: 'Facebook',
      instagram: 'Instagram',
      linkedin: 'LinkedIn',
      'x-twitter': 'X / Twitter',
      whatsapp: 'Text / WhatsApp',
      'qr-code': 'QR code',
      'partner-website': 'Partner website',
      google: 'Search',
      livingwiki: 'LivingWiki',
      email: 'Email',
      other: 'Other referrals',
    };
    return labels[value] || value.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  campaignLabel(value: string): string {
    return value.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  private niceAxisMaximum(value: number): number {
    const roughStep = Math.max(1, value / 4);
    const magnitude = 10 ** Math.floor(Math.log10(roughStep));
    const normalizedStep = roughStep / magnitude;
    const niceStep = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]
      .find((candidate) => candidate >= normalizedStep) ?? 10;
    return niceStep * magnitude * 4;
  }

  private async load(): Promise<void> {
    const loadSequence = ++this.loadSequence;
    const boardId = this.boardId();
    if (!boardId) {
      this.loading.set(false);
      this.error.set($localize`Choose a board to view its insights.`);
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    try {
      await this.authService.waitForReady();
      const insights = await this.analytics.getInsights(boardId, this.range(), this.audience());
      if (loadSequence !== this.loadSequence) return;
      this.insights.set(insights);
      if (!this.campaign()) this.campaign.set(`${insights.board.title} launch`);
      this.title.setTitle(`${insights.board.title} Analytics | LivingWiki`);
    } catch (error) {
      if (loadSequence !== this.loadSequence) return;
      this.insights.set(null);
      this.error.set(this.errorMessage(error));
    } finally {
      if (loadSequence === this.loadSequence) this.loading.set(false);
    }
  }

  private errorMessage(error: unknown): string {
    const message = error && typeof error === 'object' && 'message' in error
      ? String((error as { message?: unknown }).message ?? '')
      : '';
    if (/permission|owner/i.test(message)) return 'Only this board’s owner can view its insights.';
    if (/not.?found/i.test(message)) return 'This board could not be found.';
    return message.replace(/^FirebaseError:\s*/i, '') || 'Board insights could not be loaded. Try again.';
  }
}
