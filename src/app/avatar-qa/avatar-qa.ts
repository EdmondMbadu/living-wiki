import { DatePipe, DecimalPipe, JsonPipe, isPlatformBrowser } from '@angular/common';
import { Component, DestroyRef, HostListener, PLATFORM_ID, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../auth.service';
import { WorkspaceSidebarComponent } from '../workspace-sidebar/workspace-sidebar';
import { MobileMenuComponent } from '../mobile-menu/mobile-menu';
import { WorkspaceNavigationService } from '../workspace-navigation/workspace-navigation';
import { ThemeToggleComponent } from '../theme-toggle/theme-toggle';
import { AvatarQaService, type QaWorkspace, type QaReference, type QaResult, type QaCategory } from './avatar-qa.service';

type Tab = 'overview' | 'conversations' | 'library' | 'protocol' | 'history';
@Component({
  selector: 'app-avatar-qa', imports: [RouterLink, FormsModule, DatePipe, DecimalPipe, JsonPipe, JsonPipe, WorkspaceSidebarComponent, MobileMenuComponent, ThemeToggleComponent],
  templateUrl: './avatar-qa.html', styleUrl: './avatar-qa.css',
})
export class AvatarQaComponent {
  readonly navigation = inject(WorkspaceNavigationService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly auth = inject(AuthService);
  private readonly service = inject(AvatarQaService);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private boardId = '';
  private cardId = '';
  private sequence = 0;
  private operation = 0;
  private disposed = false;
  private timer?: ReturnType<typeof setTimeout>;
  private selectedRunId = '';
  private startRequestId = '';
  private commandErrorCode = '';
  readonly data = signal<QaWorkspace | null>(null);
  readonly loading = signal(true);
  readonly refreshing = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly tab = signal<Tab>('overview');
  readonly filter = signal('all');
  readonly search = signal('');
  readonly editing = signal(false);
  readonly selectedResult = signal<QaResult | null>(null);
  readonly references = signal<QaReference[]>([]);
  readonly dirty = signal(false);
  readonly importText = signal('');
  readonly importOpen = signal(false);
  readonly selectedDocument = signal('');
  readonly runSetup = signal(false);
  readonly syntheticConfirmed = signal(false);
  reviewNote = '';
  reviewDecision = 'confirmed';
  form = this.emptyReference();
  originalId = '';
  followUpsJson = '[]';
  readonly categories: QaCategory[] = ['education', 'boundary', 'urgent', 'emergency'];
  readonly tabs: Array<{ id: Tab; label: string; icon: string }> = [
    { id: 'overview', label: 'Overview', icon: 'space_dashboard' },
    { id: 'conversations', label: 'Test conversations', icon: 'forum' },
    { id: 'library', label: 'Answer library', icon: 'menu_book' },
    { id: 'protocol', label: 'Test protocol', icon: 'fact_check' },
    { id: 'history', label: 'Run history', icon: 'history' },
  ];
  readonly run = computed(() => this.data()?.selectedRun ?? null);
  readonly running = computed(() => ['queued', 'running'].includes(this.run()?.status ?? ''));
  readonly anyRunning = computed(() => this.data()?.runs.some(r => ['queued', 'running'].includes(r.status)) ?? false);
  readonly boardPath = computed(() => `/boards/${encodeURIComponent(this.data()?.target.boardSlug || this.boardId)}`);
  readonly passRate = computed(() => { const r = this.run(); return r?.total ? r.passed / r.total * 100 : 0; });
  readonly results = computed(() => [...(this.run()?.results ?? [])].sort((a, b) => Number(b.critical) - Number(a.critical) || a.id.localeCompare(b.id)));
  readonly exceptions = computed(() => this.results().filter(r => r.status !== 'passed'));
  readonly filtered = computed(() => this.results().filter(r =>
    (this.filter() === 'all' || this.filter() === 'critical' && r.critical || r.status === this.filter())
    && `${r.id} ${r.turns.map(t => t.question).join(' ')}`.toLowerCase().includes(this.search().toLowerCase())));
  readonly coverage = computed(() => this.categories.map(category => {
    const results = this.results().filter(r => r.category === category);
    return { category, total: (this.run()?.references ?? []).filter(r => r.category === category).length,
      passed: results.filter(r => r.status === 'passed').length, failed: results.filter(r => r.status === 'failed').length };
  }));
  readonly referenceCoverage = computed(() => this.results().filter(r => r.turns.length > 0).length);
  readonly readiness = computed(() => {
    const r = this.run();
    if (!r) return 'Not tested';
    if (this.running()) return r.cancelRequested ? 'Cancelling' : 'In progress';
    if (r.stale || this.dirty()) return 'Retest required';
    if (r.failed || r.errors || r.cancelled || r.completed !== r.total || r.references.some(x => x.approval !== 'approved')) return 'Blocked';
    return 'Ready for human review';
  });
  readonly resultReviews = computed(() => this.run()?.reviews.filter(r => r.resultId === this.selectedResult()?.id) ?? []);
  readonly dialogOpen = computed(() => this.editing() || this.runSetup() || !!this.selectedResult());
  readonly failedCount = computed(() => this.run()?.failed ?? 0);

  constructor() {
    let previousFocus: HTMLElement | null = null;
    let previousOverflow = '';
    effect(onCleanup => {
      const open = this.dialogOpen();
      if (!this.browser) return;
      if (open) {
        previousFocus = document.activeElement as HTMLElement;
        previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const focusTimer = setTimeout(() => document.querySelector<HTMLElement>('.qa-dialog')?.focus(), 0);
        onCleanup(() => { clearTimeout(focusTimer); document.body.style.overflow = previousOverflow; });
      } else previousFocus?.focus();
    });
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      this.boardId = params.get('boardId') || ''; this.cardId = params.get('cardId') || '';
      this.sequence++; this.operation++; this.selectedRunId = ''; this.startRequestId = '';
      this.data.set(null); this.references.set([]); this.dirty.set(false); this.busy.set(false);
      this.notice.set(''); this.error.set(''); this.editing.set(false); this.selectedResult.set(null); this.runSetup.set(false);
      this.tab.set('overview'); this.search.set(''); this.filter.set('all');
      if (this.timer) clearTimeout(this.timer);
      if (this.browser) void this.load(true); else this.loading.set(false);
    });
    this.destroyRef.onDestroy(() => { this.disposed = true; this.sequence++; if (this.timer) clearTimeout(this.timer); });
  }
  @HostListener('window:beforeunload', ['$event'])
  beforeUnload(event: BeforeUnloadEvent): void { if (this.dirty()) { event.preventDefault(); event.returnValue = ''; } }
  canLeave(): boolean { return (!this.dirty() && !this.editing()) || !this.browser || window.confirm('Leave without saving your answer-library changes?'); }
  @HostListener('document:keydown', ['$event'])
  trapDialogFocus(event: KeyboardEvent): void {
    if (event.key !== 'Tab' || !this.dialogOpen()) return;
    const dialog = document.querySelector<HTMLElement>('.qa-dialog');
    const elements = Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]') ?? []).filter(e => e.getClientRects().length);
    const first = elements[0], last = elements.at(-1);
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) { event.preventDefault(); first?.focus(); }
  }
  @HostListener('document:keydown.escape') closeDialog(): void { this.selectedResult.set(null); this.editing.set(false); this.runSetup.set(false); }
  emptyReference(): QaReference { return { id: '', question: '', expectedAnswer: '', category: 'education', source: '', approval: 'draft', approvedBy: '', approvedOn: '', followUps: [] }; }
  async load(initial = false): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    const sequence = ++this.sequence;
    if (initial) this.loading.set(true); else this.refreshing.set(true);
    try {
      await this.auth.waitForReady();
      const data = await this.service.command<QaWorkspace>(this.boardId, this.cardId, 'load', this.selectedRunId ? { runId: this.selectedRunId } : {});
      if (sequence !== this.sequence || this.disposed) return;
      this.data.set(data);
      if (!this.dirty()) this.references.set(data.references);
      if (this.selectedResult()) this.selectedResult.set(data.selectedRun?.results.find(r => r.id === this.selectedResult()!.id) ?? null);
      this.error.set('');
    } catch (error) { if (sequence === this.sequence) this.error.set(this.message(error)); }
    finally {
      if (sequence === this.sequence && !this.disposed) {
        this.loading.set(false); this.refreshing.set(false);
        if (this.anyRunning()) this.timer = setTimeout(() => void this.load(), 8000);
      }
    }
  }
  async act<T>(action: string, options: Record<string, unknown> = {}): Promise<T | null> {
    if (this.busy()) return null;
    const operation = ++this.operation;
    this.commandErrorCode = '';
    this.busy.set(true); this.error.set(''); this.notice.set('');
    try {
      const result = await this.service.command<T>(this.boardId, this.cardId, action, options);
      return operation === this.operation && !this.disposed ? result : null;
    }
    catch (error) {
      if (operation === this.operation && !this.disposed) {
        this.commandErrorCode = String((error as { code?: unknown })?.code ?? '');
        this.error.set(this.message(error));
      }
      return null;
    }
    finally { if (operation === this.operation && !this.disposed) this.busy.set(false); }
  }
  async save(): Promise<boolean> {
    const result = await this.act('save', { references: this.references(), revision: this.data()?.revision ?? 0 });
    if (!result) return false;
    this.dirty.set(false); await this.load(); this.notice.set('Answer library saved. Existing run evidence is preserved.'); return true;
  }
  edit(reference?: QaReference): void {
    this.originalId = reference?.id || ''; this.form = reference ? structuredClone(reference) : this.emptyReference();
    if (!reference) this.form.id = `REF-${String(this.references().length + 1).padStart(3, '0')}`;
    this.followUpsJson = JSON.stringify(this.form.followUps, null, 2); this.editing.set(true); this.error.set('');
  }
  applyEntry(): void {
    try {
      const entry = { ...this.form, followUps: JSON.parse(this.followUpsJson) };
      this.validateEntries([entry]);
      if (this.references().some(r => r.id === entry.id && r.id !== this.originalId)) throw new Error('Reference IDs must be unique.');
      this.references.update(items => this.originalId ? items.map(r => r.id === this.originalId ? entry : r) : [...items, entry]);
      this.dirty.set(true); this.editing.set(false);
    } catch (error) { this.error.set(this.message(error)); }
  }
  remove(reference: QaReference): void { this.references.update(items => items.filter(r => r.id !== reference.id)); this.dirty.set(true); }
  async discard(): Promise<void> { this.dirty.set(false); await this.load(); }
  validateEntries(entries: QaReference[]): void {
    if (!Array.isArray(entries) || entries.length > 100) throw new Error('Provide a JSON array of up to 100 entries.');
    const ids = new Set<string>();
    for (const e of entries) {
      if (!e || !/^[A-Za-z0-9_-]{1,80}$/.test(e.id) || ids.has(e.id)) throw new Error('Every entry needs a unique ID using letters, numbers, hyphens, or underscores.');
      ids.add(e.id);
      if (!['draft', 'approved'].includes(e.approval)) throw new Error('Choose draft or approved for every source approval status.');
      if (!e.question?.trim() || !e.expectedAnswer?.trim() || !e.source?.trim() || !this.categories.includes(e.category)) throw new Error('Each entry requires a question, reference answer, category, and source.');
      if (!Array.isArray(e.followUps) || e.followUps.length > 4 || e.followUps.some(t => !t.question?.trim() || !t.expectedAnswer?.trim())) throw new Error('Add at most four valid follow-up turns.');
      if (e.approval === 'approved' && (!e.approvedBy?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(e.approvedOn))) throw new Error('Record the approver and date for approved entries.');
    }
  }
  importJson(): void {
    try {
      const value = JSON.parse(this.importText());
      if (!Array.isArray(value)) throw new Error('Provide a JSON array.');
      const entries = value.map((e: QaReference) => ({ ...this.emptyReference(), ...e }));
      this.mergeImports(entries); this.importOpen.set(false); this.importText.set('');
    } catch (error) { this.error.set(this.message(error)); }
  }
  mergeImports(entries: QaReference[]): void {
    this.validateEntries(entries);
    if (entries.some(e => this.references().some(r => r.id === e.id))) throw new Error('Imported IDs overlap existing entries. Rename the IDs before importing.');
    this.validateEntries([...this.references(), ...entries]);
    this.references.update(current => [...current, ...entries]); this.dirty.set(true);
    this.notice.set('Entries added as local edits. Review wording and categories, then save the library.');
  }
  async importDocument(): Promise<void> {
    const response = await this.act<{ references: QaReference[] }>('importDocument', { documentId: this.selectedDocument() });
    if (response) { try { this.mergeImports(response.references); } catch (error) { this.error.set(this.message(error)); } }
  }
  async readFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement, file = input.files?.[0];
    if (!file) return;
    if (file.size > 500000) { this.error.set('Choose a JSON file smaller than 500 KB.'); input.value = ''; return; }
    try { this.importText.set(await file.text()); this.importOpen.set(true); }
    catch (error) { this.error.set(this.message(error)); }
    finally { input.value = ''; }
  }
  template(): void { this.download('avatar-qa-answer-key-template.json', JSON.stringify([{ ...this.emptyReference(), id: 'REF-001', question: 'Your test question', expectedAnswer: 'The exact reviewed response.', source: 'Answer key v1.0 · entry 1' }], null, 2), 'application/json'); }
  openRun(): void { this.syntheticConfirmed.set(false); this.runSetup.set(true); }
  async start(): Promise<void> {
    if (!this.syntheticConfirmed() || this.dirty() || this.anyRunning() || !this.references().length) return;
    this.startRequestId ||= crypto.randomUUID();
    const result = await this.act<{ runId: string }>('start', { requestId: this.startRequestId });
    if (!result) {
      if (['functions/aborted', 'functions/already-exists', 'functions/failed-precondition', 'functions/resource-exhausted', 'functions/permission-denied'].includes(this.commandErrorCode)) this.startRequestId = '';
      return;
    }
    this.startRequestId = ''; this.selectedRunId = result.runId; this.runSetup.set(false); this.tab.set('overview'); await this.load();
  }
  async selectRun(runId: string): Promise<void> { this.selectedRunId = runId; this.selectedResult.set(null); this.filter.set('all'); await this.load(); }
  async cancel(): Promise<void> { if (await this.act('cancel', { runId: this.run()?.id })) await this.load(); }
  openResult(result: QaResult): void { this.selectedResult.set(result); this.reviewNote = ''; this.reviewDecision = 'confirmed'; }
  async review(): Promise<void> {
    if (await this.act('review', { runId: this.run()?.id, resultId: this.selectedResult()?.id, decision: this.reviewDecision, note: this.reviewNote })) { this.reviewNote = ''; await this.load(); }
  }
  async exportEvidence(format: 'json' | 'csv' = 'json'): Promise<void> {
    const evidence = await this.act<Record<string, unknown>>('export', { runId: this.run()?.id });
    if (!evidence) return;
    if (format === 'json') {
      this.download(`avatar-qa-${this.run()!.id.slice(0, 12)}.json`, JSON.stringify(evidence, null, 2), 'application/json');
      this.notice.set('JSON evidence exported.'); return;
    }
    const rows = [['Conversation', 'Turn', 'Question', 'Expected answer', 'Actual answer', 'Answer mode', 'Result', 'Critical', 'Reason']];
    for (const result of evidence['results'] as QaResult[]) {
      if (!result.turns.length) rows.push([result.id, '', '', '', '', '', result.status, String(result.critical), result.error || '']);
      result.turns.forEach((t, i) => rows.push([result.id, String(i + 1), t.question, t.expectedAnswer, t.actualAnswer, t.answerMode, t.status, String(t.critical), t.reason]));
    }
    const cell = (s: string) => `"${(/^[\s=+@-]/.test(s) ? "'" : '') + s.replace(/"/g, '""')}"`;
    this.download(`avatar-qa-${this.run()!.id.slice(0, 12)}.csv`, rows.map(row => row.map(cell).join(',')).join('\r\n'), 'text/csv');
    this.notice.set('CSV conversation results exported.');
  }
  private download(name: string, content: string, type: string): void {
    const url = URL.createObjectURL(new Blob([content], { type })); const link = document.createElement('a');
    link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  private message(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return /not-found|NOT_FOUND|internal/i.test(message) && !this.data()
      ? 'Avatar QA could not be loaded. Verify your avatar permissions and that the QA backend is deployed, then retry.'
      : message.replace(/^FirebaseError:\s*/, '');
  }
}
