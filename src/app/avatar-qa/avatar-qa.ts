import { DatePipe, isPlatformBrowser } from '@angular/common';
import { Component, DestroyRef, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../auth.service';
import { MobileMenuComponent } from '../mobile-menu/mobile-menu';
import { ThemeToggleComponent } from '../theme-toggle/theme-toggle';
import { AvatarQaService, type DirectQuestion, type QaResult, type QaWorkspace } from './avatar-qa.service';

const ACTIVE = ['generating', 'queued', 'running'];
const PROTOCOL = 'avatar-stress-v1';
const STRESS_RUNNING_NOTICE = 'Your stress test is running. You can leave this page and return to the results.';
const PRIVATE_RUNNING_NOTICE = 'Your private test is running. You can leave this page and return to the results.';

@Component({
  selector: 'app-avatar-qa', imports: [RouterLink, FormsModule, DatePipe, MobileMenuComponent, ThemeToggleComponent],
  templateUrl: './avatar-qa.html', styleUrl: './avatar-qa.css',
})
export class AvatarQaComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly auth = inject(AuthService);
  private readonly service = inject(AvatarQaService);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private boardId = '';
  private cardId = '';
  private epoch = 0;
  private loadSequence = 0;
  private questionSequence = 0;
  private disposed = false;
  private timer?: ReturnType<typeof setTimeout>;
  private selectedRunId = '';
  private startRequest = { key: '', id: '' };
  private askRequest = { key: '', id: '' };
  private repairRequest = { key: '', id: '' };
  private boundariesEdited = false;

  readonly data = signal<QaWorkspace | null>(null);
  readonly loading = signal(true);
  readonly refreshing = signal(false);
  readonly starting = signal(false);
  readonly asking = signal(false);
  readonly assessing = signal(false);
  readonly exporting = signal(false);
  readonly cancelling = signal(false);
  readonly repairBusy = signal('');
  readonly error = signal('');
  readonly questionError = signal('');
  readonly notice = signal('');
  readonly count = signal<number | null>(25);
  readonly customCount = signal<number | null>(null);
  readonly boundaries = signal('');
  readonly question = signal('');
  readonly direct = signal<DirectQuestion | null>(null);
  readonly showAll = signal(false);
  readonly filter = signal('all');
  readonly search = signal('');
  readonly historyOpen = signal(false);
  readonly presets = [10, 25, 50];
  readonly run = computed(() => this.data()?.selectedRun ?? null);
  readonly activeRun = computed(() => this.data()?.runs.find(r => ACTIVE.includes(r.status)) ?? null);
  readonly running = computed(() => ACTIVE.includes(this.run()?.status ?? ''));
  readonly legacy = computed(() => !!this.run() && this.run()?.protocol !== PROTOCOL);
  readonly validCount = computed(() => Number.isInteger(this.count()) && Number(this.count()) >= 1 && Number(this.count()) <= 50);
  readonly boardPath = computed(() => `/boards/${encodeURIComponent(this.data()?.target.boardSlug || this.boardId)}`);
  readonly avatarInitial = computed(() => (this.data()?.target.avatarName?.trim() || 'A').slice(0, 1).toUpperCase());
  readonly score = computed(() => {
    const run = this.run();
    return run && !this.legacy() && run.status === 'completed' && run.total > 0 && run.completed === run.total
      && run.passed + run.failed === run.total && !run.errors && !run.cancelled
      ? run.repair ? run.repair.comparison.score : Math.round(run.passed / run.total * 100) : null;
  });
  readonly canRepair = computed(() => {
    const run = this.run();
    return !!run && !this.legacy() && !run.stale && !run.configurationWarning && !this.activeRun() && !this.repairBusy()
      && this.data()?.attemptsRemaining !== 0 && !this.data()?.repairUnavailableReason
      && !run.repair?.appliedAt && (run.repair?.noProgressCount || 0) < 3
      && ((this.score() !== null && run.failed > 0) || !!run.repair && ['error', 'cancelled'].includes(run.status));
  });
  readonly canRetest = computed(() => !!this.run()?.repair?.candidatePrompt && this.run()?.status === 'completed'
    && !this.run()?.stale && !this.run()?.configurationWarning && !this.activeRun() && !this.repairBusy()
    && !this.run()?.repair?.restoredAt && this.data()?.attemptsRemaining !== 0);
  readonly results = computed(() => [...(this.run()?.results ?? [])].sort((a, b) =>
    Number(b.critical) - Number(a.critical) || Number(b.status === 'failed') - Number(a.status === 'failed') || a.id.localeCompare(b.id)));
  readonly attention = computed(() => this.results().filter(r => r.status !== 'passed'));
  readonly visibleResults = computed(() => {
    const values = this.showAll() ? this.results() : this.attention().slice(0, 3);
    return values.filter(r => (this.filter() === 'all' || r.status === this.filter())
      && `${this.resultQuestion(r)} ${r.turns.map(t => t.actualAnswer).join(' ')}`.toLowerCase().includes(this.search().toLowerCase()));
  });
  readonly status = computed(() => {
    const run = this.run();
    if (!run) return 'Not tested';
    if (run.status === 'generating') return 'Preparing questions';
    if (this.running()) return run.cancelRequested ? 'Stopping test' : 'Test in progress';
    if (run.configurationWarning) return 'Retest recommended';
    if (run.stale) return 'Avatar changed';
    if (run.repair?.restoredAt) return 'Previous instructions restored';
    if (run.repair?.appliedAt) return 'Improved version is live';
    if (run.repair?.retestRequired) return 'Retest required';
    if (run.repair?.canApply) return 'Ready to use';
    if (run.repair?.outcome === 'retained') return 'Previous version kept';
    if (this.legacy()) return 'Historical wording test';
    if (run.status === 'cancelled') return 'Test stopped';
    if (this.score() === null) return 'Incomplete assessment';
    return run.failed ? 'Needs review' : 'No issues found';
  });

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      this.epoch++; this.loadSequence++; this.questionSequence++;
      this.boardId = params.get('boardId') || ''; this.cardId = params.get('cardId') || '';
      this.selectedRunId = ''; this.startRequest = { key: '', id: '' }; this.askRequest = { key: '', id: '' };
      this.repairRequest = { key: '', id: '' }; this.repairBusy.set('');
      if (this.timer) clearTimeout(this.timer);
      this.data.set(null); this.direct.set(null); this.error.set(''); this.questionError.set(''); this.notice.set('');
      this.starting.set(false); this.asking.set(false); this.assessing.set(false); this.exporting.set(false); this.cancelling.set(false);
      this.boundaries.set(''); this.boundariesEdited = false; this.question.set(''); this.count.set(25); this.customCount.set(null);
      this.showAll.set(false); this.historyOpen.set(false); this.filter.set('all'); this.search.set('');
      if (this.browser) void this.load(true); else this.loading.set(false);
    });
    this.destroyRef.onDestroy(() => { this.disposed = true; this.epoch++; if (this.timer) clearTimeout(this.timer); });
  }

  canLeave(): boolean { return true; }
  private current(epoch: number): boolean { return !this.disposed && epoch === this.epoch; }

  async load(initial = false): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    const epoch = this.epoch, sequence = ++this.loadSequence, board = this.boardId, card = this.cardId;
    if (initial) this.loading.set(true); else this.refreshing.set(true);
    try {
      await this.auth.waitForReady();
      if (!this.current(epoch)) return;
      const data = await this.service.command<QaWorkspace>(board, card, 'load', this.selectedRunId ? { runId: this.selectedRunId } : {});
      if (!this.current(epoch) || sequence !== this.loadSequence) return;
      this.data.set(data);
      if (!this.activeRun() && [STRESS_RUNNING_NOTICE, PRIVATE_RUNNING_NOTICE].includes(this.notice())) this.notice.set('');
      if (!this.boundariesEdited) this.boundaries.set(data.boundaries || '');
      this.error.set('');
    } catch (error) {
      if (this.current(epoch) && sequence === this.loadSequence) this.error.set(this.message(error));
    } finally {
      if (this.current(epoch) && sequence === this.loadSequence) {
        this.loading.set(false); this.refreshing.set(false);
        if (this.activeRun()) this.timer = setTimeout(() => void this.load(), 5000);
      }
    }
  }

  chooseCount(value: number): void { this.count.set(value); this.customCount.set(null); }
  setCustomCount(value: number | null): void { this.customCount.set(value); this.count.set(value); }
  setBoundaries(value: string): void { this.boundariesEdited = true; this.boundaries.set(value); }

  async start(): Promise<void> {
    if (this.starting() || this.activeRun() || this.repairBusy() || this.data()?.attemptsRemaining === 0 || !this.validCount()) return;
    const epoch = this.epoch, count = this.count(), boundaries = this.boundaries().trim();
    const key = JSON.stringify([count, boundaries]);
    if (this.startRequest.key !== key) this.startRequest = { key, id: crypto.randomUUID() };
    this.starting.set(true); this.error.set(''); this.notice.set('');
    try {
      const response = await this.service.command<{ runId: string }>(this.boardId, this.cardId, 'startStress', { requestId: this.startRequest.id, count, boundaries });
      if (!this.current(epoch)) return;
      this.startRequest = { key: '', id: '' }; this.selectedRunId = response.runId;
      this.showAll.set(false); this.filter.set('all'); this.search.set('');
      await this.load();
      if (this.current(epoch) && this.running()) this.notice.set(STRESS_RUNNING_NOTICE);
    } catch (error) {
      if (this.current(epoch)) {
        this.error.set(this.message(error));
        if (!this.uncertain(error)) this.startRequest = { key: '', id: '' };
      }
    } finally { if (this.current(epoch)) this.starting.set(false); }
  }

  async ask(): Promise<void> {
    const question = this.question().trim(), boundaries = this.boundaries().trim();
    if (this.asking() || !question || question.length > 1000) return;
    const epoch = this.epoch, sequence = ++this.questionSequence;
    const key = JSON.stringify([question, boundaries]);
    if (this.askRequest.key !== key) this.askRequest = { key, id: crypto.randomUUID() };
    this.asking.set(true); this.assessing.set(false); this.direct.set(null); this.questionError.set('');
    try {
      const result = await this.service.command<DirectQuestion>(this.boardId, this.cardId, 'ask', { requestId: this.askRequest.id, question, boundaries });
      if (!this.current(epoch) || sequence !== this.questionSequence) return;
      this.direct.set(result); this.asking.set(false); this.askRequest = { key: '', id: '' };
      if (result.assessment || result.assessmentError) return;
      this.assessing.set(true);
      try {
        const assessed = await this.service.command<DirectQuestion>(this.boardId, this.cardId, 'assessQuestion', { questionId: result.id });
        if (this.current(epoch) && sequence === this.questionSequence) this.direct.set(assessed);
      } catch {
        if (this.current(epoch) && sequence === this.questionSequence) this.direct.set({ ...result, assessmentError: 'The answer is available, but its automated assessment could not be completed.' });
      }
    } catch (error) {
      if (this.current(epoch) && sequence === this.questionSequence) {
        this.questionError.set(this.message(error));
        if (!this.uncertain(error)) this.askRequest = { key: '', id: '' };
      }
    } finally {
      if (this.current(epoch) && sequence === this.questionSequence) { this.asking.set(false); this.assessing.set(false); }
    }
  }

  async selectRun(runId: string): Promise<void> {
    this.selectedRunId = runId; this.showAll.set(false); this.filter.set('all'); this.search.set('');
    await this.load();
  }
  async repairAction(action: 'repair' | 'retest' | 'applyRepair' | 'restoreRepair'): Promise<void> {
    const run = this.run();
    if (!run || this.repairBusy() || this.activeRun()) return;
    if (action === 'repair' && !this.canRepair() || action === 'retest' && !this.canRetest()) return;
    if (action === 'applyRepair' && (!run.repair?.canApply || run.stale || run.configurationWarning)) return;
    if (action === 'restoreRepair' && (!run.repair?.appliedAt || run.repair.restoredAt || run.stale || run.configurationWarning)) return;
    const epoch = this.epoch, board = this.boardId, card = this.cardId, key = `${action}:${run.id}`;
    if (this.repairRequest.key !== key) this.repairRequest = { key, id: crypto.randomUUID() };
    this.repairBusy.set(action); this.error.set(''); this.notice.set('');
    try {
      const response = await this.service.command<{ runId?: string }>(board, card, action,
        { runId: run.id, requestId: this.repairRequest.id });
      if (!this.current(epoch)) return;
      this.repairRequest = { key: '', id: '' };
      if (this.run()?.id !== run.id) return;
      if (response.runId) { this.selectedRunId = response.runId; this.showAll.set(false); this.filter.set('all'); this.search.set(''); }
      await this.load();
      if (this.current(epoch)) this.notice.set(action === 'applyRepair' ? 'The tested instructions are now live for this avatar.'
        : action === 'restoreRepair' ? 'The previous instructions have been restored.'
        : this.running() ? PRIVATE_RUNNING_NOTICE : '');
    } catch (error) {
      if (this.current(epoch)) { this.error.set(this.message(error)); if (!this.uncertain(error)) this.repairRequest = { key: '', id: '' }; }
    } finally { if (this.current(epoch)) this.repairBusy.set(''); }
  }
  async cancel(): Promise<void> {
    if (!this.run() || this.cancelling()) return;
    const epoch = this.epoch;
    this.cancelling.set(true); this.error.set('');
    try {
      await this.service.command(this.boardId, this.cardId, 'cancel', { runId: this.run()!.id });
      if (this.current(epoch)) await this.load();
    } catch (error) { if (this.current(epoch)) this.error.set(this.message(error)); }
    finally { if (this.current(epoch)) this.cancelling.set(false); }
  }
  async exportReport(): Promise<void> {
    if (!this.run() || this.running() || this.exporting()) return;
    const epoch = this.epoch;
    this.exporting.set(true); this.error.set(''); this.notice.set('');
    try {
      const report = await this.service.command<{ base64: string; filename: string }>(this.boardId, this.cardId, 'report', { runId: this.run()!.id });
      if (!this.current(epoch)) return;
      const bytes = Uint8Array.from(atob(report.base64), c => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const link = document.createElement('a'); link.href = url; link.download = report.filename;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      this.notice.set('Your PDF report has been downloaded.');
    } catch (error) { if (this.current(epoch)) this.error.set(this.message(error)); }
    finally { if (this.current(epoch)) this.exporting.set(false); }
  }

  resultQuestion(result: QaResult): string { return result.turns[0]?.question || this.run()?.references.find(q => q.id === result.id)?.question || 'Question unavailable'; }
  resultTitle(result: QaResult): string { return result.turns[0]?.title || (result.status === 'passed' ? 'Handled appropriately' : result.status === 'failed' ? 'Response needs review' : result.status === 'cancelled' ? 'Question cancelled' : 'Could not assess'); }
  resultLabel(result: QaResult): string { return result.status === 'passed' ? 'Passed' : result.status === 'failed' ? result.critical ? 'High priority' : 'Needs review' : result.status === 'cancelled' ? 'Cancelled' : 'Could not assess'; }
  toggleAll(): void { this.showAll.update(value => !value); this.filter.set('all'); this.search.set(''); }
  private uncertain(error: unknown): boolean {
    if ((error as { details?: { attemptFinished?: boolean } })?.details?.attemptFinished) return false;
    return ['functions/unavailable', 'functions/deadline-exceeded', 'functions/internal', 'unavailable'].includes(String((error as { code?: string })?.code || ''));
  }
  private message(error: unknown): string {
    return (error instanceof Error ? error.message : String(error)).replace(/^FirebaseError:\s*/, '') || 'Something went wrong. Please try again.';
  }
}
