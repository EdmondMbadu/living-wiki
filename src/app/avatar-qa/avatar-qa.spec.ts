import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { AuthService } from '../auth.service';
import { AtlasService } from '../atlas.service';
import { TeamsService } from '../teams/teams.service';
import { teamsServiceStub } from '../teams/teams.testing';
import { AvatarQaComponent } from './avatar-qa';
import { AvatarQaService, type QaWorkspace, type QaReference, type QaRun, type DirectQuestion } from './avatar-qa.service';
import { previewQaImport } from './avatar-qa-import';
const reference: QaReference = { id: 'AMD-001', question: 'A question?', expectedAnswer: 'Reference.', category: 'education', source: 'Answer key v1', approval: 'draft', approvedBy: '', approvedOn: '', followUps: [] };
const workspace: QaWorkspace = { target: { boardId: 'b1', cardId: 'c1', atlasId: 'a1', boardTitle: 'Your board', avatarName: 'Maya Chen', openingMessage: 'Hello', personaPrompt: 'Educational guide', boardSlug: 'your-board' }, references: [], revision: 0, documents: [], runs: [], selectedRun: null };
const runFixture = (changes: Partial<QaRun> = {}): QaRun => ({ id: 'run1', createdAt: '2026-10-22T12:00:00Z', status: 'completed', total: 25, completed: 25, passed: 23, failed: 2, errors: 0, critical: 0, cancelled: 0, fingerprint: 'hash', suiteHash: 'suite', protocol: 'avatar-stress-v1', references: [], reviews: [], results: [], ...changes });
const direct: DirectQuestion = { id: 'question1', question: 'A question?', answer: 'The answer a visitor receives.', answerMode: 'wiki', citations: [], createdAt: '2026-10-22T12:00:00Z', assessment: null };

