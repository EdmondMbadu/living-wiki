import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '../auth.service';
import { TeamsService } from '../teams/teams.service';
import { teamsServiceStub } from '../teams/teams.testing';
import { PlatformAnalyticsService, PlatformReport } from '../platform-analytics.service';
import { PlatformAnalyticsComponent, platformCsv, platformVoiceTime } from './platform-analytics';

const result = (): PlatformReport => ({
  preparing: false,
  inventory: { boards: 3, cards: 10, talkingCards: 4 },
  totals: {
    conversations: 2,
    voice: 1,
    text: 1,
    seconds: 75,
    questions: 4,
    failedAnswers: 0,
    unknownDurations: 0,
    activeCards: 1,
  },
  series: [],
  coverage: { partial: false, unrecorded: false },
  breakdown: {
    view: 'cards',
    total: 1,
    page: 1,
    pageSize: 25,
    rows: [
      {
        key: 'one',
        title: 'Verified card',
        owner: 'Owner',
        boardTitle: 'Board',
        boardId: 'board',
        cardId: 'card',
        boards: 0,
        cards: 1,
        talkingCards: 1,
        conversations: 2,
        voice: 1,
        text: 1,
        seconds: 75,
        analyticsAvailable: true,
      },
    ],
  },
});
describe('Platform analytics', () => {
  let api: { report: jasmine.Spy; sync: jasmine.Spy };
  beforeEach(async () => {
    api = {
      report: jasmine.createSpy().and.resolveTo(result()),
      sync: jasmine.createSpy().and.resolveTo({ jobId: 'sync' }),
    };
    await TestBed.configureTestingModule({
      imports: [PlatformAnalyticsComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: PlatformAnalyticsService, useValue: api },
        { provide: TeamsService, useValue: teamsServiceStub() },
        {
          provide: AuthService,
          useValue: {
            waitForReady: () => Promise.resolve(),
            uid: signal('admin'),
            isAuthenticated: signal(true),
            isAdmin: signal(true),
            profile: signal(null),
            displayName: signal('Admin'),
            email: signal('admin@example.test'),
          },
        },
      ],
    }).compileComponents();
  });
  it('renders returned inventory and scoped navigation without sample values', async () => {
    const f = TestBed.createComponent(PlatformAnalyticsComponent);
    await f.whenStable();
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('Verified card');
    expect(
      f.nativeElement.querySelector('a[href="/manage/boards/board/cards/card/analytics"]'),
    ).not.toBeNull();
    expect(api.report.calls.mostRecent().args[0].includeInternal).toBeFalse();
  });
  it('reloads each filter with the right date grouping and internal scope', async () => {
    const f = TestBed.createComponent(PlatformAnalyticsComponent);
    await f.whenStable();
    const c = f.componentInstance;
    c.selectPreset('years');
    await f.whenStable();
    expect(api.report.calls.mostRecent().args[0].group).toBe('year');
    c.setInternal(true);
    await f.whenStable();
    expect(api.report.calls.mostRecent().args[0].includeInternal).toBeTrue();
    c.setView('users');
    await f.whenStable();
    expect(api.report.calls.mostRecent().args[0].view).toBe('users');
  });
  it('does not replace the latest request with a late older response', async () => {
    let resolve!: (r: PlatformReport) => void;
    api.report.and.returnValue(new Promise<PlatformReport>((r) => (resolve = r)));
    const f = TestBed.createComponent(PlatformAnalyticsComponent);
    await Promise.resolve();
    await Promise.resolve();
    api.report.and.resolveTo(result());
    await f.componentInstance.load(true);
    resolve({ ...result(), inventory: { boards: 999, cards: 999, talkingCards: 999 } });
    await f.whenStable();
    expect(f.componentInstance.report()?.inventory?.boards).toBe(3);
  });
  it('shows unknown duration and unavailable history without a measured zero', async () => {
    const f = TestBed.createComponent(PlatformAnalyticsComponent);
    await f.whenStable();
    const c = f.componentInstance;
    expect(c.voiceSeconds({ voice: 1, unknownDurations: 1, seconds: 0 })).toBeNull();
    expect(c.voiceSeconds({ voice: 2, unknownDurations: 1, seconds: 75 })).toBe(75);
    c.report.set({ ...result(), coverage: { partial: true, unrecorded: true } });
    expect(c.voiceSeconds({ seconds: 0 })).toBeNull();
  });
  it('surfaces retryable server errors', async () => {
    api.report.and.rejectWith(new Error('Service unavailable'));
    const f = TestBed.createComponent(PlatformAnalyticsComponent);
    await f.whenStable();
    f.detectChanges();
    expect(f.nativeElement.querySelector('[role="alert"]').textContent).toContain(
      'Service unavailable',
    );
  });
  it('replaces opaque callable errors with a useful retry message', async () => {
    api.report.and.rejectWith(new Error('internal'));
    const f = TestBed.createComponent(PlatformAnalyticsComponent); await f.whenStable();
    expect(f.componentInstance.error()).toBe('Platform analytics could not be loaded.');
  });
  it('rejects invalid dates without calling the server', async () => {
    const f = TestBed.createComponent(PlatformAnalyticsComponent);
    await f.whenStable();
    api.report.calls.reset();
    f.componentInstance.setDate('from', '2099-01-01');
    await f.componentInstance.applyDates();
    expect(api.report).not.toHaveBeenCalled();
    expect(f.componentInstance.error()).toContain('valid date');
  });
  it('exports all filtered rows rather than the visible page', async () => {
    const f = TestBed.createComponent(PlatformAnalyticsComponent);
    await f.whenStable();
    spyOn(URL, 'createObjectURL').and.returnValue('blob:test');
    spyOn(HTMLAnchorElement.prototype, 'click');
    await f.componentInstance.exportCsv();
    expect(api.report.calls.mostRecent().args[2]).toBeTrue();
  });
  it('keeps sub-minute precision and neutralizes spreadsheet formulas', () => {
    expect(platformVoiceTime(15)).toBe('15 sec');
    expect(platformVoiceTime(null)).toBe('Not recorded');
    expect(platformCsv([['=IMPORTXML("x")', 'normal']])).toContain('"\'=IMPORTXML(""x"")"');
  });
});
