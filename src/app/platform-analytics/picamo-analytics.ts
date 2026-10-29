import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { AuthService } from '../auth.service';
import {
  PicamoAnalyticsService,
  type PicamoReport,
  type PicamoFilters,
  type PicamoCursor,
  type PicamoRow,
} from '../picamo-analytics.service';

// Quoted CSV fields still need protection against spreadsheet formula execution.
export function picamoCsv(rows: unknown[][]): string {
  return (
    '\uFEFF' +
    rows
      .map((row) =>
        row
          .map((value) => {
            const text = String(value ?? '');
            return '"' + (/^\s*[=+\-@]/.test(text) ? "'" + text : text).replace(/"/g, '""') + '"';
          })
          .join(','),
      )
      .join('\r\n')
  );
}
@Component({
  selector: 'app-picamo-analytics',
  imports: [DatePipe, DecimalPipe],
  templateUrl: './picamo-analytics.html',
  styleUrl: './picamo-analytics.css',
})
export class PicamoAnalyticsComponent {
  private readonly api = inject(PicamoAnalyticsService);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  readonly report = signal<PicamoReport | null>(null);
  readonly loading = signal(false);
  readonly exporting = signal(false);
  readonly error = signal('');
  readonly today = new Date().toISOString().slice(0, 10);
  readonly from = signal(new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10));
  readonly to = signal(this.today);
  readonly preset = signal('30');
  readonly group = signal('day');
  readonly source = signal('all');
  readonly city = signal('');
  readonly internal = signal(false);
  readonly mode = signal('all');
  readonly metric = signal<'conversations' | 'messages' | 'seconds'>('conversations');
  readonly recentFrom = signal('');
  readonly recentTo = signal('');
  readonly cursor = signal<PicamoCursor | null>(null);
  readonly previous = signal<Array<PicamoCursor | null>>([]);
  readonly selected = signal<PicamoRow | null>(null);
  readonly groups = [
    { value: 'day', label: $localize`Day` },
    { value: 'month', label: $localize`Month` },
    { value: 'year', label: $localize`Year` },
  ];
  readonly conversationsHeading = $localize`Conversations over time`;
  readonly messagesHeading = $localize`User messages over time`;
  readonly minutesHeading = $localize`Verified voice minutes over time`;
  readonly metrics = [
    { value: 'conversations', label: $localize`Conversations` },
    { value: 'messages', label: $localize`Messages` },
    { value: 'seconds', label: $localize`Voice minutes` },
  ] as const;
  readonly totals = computed(() => this.report()?.totals);
  readonly series = computed(() => this.report()?.series || []);
  readonly unavailable = computed(() => this.report()?.coverage.unrecorded !== false);
  readonly max = computed(() => {
    const maximum = Math.max(
      1,
      ...this.series().map((r) =>
        this.metric() === 'seconds' ? r.seconds / 60 : r[this.metric()],
      ),
    );
    const step = 10 ** Math.floor(Math.log10(maximum));
    return Math.ceil(maximum / step) * step;
  });
  readonly ticks = computed(() => [
    ...new Set([
      this.max(),
      this.metric() === 'seconds' ? this.max() / 2 : Math.floor(this.max() / 2),
      0,
    ]),
  ]);
  readonly filters = computed<PicamoFilters>(() => ({
    from: this.from(),
    to: this.to(),
    group: this.group(),
    source: this.source(),
    atlasId: this.city(),
    includeInternal: this.internal(),
    mode: this.mode(),
    cursor: this.cursor(),
    ...(this.recentFrom() ? { recentFrom: this.recentFrom(), recentTo: this.recentTo() } : {}),
  }));
  private sequence = 0;
  private disposed = false;
  constructor() {
    this.destroyRef.onDestroy(() => {
      this.disposed = true;
      ++this.sequence;
    });
    void this.load();
  }
  async load(refresh = false): Promise<void> {
    const seq = ++this.sequence;
    this.loading.set(true);
    this.error.set('');
    this.selected.set(null);
    try {
      await this.auth.waitForReady();
      const report = await this.api.report(this.filters(), refresh);
      if (!this.disposed && seq === this.sequence) this.report.set(report);
    } catch (error) {
      if (!this.disposed && seq === this.sequence) this.error.set(this.friendly(error));
    } finally {
      if (!this.disposed && seq === this.sequence) this.loading.set(false);
    }
  }
  private resetRecent() {
    this.cursor.set(null);
    this.previous.set([]);
    this.recentFrom.set('');
    this.recentTo.set('');
  }
  setGroup(value: string) {
    this.group.set(value);
    this.resetRecent();
    void this.load();
  }
  setCity(value: string) {
    this.city.set(value);
    this.resetRecent();
    void this.load();
  }
  setSource(value: string) {
    this.city.set('');
    this.source.set(value);
    this.resetRecent();
    void this.load();
  }
  setInternal(value: boolean) {
    this.internal.set(value);
    this.resetRecent();
    void this.load();
  }
  setMode(value: string) {
    this.mode.set(value);
    this.cursor.set(null);
    this.previous.set([]);
    void this.load();
  }
  setDate(which: 'from' | 'to', value: string) {
    this.preset.set('custom');
    (which === 'from' ? this.from : this.to).set(value);
  }
  applyDates() {
    if (!this.from() || !this.to() || this.from() > this.to() || this.to() > this.today) {
      this.error.set($localize`Choose a valid date range.`);
      return;
    }
    this.resetRecent();
    void this.load();
  }
  selectPreset(value: string) {
    this.preset.set(value);
    if (value === 'custom') return;
    const now = new Date();
    this.to.set(this.today);
    if (value === '30') {
      this.from.set(new Date(now.getTime() - 29 * 86400000).toISOString().slice(0, 10));
      this.group.set('day');
    }
    if (value === '365') {
      this.from.set(
        new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1))
          .toISOString()
          .slice(0, 10),
      );
      this.group.set('month');
    }
    if (value === 'years') {
      this.from.set(new Date(Date.UTC(now.getUTCFullYear() - 4, 0, 1)).toISOString().slice(0, 10));
      this.group.set('year');
    }
    this.resetRecent();
    void this.load();
  }
  narrow(period: string) {
    const start =
      period.length === 4 ? period + '-01-01' : period.length === 7 ? period + '-01' : period;
    const date = new Date(start + 'T00:00:00Z');
    const end =
      period.length === 4
        ? period + '-12-31'
        : period.length === 7
          ? new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0))
              .toISOString()
              .slice(0, 10)
          : start;
    this.recentFrom.set(start < this.from() ? this.from() : start);
    this.recentTo.set(end > this.to() ? this.to() : end);
    this.cursor.set(null);
    this.previous.set([]);
    void this.load();
  }
  clearNarrow() {
    this.resetRecent();
    void this.load();
  }
  next() {
    if (this.loading() || !this.report()?.nextCursor) return;
    this.previous.update((rows) => [...rows, this.cursor()]);
    this.cursor.set(this.report()!.nextCursor);
    void this.load();
  }
  back() {
    if (this.loading() || !this.previous().length) return;
    const stack = [...this.previous()];
    this.cursor.set(stack.pop()!);
    this.previous.set(stack);
    void this.load();
  }
  sourceName(source: string) {
    return source === 'assistant' ? $localize`Assistant` : $localize`City guide`;
  }
  modeName(mode: string) {
    return mode === 'voice' ? $localize`Voice` : $localize`Text`;
  }
  statusName(status: string) {
    return (
      (
        {
          completed: $localize`Completed`,
          active: $localize`Active`,
          failed: $localize`Failed`,
          interrupted: $localize`Interrupted`,
        } as Record<string, string>
      )[status] || $localize`Pending`
    );
  }
  duration(seconds: number | null | undefined): string {
    if (seconds === null || seconds === undefined) return $localize`Not recorded`;
    const s = Math.round(seconds);
    return s < 60
      ? $localize`${s}:SECONDS: sec`
      : $localize`${Math.floor(s / 60)}:MINUTES: min ${s % 60}:SECONDS: sec`;
  }
  voiceTime(): string {
    const t = this.totals();
    if (this.unavailable() || !t || (t.voice > 0 && t.unknownDurations === t.voice && !t.seconds))
      return $localize`Not recorded`;
    return $localize`${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(t.seconds / 60)}:MINUTES: min`;
  }
  successRate(): string {
    const t = this.totals();
    return t?.responses
      ? new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 }).format(
          t.successes / t.responses,
        )
      : '—';
  }
  responseTime(): string {
    const t = this.totals();
    return t?.responses
      ? $localize`${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(t.responseMs / t.responses / 1000)}:SECONDS: s`
      : '—';
  }
  label(value: string): string {
    if (value.length === 4) return value;
    return new Intl.DateTimeFormat(undefined, {
      timeZone: 'UTC',
      month: 'short',
      ...(value.length === 7 ? { year: 'numeric' } : { day: 'numeric' }),
    }).format(new Date((value.length === 7 ? value + '-01' : value) + 'T00:00:00Z'));
  }
  showLabel(index: number) {
    const n = this.series().length;
    return n <= 12 || index === 0 || index === n - 1 || index % Math.ceil(n / 7) === 0;
  }
  height(row: PicamoReport['series'][number]) {
    const value = this.metric() === 'seconds' ? row.seconds / 60 : row[this.metric()];
    return value > 0 ? Math.max(2, (value / this.max()) * 100) : 0;
  }
  barLabel(row: PicamoReport['series'][number]) {
    if (!row.recorded) return $localize`${row.period}:PERIOD:: Not recorded`;
    const value =
      this.metric() === 'seconds' ? this.duration(row.seconds) : String(row[this.metric()]);
    return `${row.period}: ${value}${row.partial ? ' · ' + $localize`Partial period` : ''}`;
  }
  async exportCsv() {
    if (this.exporting() || this.loading()) return;
    this.exporting.set(true);
    this.error.set('');
    const filters = { ...this.filters(), cursor: null };
    try {
      const report = await this.api.report(filters, true, true);
      const csv = picamoCsv([
        [
          $localize`Started (UTC)`,
          $localize`Source`,
          $localize`Context`,
          $localize`Mode`,
          $localize`User messages`,
          $localize`Duration seconds`,
          $localize`Duration basis`,
          $localize`Status`,
          $localize`Admin testing`,
          $localize`From (UTC)`,
          $localize`To (UTC)`,
          $localize`Tracking since (UTC)`,
        ],
        ...report.rows.map((r) => [
          r.startedAt,
          this.sourceName(r.source),
          r.label,
          this.modeName(r.mode),
          r.messages,
          r.seconds,
          r.mode === 'voice'
            ? $localize`Verified call duration`
            : $localize`First to last activity`,
          this.statusName(r.status),
          r.internal,
          filters.recentFrom || filters.from,
          filters.recentTo || filters.to,
          report.trackingSince,
        ]),
      ]);
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })),
        link = document.createElement('a');
      link.href = url;
      link.download = `picamo-${filters.from}-${filters.to}.csv`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      if (!this.disposed) this.error.set(this.friendly(error));
    } finally {
      if (!this.disposed) this.exporting.set(false);
    }
  }
  private friendly(error: unknown) {
    const message = error instanceof Error ? error.message.replace(/^FirebaseError:\s*/, '') : '';
    return message && !/^(internal|unknown|unavailable|deadline-exceeded)$/i.test(message)
      ? message
      : $localize`Picamo analytics could not be loaded. Please try again.`;
  }
}