describe('AvatarQaComponent', () => {
  const service = { command: jasmine.createSpy('command') };
  let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  beforeEach(async () => {
    params = new BehaviorSubject(convertToParamMap({ boardId: 'b1', cardId: 'c1' }));
    service.command.calls.reset(); service.command.and.resolveTo(structuredClone(workspace));
    await TestBed.configureTestingModule({ imports: [AvatarQaComponent], providers: [provideZonelessChangeDetection(), provideRouter([]),
      { provide: ActivatedRoute, useValue: { paramMap: params } }, { provide: AvatarQaService, useValue: service },
      { provide: TeamsService, useFactory: teamsServiceStub },
      { provide: AuthService, useValue: { waitForReady: async () => {}, uid: signal('owner'), profile: signal({ preferredCitySlug: 'philly' }), isAuthenticated: signal(true), signOut: async () => {} } },
      { provide: AtlasService, useValue: { activeAtlasWikiLink: signal('/wiki/philly') } },
    ] }).compileComponents();
  });
  async function render() {
    const fixture = TestBed.createComponent(AvatarQaComponent); fixture.detectChanges(); await fixture.componentInstance.load(true); fixture.detectChanges(); return fixture;
  }
  it('shows both simple flows and real empty results without an upload prerequisite', async () => {
    const fixture = await render(), root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Run a stress test'); expect(root.textContent).toContain('Ask one question');
    expect(root.textContent).toContain('Maya Chen'); expect(root.textContent).toContain('Not tested');
    expect(root.textContent).not.toContain('Upload test file'); expect(root.textContent).not.toContain('92');
    expect(root.querySelector('.qa-score-ring')).toBeNull();
    expect(root.querySelector('.qa-rail-brand img')?.getAttribute('src')).toBe('/assets/image/lucky-paper-crane.png');
    fixture.destroy();
  });
  it('defaults to 25, supports presets and rejects invalid custom counts', async () => {
    const fixture = await render(), page = fixture.componentInstance;
    expect(page.count()).toBe(25);
    page.chooseCount(50); expect(page.validCount()).toBeTrue();
    for (const value of [0, 51, 1.5, null]) { page.setCustomCount(value); expect(page.validCount()).toBeFalse(); await page.start(); }
    expect(service.command.calls.allArgs().some(args => args[2] === 'startStress')).toBeFalse();
    page.setCustomCount(17); expect(page.validCount()).toBeTrue(); fixture.destroy();
  });
  it('starts generated tests without a reference library and sends the selected count and boundaries', async () => {
    const fixture = await render(), page = fixture.componentInstance;
    service.command.and.callFake(async (_b: string, _c: string, action: string) => action === 'startStress' ? { runId: 'new-run' } : workspace);
    page.chooseCount(50); page.setBoundaries('Never promise refunds.'); await page.start();
    const call = service.command.calls.allArgs().find(args => args[2] === 'startStress')!;
    expect(call[3].count).toBe(50); expect(call[3].boundaries).toBe('Never promise refunds.'); expect(call[3].requestId).toBeTruthy();
    expect(page.starting()).toBeFalse(); fixture.destroy();
  });
  it('clears a running-test notice when polling returns a finished test', async () => {
    const fixture = await render(), page = fixture.componentInstance;
    const active = runFixture({ status: 'running', completed: 0, passed: 0, failed: 0 });
    service.command.and.callFake(async (_b: string, _c: string, action: string) => action === 'startStress'
      ? { runId: active.id } : { ...workspace, selectedRun: active, runs: [active] });
    await page.start(); expect(page.notice()).toContain('is running');
    const finished = runFixture();
    service.command.and.resolveTo({ ...workspace, selectedRun: finished, runs: [finished] });
    await page.load(); expect(page.notice()).toBe('');
    page.notice.set('Your PDF report has been downloaded.');
    await page.load(); expect(page.notice()).toContain('downloaded'); fixture.destroy();
  });
  it('reuses an uncertain start request rather than accidentally creating a second test', async () => {
    const fixture = await render(), page = fixture.componentInstance;
    service.command.and.rejectWith(Object.assign(new Error('Network timeout'), { code: 'functions/deadline-exceeded' }));
    await page.start(); const first = service.command.calls.mostRecent().args[3].requestId;
    await page.start(); expect(service.command.calls.mostRecent().args[3].requestId).toBe(first);
    page.chooseCount(10); await page.start(); expect(service.command.calls.mostRecent().args[3].requestId).not.toBe(first); fixture.destroy();
  });
  it('shows a final 92 score only for a fully assessed stress test', async () => {
    const fixture = await render(), page = fixture.componentInstance;
    const run = runFixture(); page.data.set({ ...workspace, selectedRun: run, runs: [run] }); fixture.detectChanges();
    expect(page.score()).toBe(92); expect(fixture.nativeElement.querySelector('.qa-score-ring strong').textContent).toBe('92');
    for (const change of [{ completed: 24 }, { status: 'running' }, { errors: 1, passed: 22 }, { cancelled: 1, passed: 22 }, { protocol: 'exact-text-v1' }]) {
      page.data.set({ ...workspace, selectedRun: runFixture(change) }); expect(page.score()).toBeNull();
    }
    fixture.destroy();
  });
  it('disables new stress tests while questions are being generated and allows stopping', async () => {
    const fixture = await render(), page = fixture.componentInstance;
    const run = runFixture({ status: 'generating', completed: 0, passed: 0, failed: 0 });
    page.data.set({ ...workspace, selectedRun: run, runs: [run] }); fixture.detectChanges();
    expect(page.score()).toBeNull(); expect(fixture.nativeElement.querySelector('.qa-start').disabled).toBeTrue();
    expect(fixture.nativeElement.textContent).toContain('Generating 25 questions');
    await page.start(); expect(service.command.calls.allArgs().some(args => args[2] === 'startStress')).toBeFalse(); fixture.destroy();
  });
  it('preserves scores but clearly marks results of a changed avatar', async () => {
    const fixture = await render(), page = fixture.componentInstance;
    page.data.set({ ...workspace, selectedRun: runFixture({ stale: true }) }); fixture.detectChanges();
    expect(page.status()).toBe('Avatar changed'); expect(page.score()).toBe(92);
    expect(fixture.nativeElement.textContent).toContain('earlier version'); fixture.destroy();
  });
  it('keeps saved answers accessible when configuration freshness could not be checked', async () => {
    const fixture = await render(), page = fixture.componentInstance;
    page.data.set({ ...workspace, selectedRun: runFixture({ stale: true, configurationWarning: 'Saved results are available, but the current avatar configuration could not be checked.' }) }); fixture.detectChanges();
    expect(page.status()).toBe('Retest recommended'); expect(page.score()).toBe(92);
    expect(fixture.nativeElement.textContent).toContain('Saved results are available');
    expect(fixture.nativeElement.textContent).not.toContain('The avatar or its knowledge has changed.'); fixture.destroy();
  });
  it('shows the direct answer before assessment finishes and keeps its result separate from the score', async () => {
    const fixture = await render(), page = fixture.componentInstance;
    let finish!: (value: DirectQuestion) => void;
    service.command.and.callFake((_b: string, _c: string, action: string) => action === 'ask' ? Promise.resolve(direct) : new Promise<DirectQuestion>(resolve => finish = resolve));
    page.question.set('A question?'); const pending = page.ask(); await Promise.resolve(); await Promise.resolve(); fixture.detectChanges();
    expect(page.direct()?.answer).toBe(direct.answer); expect(page.assessing()).toBeTrue(); expect(page.asking()).toBeFalse();
    expect(fixture.nativeElement.textContent).toContain('The answer a visitor receives.'); expect(page.run()).toBeNull();
    finish({ ...direct, assessment: { status: 'passed', critical: false, severity: 'none', title: 'Handled appropriately', reason: 'Respected the boundaries.' } });
    await pending; expect(page.direct()?.assessment?.status).toBe('passed'); fixture.destroy();
  });
  it('keeps the actual answer visible when assessment is unavailable', async () => {
    const fixture = await render(), page = fixture.componentInstance;
    service.command.and.callFake(async (_b: string, _c: string, action: string) => {
      if (action === 'ask') return direct; throw new Error('Evaluator unavailable');
    });
    page.question.set('A question?'); await page.ask(); fixture.detectChanges();
    expect(page.direct()?.answer).toBe(direct.answer); expect(page.direct()?.assessment).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Could not assess'); expect(fixture.nativeElement.textContent).not.toContain('Handled safely'); fixture.destroy();
  });
  it('does not call the backend for empty direct questions', async () => {
    const fixture = await render(), page = fixture.componentInstance;
    page.question.set('   '); await page.ask(); expect(service.command.calls.allArgs().some(args => args[2] === 'ask')).toBeFalse(); fixture.destroy();
  });
  it('ignores a delayed answer after navigating to another avatar', async () => {
    const fixture = await render(), page = fixture.componentInstance;
    let finish!: (value: DirectQuestion) => void;
    service.command.and.callFake((_b: string, _c: string, action: string) => action === 'ask' ? new Promise<DirectQuestion>(resolve => finish = resolve) : Promise.resolve(workspace));
    page.question.set('A question?'); const pending = page.ask();
    params.next(convertToParamMap({ boardId: 'other-board', cardId: 'other-card' })); finish(direct); await pending;
    expect(page.direct()).toBeNull(); expect(page.asking()).toBeFalse(); fixture.destroy();
  });
  it('renders question and answer markup as text, with expandable actual response evidence', async () => {
    const fixture = await render(), page = fixture.componentInstance;
    const result = { id: 'Q-001', referenceId: 'Q-001', category: 'privacy' as const, status: 'failed', critical: true, turns: [{ question: '<img src=x onerror=alert(1)>', actualAnswer: '<script>bad()</script>', expectedAnswer: '', answerMode: 'wiki', reason: 'Private information disclosed.', status: 'failed', critical: true, citations: [], citedEntryIds: [], title: 'Privacy issue' }] };
    page.data.set({ ...workspace, selectedRun: runFixture({ results: [result] }) }); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('script')).toBeNull(); expect(fixture.nativeElement.querySelector('.qa-result img')).toBeNull();
    expect(fixture.nativeElement.querySelector('.qa-result-detail').textContent).toContain('<script>bad()</script>');
    page.toggleAll(); page.search.set('not present'); expect(page.visibleResults().length).toBe(0); fixture.destroy();
  });
  it('offers PDF export for finished tests and keeps export errors visible', async () => {
    const fixture = await render(), page = fixture.componentInstance;
    page.data.set({ ...workspace, selectedRun: runFixture() });
    service.command.and.rejectWith(new Error('Report temporarily unavailable')); await page.exportReport();
    expect(service.command.calls.mostRecent().args[2]).toBe('report'); expect(page.exporting()).toBeFalse(); expect(page.error()).toContain('Report temporarily unavailable'); fixture.destroy();
  });
});

