import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
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
  imports: [RouterLink, DatePipe, DecimalPipe, ThemeToggleComponent, AccountMenuComponent],
  templateUrl: './platform-analytics.html',
  styleUrl: './platform-analytics.css',
})
export class PlatformAnalyticsComponent {
  private readonly api = inject(PlatformAnalyticsService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly title = inject(Title);
  private readonly destroyRef = inject(DestroyRef);
  readonly report = signal<PlatformReport | null>(null);
  readonly loading = signal(true);
  readonly refreshing = signal(false);
  readonly error = signal('');
  readonly exporting = signal(false);
  readonly syncing = signal(false);
  readonly from = signal(new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10));
  readonly to = signal(new Date().toISOString().slice(0, 10));
  readonly today = new Date().toISOString().slice(0, 10);
  readonly group = signal('day');
  readonly internal = signal(false);
  readonly view = signal('cards');
  readonly search = signal('');
  readonly page = signal(1);
  readonly preset = signal('30');
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
    from: this.from(),
    to: this.to(),
    group: this.group(),
    includeInternal: this.internal(),
    view: this.view(),
    search: this.search(),
    page: this.page(),
  }));
  readonly totals = computed(() => this.report()?.totals);
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
  readonly maxMinutes = computed(() => Math.max(1, ...this.series().map((r) => r.seconds / 60)));
  readonly axisMax = computed(() => {
    const max = this.maxMinutes();
    const step = 10 ** Math.floor(Math.log10(max));
    return Math.ceil(max / step) * step;
  });
  readonly ticks = computed(() =>
    Array.from({ length: 4 }, (_, i) => (this.axisMax() * (3 - i)) / 3),
  );
  readonly pages = computed(() =>
    Math.max(1, Math.ceil((this.report()?.breakdown?.total || 0) / 25)),
  );
  readonly unavailable = computed(() => this.report()?.coverage?.unrecorded === true);
  readonly time = platformVoiceTime;
  voiceSeconds(
    row: { seconds?: number; voice?: number; unknownDurations?: number } | null | undefined,
  ): number | null {
    if (this.unavailable() || !row) return null;
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
    void this.load();
  }
  async load(refresh = false): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    const seq = ++this.sequence;
    if (this.report()) this.refreshing.set(true);
    else this.loading.set(true);
    this.error.set('');
    try {
      await this.auth.waitForReady();
      const report = await this.api.report(this.filters(), refresh);
      if (this.disposed || seq !== this.sequence) return;
      this.report.set(report);
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
  setInternal(value: boolean): void {
    this.internal.set(value);
    this.page.set(1);
    void this.load();
  }
  setDate(which: 'from' | 'to', value: string): void {
    this.preset.set('custom');
    (which === 'from' ? this.from : this.to).set(value);
    this.page.set(1);
  }
  async applyDates(): Promise<void> {
    if (!this.from() || !this.to() || this.from() > this.to() || this.to() > this.today) {
      this.error.set($localize`Choose a valid date range.`);
      return;
    }
    await this.load();
  }
  selectPreset(value: string): void {
    this.preset.set(value);
    if (value === 'custom') return;
    const end = new Date();
    this.to.set(this.today);
    if (value === '30') {
      this.from.set(new Date(end.getTime() - 29 * 86400000).toISOString().slice(0, 10));
      this.group.set('day');
    }
    if (value === '365') {
      this.from.set(
        new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 11, 1))
          .toISOString()
          .slice(0, 10),
      );
      this.group.set('month');
    }
    if (value === 'years') {
      this.from.set(new Date(Date.UTC(end.getUTCFullYear() - 4, 0, 1)).toISOString().slice(0, 10));
      this.group.set('year');
    }
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
    return seconds > 0 ? Math.max(2, (seconds / 60 / this.axisMax()) * 100) : 0;
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
    return new Intl.DateTimeFormat(undefined, {
      timeZone: 'UTC',
      ...(value.length === 7
        ? { month: 'short', year: 'numeric' }
        : { month: 'short', day: 'numeric' }),
    } as Intl.DateTimeFormatOptions).format(new Date(stamp + 'T00:00:00Z'));
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
