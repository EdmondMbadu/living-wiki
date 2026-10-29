import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../auth.service';
import { PicamoAnalyticsService, type PicamoReport } from '../picamo-analytics.service';
import { PicamoAnalyticsComponent, picamoCsv } from './picamo-analytics';
const metrics = {
  conversations: 2,
  text: 1,
  voice: 1,
  messages: 8,
  seconds: 90,
  successes: 2,
  failures: 1,
  responses: 3,
  responseMs: 6000,
  unknownDurations: 0,
};
const result = (): PicamoReport => ({
  trackingSince: '2026-01-31T12:00:00Z',
  updatedAt: '2026-02-01T12:00:00Z',
  range: {
    from: '2026-01-01',
    to: '2026-02-01',
    source: 'all',
    group: 'day',
    includeInternal: false,
  },
  coverage: { unrecorded: false, partial: true },
  totals: { ...metrics, accounts: 1, guests: 1 },
  sources: [{ source: 'assistant', ...metrics }],
  series: [{ period: '2026-01-31', ...metrics, recorded: true, partial: true }],
  rows: [
    {
      id: 'session-0000000001',
      source: 'assistant',
      label: 'Assistant',
      mode: 'text',
      startedAt: '2026-01-31T12:00:00Z',
      atlasId: '',
      messages: 8,
      seconds: 30,
      status: 'completed',
      failures: 0,
      internal: false,
    },
  ],
  nextCursor: { id: 'session-0000000001', startedAt: Date.parse('2026-01-31T12:00:00Z') },
});
describe('Picamo analytics', () => {
  let api: { report: jasmine.Spy };
  beforeEach(async () => {
    api = { report: jasmine.createSpy().and.resolveTo(result()) };
    await TestBed.configureTestingModule({
      imports: [PicamoAnalyticsComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: PicamoAnalyticsService, useValue: api },
        {
          provide: AuthService,
          useValue: { waitForReady: () => Promise.resolve(), uid: signal('admin') },
        },
      ],
    }).compileComponents();
  });
  it('renders returned real counts and distinguishes elapsed text duration from voice time', async () => {
    const f = TestBed.createComponent(PicamoAnalyticsComponent);
    await f.whenStable();
    f.detectChanges();
    expect(f.nativeElement.querySelectorAll('.metrics strong')[3].textContent).toContain('8');
    expect(f.nativeElement.textContent).toContain('first to last activity');
    expect(f.componentInstance.voiceTime()).toBe('1.5 min');
    expect(f.componentInstance.responseTime()).toBe('2 s');
    expect(api.report.calls.mostRecent().args[0].includeInternal).toBeFalse();
  });
  it('does not show missing history as zero or missing voice duration as measured zero', async () => {
    api.report.and.resolveTo({ ...result(), coverage: { unrecorded: true, partial: true } });
    const f = TestBed.createComponent(PicamoAnalyticsComponent);
    await f.whenStable();
    f.detectChanges();
    expect(
      [...f.nativeElement.querySelectorAll('.metrics strong')].map((e: any) =>
        e.textContent.trim(),
      ),
    ).toEqual(['—', '—', '—', '—']);
    const c = f.componentInstance;
    c.report.set({
      ...result(),
      totals: { ...result().totals, voice: 1, seconds: 0, unknownDurations: 1 },
    });
    expect(c.voiceTime()).toBe('Not recorded');
    expect(c.duration(null)).toBe('Not recorded');
  });
  it('updates source, admin scope, date grouping and recent mode independently', async () => {
    const f = TestBed.createComponent(PicamoAnalyticsComponent);
    await f.whenStable();
    const c = f.componentInstance;
    c.setSource('city');
    await f.whenStable();
    expect(api.report.calls.mostRecent().args[0].source).toBe('city');
    c.setInternal(true);
    await f.whenStable();
    expect(api.report.calls.mostRecent().args[0].includeInternal).toBeTrue();
    c.selectPreset('years');
    await f.whenStable();
    expect(api.report.calls.mostRecent().args[0].group).toBe('year');
    c.setMode('voice');
    await f.whenStable();
    expect(api.report.calls.mostRecent().args[0].mode).toBe('voice');
  });
  it('narrows recent conversations by a chart month without changing the report totals range', async () => {
    const f = TestBed.createComponent(PicamoAnalyticsComponent);
    await f.whenStable();
    const c = f.componentInstance;
    c.from.set('2026-01-15');
    c.to.set('2026-02-02');
    c.narrow('2026-01');
    await f.whenStable();
    const filters = api.report.calls.mostRecent().args[0];
    expect(filters.from).toBe('2026-01-15');
    expect(filters.to).toBe('2026-02-02');
    expect(filters.recentFrom).toBe('2026-01-15');
    expect(filters.recentTo).toBe('2026-01-31');
    c.clearNarrow();
    await f.whenStable();
    expect(api.report.calls.mostRecent().args[0].recentFrom).toBeUndefined();
  });
  it('paginates with stable cursors, and resets paging when filters change', async () => {
    const f = TestBed.createComponent(PicamoAnalyticsComponent);
    await f.whenStable();
    const c = f.componentInstance;
    c.next();
    await f.whenStable();
    expect(api.report.calls.mostRecent().args[0].cursor).toEqual(result().nextCursor);
    c.back();
    await f.whenStable();
    expect(api.report.calls.mostRecent().args[0].cursor).toBeNull();
    c.next();
    await f.whenStable();
    c.setSource('city');
    await f.whenStable();
    expect(c.previous()).toEqual([]);
    expect(c.cursor()).toBeNull();
  });
  it('rejects invalid dates and ignores late responses from an older request', async () => {
    const f = TestBed.createComponent(PicamoAnalyticsComponent);
    await f.whenStable();
    const c = f.componentInstance;
    api.report.calls.reset();
    c.from.set('2099-01-01');
    c.applyDates();
    expect(api.report).not.toHaveBeenCalled();
    c.from.set('2026-01-01');
    let resolve!: (r: PicamoReport) => void;
    api.report.and.returnValue(new Promise<PicamoReport>((r) => (resolve = r)));
    const old = c.load();
    await Promise.resolve();
    api.report.and.resolveTo(result());
    await c.load(true);
    resolve({ ...result(), totals: { ...result().totals, messages: 999 } });
    await old;
    expect(c.totals()?.messages).toBe(8);
  });
  it('exports all filtered sessions instead of just the visible page and preserves duration basis', async () => {
    const f = TestBed.createComponent(PicamoAnalyticsComponent);
    await f.whenStable();
    const c = f.componentInstance;
    spyOn(URL, 'createObjectURL').and.returnValue('blob:test');
    spyOn(URL, 'revokeObjectURL');
    spyOn(HTMLAnchorElement.prototype, 'click');
    await c.exportCsv();
    const args = api.report.calls.mostRecent().args;
    expect(args[0].cursor).toBeNull();
    expect(args[2]).toBeTrue();
    const blob = (URL.createObjectURL as jasmine.Spy).calls.mostRecent().args[0] as Blob;
    expect(await blob.text()).toContain('First to last activity');
    expect(picamoCsv([['=SUM(A1)', '@unsafe', 'a"b']])).toContain("'=SUM(A1)");
    expect(picamoCsv([['a"b']])).toContain('a""b');
  });
  it('shows a useful retry state for opaque backend errors', async () => {
    api.report.and.rejectWith(new Error('internal'));
    const f = TestBed.createComponent(PicamoAnalyticsComponent);
    await f.whenStable();
    f.detectChanges();
    expect(f.nativeElement.querySelector('[role="alert"]').textContent).toContain(
      'Please try again',
    );
  });
});