describe('QA file contract', () => {
  it('blocks bad shapes, duplicate IDs, invalid approval dates and excessive follow-ups', () => {
    for (const value of [
      { question: 'Not an array' }, [], [reference, reference],
      [{ ...reference, approval: 'approved', approvedBy: 'Reviewer', approvedOn: '2026-02-30' }],
      [{ ...reference, followUps: Array(5).fill({ question: 'Question?', expectedAnswer: 'Answer.' }) }],
      [{ ...reference, question: 'x'.repeat(1001) }],
    ]) expect(previewQaImport(JSON.stringify(value), []).error).not.toBe('');
    expect(previewQaImport(JSON.stringify([reference]), [reference]).error).toContain('already exists');
    const full = Array.from({length: 100}, (_, index) => ({...reference, id: `EXISTING-${index}`}));
    expect(previewQaImport(JSON.stringify([reference]), full).error).toContain('100');
  });
});

describe('Avatar QA iterative improvements', () => {
  const service = { command: jasmine.createSpy('command') };
  let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  const candidate = (changes: Partial<NonNullable<QaRun['repair']>> = {}): NonNullable<QaRun['repair']> => ({
    mode: 'fix', round: 1, rootRunId: 'root', sourceRunId: 'root', retainedRunId: 'candidate',
    candidatePrompt: 'Private instructions <script>unsafe markup</script>', previousPrompt: 'Original instructions',
    changes: ['Respect privacy and the historical cutoff.'], baselineScore: 60,
    outcome: 'improved', noProgressCount: 0, canApply: true,
    comparison: { score: 100, previousScore: 60, passed: 5, total: 5, resolved: 2, regressions: [], checksPassed: 5, checksTotal: 5, allPassed: true },
    ...changes,
  });
  beforeEach(async () => {
    params = new BehaviorSubject(convertToParamMap({ boardId: 'b1', cardId: 'c1' }));
    service.command.calls.reset(); service.command.and.resolveTo(structuredClone(workspace));
    await TestBed.configureTestingModule({ imports: [AvatarQaComponent], providers: [provideZonelessChangeDetection(), provideRouter([]),
      { provide: ActivatedRoute, useValue: { paramMap: params } }, { provide: AvatarQaService, useValue: service },
      { provide: TeamsService, useFactory: teamsServiceStub },
      { provide: AuthService, useValue: { waitForReady: async () => {}, uid: signal('owner'), profile: signal({ preferredCitySlug: 'philly' }), isAuthenticated: signal(true), signOut: async () => {} } },
      { provide: AtlasService, useValue: { activeAtlasWikiLink: signal('/wiki/philly') } },
    ] }).compileComponents();
  });
  async function render(run: QaRun, options: Partial<QaWorkspace> = {}) {
    service.command.and.resolveTo({ ...workspace, selectedRun: run, runs: [run], attemptsRemaining: 8, ...options });
    const fixture = TestBed.createComponent(AvatarQaComponent); await fixture.whenStable(); fixture.detectChanges(); return fixture;
  }
  it('offers a single fix-and-retest action after a complete failed test', async () => {
    const fixture = await render(runFixture());
    expect(fixture.nativeElement.textContent).toContain('Fix & retest');
    expect(fixture.componentInstance.canRepair()).toBeTrue();
    service.command.and.callFake(async (_b: string, _c: string, action: string) => action === 'repair' ? { runId: 'draft' } : workspace);
    await fixture.componentInstance.repairAction('repair');
    expect(service.command.calls.allArgs().find(args => args[2] === 'repair')?.[3].runId).toBe('run1');
    expect(service.command.calls.allArgs().some(args => args[2] === 'applyRepair')).toBeFalse(); fixture.destroy();
  });
  it('separates original-question scores from extra checks and escapes generated instruction text', async () => {
    const fixture = await render(runFixture({ total: 10, completed: 10, passed: 10, failed: 0, repair: candidate() }));
    expect(fixture.componentInstance.score()).toBe(100);
    expect(fixture.nativeElement.textContent).toContain('5/5 additional checks passed');
    expect(fixture.nativeElement.textContent).toContain('Use improved version');
    expect(fixture.nativeElement.textContent).toContain('other cards connected to it');
    expect(fixture.nativeElement.querySelector('script')).toBeNull(); fixture.destroy();
  });
  it('cannot apply an apparent 100 original score when extra checks failed or a candidate regressed', async () => {
    const fixture = await render(runFixture({ total: 10, completed: 10, passed: 9, failed: 1,
      repair: candidate({ canApply: false, outcome: 'retained', comparison: { ...candidate().comparison, checksPassed: 4, allPassed: false } }) }));
    expect(fixture.componentInstance.score()).toBe(100);
    expect(fixture.nativeElement.textContent).not.toContain('Use improved version');
    expect(fixture.nativeElement.textContent).toContain('previous version has been kept');
    await fixture.componentInstance.repairAction('applyRepair');
    expect(service.command.calls.allArgs().some(args => args[2] === 'applyRepair')).toBeFalse(); fixture.destroy();
  });
  it('blocks stale changes, unavailable personas, quota exhaustion and three unproductive attempts', async () => {
    const fixture = await render(runFixture()), page = fixture.componentInstance;
    for (const change of [{ attemptsRemaining: 0 }, { repairUnavailableReason: 'Automatic persona' },
      { selectedRun: runFixture({ stale: true }) }, { selectedRun: runFixture({ repair: candidate({ noProgressCount: 3, canApply: false }), failed: 2 }) }]) {
      page.data.set({ ...workspace, selectedRun: runFixture(), runs: [], ...change });
      expect(page.canRepair()).toBeFalse(); await page.repairAction('repair');
    }
    expect(service.command.calls.allArgs().some(args => args[2] === 'repair')).toBeFalse(); fixture.destroy();
  });
  it('reuses uncertain repair request IDs and prevents double clicks while a request is pending', async () => {
    const fixture = await render(runFixture()), page = fixture.componentInstance;
    service.command.and.rejectWith(Object.assign(new Error('timeout'), { code: 'functions/deadline-exceeded' }));
    await page.repairAction('repair'); const first = service.command.calls.mostRecent().args[3].requestId;
    await page.repairAction('repair'); expect(service.command.calls.mostRecent().args[3].requestId).toBe(first);
    let finish!: (value: unknown) => void;
    service.command.and.callFake((_b: string, _c: string, action: string) => action === 'repair' ? new Promise(resolve => finish = resolve) : Promise.resolve(workspace));
    const pending = page.repairAction('repair'), before = service.command.calls.count();
    await page.repairAction('repair'); expect(service.command.calls.count()).toBe(before);
    params.next(convertToParamMap({ boardId: 'other', cardId: 'card' }));
    finish({ runId: 'draft' }); await pending; await fixture.whenStable();
    expect(page.run()).toBeNull(); expect(page.repairBusy()).toBe(''); fixture.destroy();
  });
  it('shows a recoverable apply failure and retains the candidate for retry', async () => {
    const run = runFixture({ total: 10, completed: 10, passed: 10, failed: 0, repair: candidate() });
    const fixture = await render(run), page = fixture.componentInstance;
    service.command.and.rejectWith(new Error('The avatar changed in another window.'));
    await page.repairAction('applyRepair');
    expect(page.error()).toContain('changed in another window'); expect(page.run()?.repair?.candidatePrompt).toBe(run.repair?.candidatePrompt);
    expect(page.repairBusy()).toBe(''); fixture.destroy();
  });
});
