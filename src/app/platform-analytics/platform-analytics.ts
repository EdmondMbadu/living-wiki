import { analyticsAudiences, type AnalyticsAudience } from '../analytics-activity';
import { PicamoAnalyticsComponent } from './picamo-analytics';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, DestroyRef, LOCALE_ID, computed, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { AuthService } from '../auth.service';
import {
  PlatformAnalyticsService,
  type PlatformReport,
  type PlatformFilters,
  type PlatformRow,
} from '../platform-analytics.service';
import { ThemeToggleComponent } from '../theme-toggle/theme-toggle';
import { AccountMenuComponent } from '../account-menu/account-menu';

const DAY_MS = 86_400_000;

function utcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

type VoiceUsage = { seconds: number | null; partial: boolean };

export function platformVoiceTime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return $localize`Not recorded`;
  if (seconds > 0 && seconds < 60)
    return $localize`${Math.max(1, Math.round(seconds))}:SECONDS: sec`;
  return $localize`${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(seconds / 60)}:MINUTES: min`;
}
export function platformCsv(rows: unknown[][]): string {
  return (
    '\uFEFF' +
    rows
      .map((row) =>
        row
          .map((v) => {
            const s = String(v ?? '');
            return '"' + (/^[\s]*[=+\-@]/.test(s) ? "'" + s : s).replace(/"/g, '""') + '"';
          })
          .join(','),
      )
      .join('\r\n')
  );
}
@Component({
  selector: 'app-platform-analytics',
  imports: [RouterLink, DatePipe, DecimalPipe, ThemeToggleComponent, AccountMenuComponent, PicamoAnalyticsComponent],
  templateUrl: './platform-analytics.html',
  styleUrl: './platform-analytics.css',
})
export class PlatformAnalyticsComponent {
  private readonly api = inject(PlatformAnalyticsService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly title = inject(Title);
  private readonly destroyRef = inject(DestroyRef);
  private readonly locale = inject(LOCALE_ID);
  private readonly dateFormat = new Intl.DateTimeFormat(this.locale, {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  private readonly monthFormat = new Intl.DateTimeFormat(this.locale, {
    timeZone: 'UTC',
    month: 'short',
  });
  private readonly now = new Date();
  readonly today = utcDate(this.now);
  readonly monthStart = this.today.slice(0, 7) + '-01';
  private readonly twelveMonthsStart = utcDate(
    new Date(Date.UTC(this.now.getUTCFullYear(), this.now.getUTCMonth() - 11, 1)),
  );
  private readonly appliedDates = signal({ from: this.twelveMonthsStart, to: this.today });
  readonly tab = signal('overview');
  readonly picamoPanel = viewChild(PicamoAnalyticsComponent);
  readonly report = signal<PlatformReport | null>(null);
  readonly loading = signal(true);
  readonly refreshing = signal(false);
  readonly error = signal('');
  readonly exporting = signal(false);
  readonly syncing = signal(false);
  readonly from = signal(this.twelveMonthsStart);
  readonly to = signal(this.today);
  readonly group = signal('month');
  readonly monthUsage = signal<VoiceUsage | null>(null);
  readonly monthDates = this.dateRange(this.monthStart, this.today);
  readonly internal = signal(true);
  readonly audience = signal<AnalyticsAudience>('all');
  readonly audiences = analyticsAudiences;
  readonly view = signal('cards');
  readonly search = signal('');
  readonly page = signal(1);
  readonly preset = signal('365');
  readonly groups = [
    { value: 'day', label: $localize`Day` },
    { value: 'month', label: $localize`Month` },
    { value: 'year', label: $localize`Year` },
  ];
  readonly views = [
    { value: 'users', label: $localize`By owner` },
    { value: 'boards', label: $localize`By board` },
    { value: 'cards', label: $localize`By talking card` },
  ];
  readonly filters = computed<PlatformFilters>(() => ({
    ...this.appliedDates(),
    group: this.group(),
    includeInternal: this.internal(),
    audience:this.audience(),
    view: this.view(),
    search: this.search(),
    page: this.page(),
  }));
  readonly totals = computed(() => this.report()?.totals);
  readonly periodDates = computed(() => {
    const range = this.report()?.range;
    return range ? this.dateRange(range.from, range.to) : '';
  });
  readonly rows = computed(() => this.report()?.breakdown?.rows || []);
  readonly series = computed(() => this.report()?.series || []);
  readonly creationSeries = computed(() => this.report()?.boardCreation?.series || []);
  readonly creationAxisMax = computed(() => {
    const max = Math.max(1, ...this.creationSeries().map((row) => row.boards));
    const step = 10 ** Math.floor(Math.log10(max));
    return Math.ceil(max / step) * step;
  });
  readonly creationTicks = computed(() => [
    ...new Set([this.creationAxisMax(), Math.floor(this.creationAxisMax() / 2), 0]),
  ]);
  readonly axisMax = computed(() => {
    const interval = Math.max(0.25, ...this.series().map((row) => row.seconds / 240));
    const scale = 10 ** Math.floor(Math.log10(interval));
    const step = [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10].find((value) => value * scale >= interval)!;
    return 4 * step * scale;
  });
  readonly ticks = computed(() =>
    Array.from({ length: 5 }, (_, i) => (this.axisMax() * (4 - i)) / 4),
  );
  readonly pages = computed(() =>
    Math.max(1, Math.ceil((this.report()?.breakdown?.total || 0) / 25)),
  );
  readonly unavailable = computed(() => this.report()?.coverage?.unrecorded === true);
  readonly time = platformVoiceTime;
  voiceSeconds(
    row: { seconds?: number; voice?: number; unknownDurations?: number } | null | undefined,
    recorded = !this.unavailable(),
  ): number | null {
    if (!recorded || !row) return null;
    return row.voice && row.voice === row.unknownDurations && !row.seconds
      ? null
      : (row.seconds ?? 0);
  }
  private sequence = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  constructor() {
    const view = this.route.snapshot?.queryParamMap?.get('view');
    if (view && ['users', 'boards', 'cards'].includes(view)) this.view.set(view);
    this.title.setTitle($localize`Platform analytics | LivingWiki`);
    this.destroyRef.onDestroy(() => {
      this.disposed = true;
      ++this.sequence;
      if (this.timer) clearTimeout(this.timer);
      if (this.searchTimer) clearTimeout(this.searchTimer);
    });
    this.tab.set(this.route.snapshot?.queryParamMap?.get('tab') === 'picamo' ? 'picamo' : 'overview');
    if (this.tab() === 'overview') void this.load(); else this.loading.set(false);
    this.route.queryParamMap?.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      const tab = params.get('tab') === 'picamo' ? 'picamo' : 'overview';
      if (tab === this.tab()) return;
      this.tab.set(tab);
      if (tab === 'overview' && !this.report()) void this.load();
    });
  }
  refreshCurrent(): void { if (this.tab() === 'picamo') void this.picamoPanel()?.load(true); else void this.load(true); }
  exportCurrent(): void { if (this.tab() === 'picamo') void this.picamoPanel()?.exportCsv(); else void this.exportCsv(); }
  async load(refresh = false): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    const seq = ++this.sequence;
    if (this.report()) this.refreshing.set(true);
    else this.loading.set(true);
    this.error.set('');
    const filters = this.filters();
    try {
      await this.auth.waitForReady();
      if (this.disposed || seq !== this.sequence) return;
      const coversMonth = filters.from <= this.monthStart && filters.to === this.today;
      const exactMonth = coversMonth && filters.from === this.monthStart;
      const needsMonthReport = !coversMonth || (filters.group === 'year' && !exactMonth);
      const [report, monthReport] = await Promise.all([
        this.api.report(filters, refresh),
        needsMonthReport
          ? this.api.report({
              ...filters,
              from: this.monthStart,
              to: this.today,
              group: 'month',
              search: '',
              page: 1,
            }, refresh).catch(() => null)
          : Promise.resolve(null),
      ]);
      if (this.disposed || seq !== this.sequence) return;
      this.report.set(report);
      this.monthUsage.set(
        needsMonthReport || exactMonth
          ? this.monthFromTotals(needsMonthReport ? monthReport : report)
          : this.monthFromSeries(report.series ?? []),
      );
      if (report.error) this.error.set(report.error);
      if (
        (report.preparing || report.boardCreation?.preparing) &&
        report.progress?.status !== 'error'
      )
        this.timer = setTimeout(() => void this.load(), 5000);
    } catch (e) {
      if (!this.disposed && seq === this.sequence) this.error.set(this.friendly(e));
    } finally {
      if (!this.disposed && seq === this.sequence) {
        this.loading.set(false);
        this.refreshing.set(false);
      }
    }
  }
  setGroup(value: string): void {
    if (value === this.group()) return;
    this.group.set(value);
    this.page.set(1);
    void this.load();
  }
  setView(value: string): void {
    this.view.set(value);
    this.page.set(1);
    this.search.set('');
    void this.load();
  }
  selectAudience(value:AnalyticsAudience):void{this.audience.set(value);this.internal.set(value!=='visitors');this.page.set(1);void this.load();}
  setInternal(value: boolean): void {
    this.internal.set(value);
    this.audience.set(value?'all':'visitors');
    this.page.set(1);
    void this.load();
  }
  setDate(which: 'from' | 'to', value: string): void {
    this.preset.set('custom');
    (which === 'from' ? this.from : this.to).set(value);
  }
  async applyDates(): Promise<void> {
    if (!this.from() || !this.to() || this.from() > this.to() || this.to() > this.today) {
      this.error.set($localize`Choose a valid date range.`);
      return;
    }
    this.appliedDates.set({ from: this.from(), to: this.to() });
    this.page.set(1);
    await this.load();
  }
  selectPreset(value: string): void {
    this.preset.set(value);
    if (value === 'custom') return;
    this.to.set(this.today);
    if (value === 'month') {
      this.from.set(this.monthStart);
      this.group.set('day');
    }
    if (value === '30') {
      this.from.set(utcDate(new Date(Date.parse(this.today) - 29 * DAY_MS)));
      this.group.set('day');
    }
    if (value === '365') {
      this.from.set(this.twelveMonthsStart);
      this.group.set('month');
    }
    if (value === 'years') {
      this.from.set(utcDate(new Date(Date.UTC(this.now.getUTCFullYear() - 4, 0, 1))));
      this.group.set('year');
    }
    this.appliedDates.set({ from: this.from(), to: this.to() });
    this.page.set(1);
    void this.load();
  }
  setSearch(value: string): void {
    this.search.set(value);
    this.page.set(1);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => void this.load(), 300);
  }
  setPage(value: number): void {
    this.page.set(value);
    void this.load();
  }
  barHeight(seconds: number): number {
    return (seconds / 60 / this.axisMax()) * 100;
  }
  voicePeriodLabel(period: string): string {
    return period.length === 7
      ? this.monthFormat.format(new Date(period + '-01T00:00:00Z'))
      : this.periodLabel(period);
  }
  creationBarHeight(boards: number): number {
    return boards > 0 ? Math.max(2, (boards / this.creationAxisMax()) * 100) : 0;
  }
  showPeriod(index: number, n = this.series().length): boolean {
    return n <= 12 || index === 0 || index === n - 1 || index % Math.ceil(n / 7) === 0;
  }
  periodLabel(value: string): string {
    if (value.length === 4) return value;
    const stamp = value.length === 7 ? value + '-01' : value;
    return new Intl.DateTimeFormat(this.locale, {
      timeZone: 'UTC',
      ...(value.length === 7
        ? { month: 'short', year: 'numeric' }
        : { month: 'short', day: 'numeric' }),
    } as Intl.DateTimeFormatOptions).format(new Date(stamp + 'T00:00:00Z'));
  }
  private dateRange(from: string, to: string): string {
    return this.dateFormat.formatRange(
      new Date(from + 'T00:00:00Z'),
      new Date(to + 'T00:00:00Z'),
    );
  }
  private monthFromTotals(report: PlatformReport | null): VoiceUsage | null {
    if (!report?.totals) return null;
    return {
      seconds: this.voiceSeconds(report.totals, !report.coverage?.unrecorded),
      partial: report.coverage?.partial === true,
    };
  }
  private monthFromSeries(series: NonNullable<PlatformReport['series']>): VoiceUsage | null {
    const buckets = series.filter((bucket) => bucket.period.startsWith(this.monthStart.slice(0, 7)));
    if (!buckets.length) return null;
    const totals = { seconds: 0, voice: 0, unknownDurations: 0 };
    for (const bucket of buckets) {
      totals.seconds += bucket.seconds;
      totals.voice += bucket.voice;
      totals.unknownDurations += bucket.unknownDurations;
    }
    return {
      seconds: this.voiceSeconds(totals, buckets.some((bucket) => bucket.recorded)),
      partial: buckets.some((bucket) => bucket.partial),
    };
  }
  async sync(): Promise<void> {
    if (this.syncing()) return;
    this.syncing.set(true);
    this.error.set('');
    try {
      await this.api.sync();
      await this.load(true);
    } catch (e) {
      this.error.set(this.friendly(e));
    } finally {
      this.syncing.set(false);
    }
  }
  analyticsPath(row: PlatformRow): string[] {
    return this.view() === 'cards'
      ? ['/manage/boards', row.boardId!, 'cards', row.cardId!, 'analytics']
      : ['/manage/boards', row.boardId!, 'analytics'];
  }
  async exportCsv(): Promise<void> {
    if (this.exporting()) return;
    this.exporting.set(true);
    this.error.set('');
    const filters = this.filters();
    try {
      const report = await this.api.report(filters, false, true);
      if (report.preparing || !report.breakdown)
        throw new Error($localize`Wait for the initial sync to finish.`);
      const head = [
        $localize`Name`,
        $localize`Owner`,
        $localize`Board`,
        $localize`Boards`,
        $localize`Total cards`,
        $localize`Talking cards`,
        $localize`Conversations`,
        $localize`Voice calls`,
        $localize`Text conversations`,
        $localize`Voice seconds`,
        $localize`From (UTC)`,
        $localize`To (UTC)`,
        $localize`Activity audience`,
      ];
      const csv = platformCsv([
        head,
        ...report.breakdown.rows.map((r) => [
          r.title,
          r.owner,
          r.boardTitle,
          r.boards,
          r.cards,
          r.talkingCards,
          r.conversations,
          r.voice,
          r.text,
          report.coverage?.unrecorded || (r.voice && r.voice === r.unknownDurations && !r.seconds)
            ? null
            : r.seconds,
          filters.from,
          filters.to,
          filters.audience || (filters.includeInternal ? 'all' : 'visitors'),
        ]),
      ]);
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `platform-${filters.view}-${filters.from}-${filters.to}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      this.error.set(this.friendly(e));
    } finally {
      this.exporting.set(false);
    }
  }
  private friendly(e: unknown): string {
    const message = e instanceof Error ? e.message.replace(/^FirebaseError:\s*/, '') : '';
    return message && !/^(internal|unknown|unavailable|deadline-exceeded)$/i.test(message)
      ? message
      : $localize`Platform analytics could not be loaded.`;
  }
}
