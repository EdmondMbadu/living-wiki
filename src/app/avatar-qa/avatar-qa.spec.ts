import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { AuthService } from '../auth.service';
import { AtlasService } from '../atlas.service';
import { TeamsService } from '../teams/teams.service';
import { teamsServiceStub } from '../teams/teams.testing';
import { AvatarQaComponent } from './avatar-qa';
import { AvatarQaService, type QaWorkspace, type QaReference } from './avatar-qa.service';
import { previewQaImport } from './avatar-qa-import';
import gistExample from '../../../public/assets/avatar-qa/mordecai-gist-example.json';
import genericExample from '../../../public/assets/avatar-qa/avatar-qa-example.json';
const reference: QaReference = { id: 'AMD-001', question: 'A question?', expectedAnswer: 'Reference.', category: 'education', source: 'Answer key v1', approval: 'draft', approvedBy: '', approvedOn: '', followUps: [] };
const workspace: QaWorkspace = { target: { boardId: 'b1', cardId: 'c1', atlasId: 'a1', boardTitle: 'Wet AMD', avatarName: 'Maya Chen', openingMessage: 'Hello', personaPrompt: 'Reviewed educational guide', boardSlug: 'wet-amd' }, references: [reference], revision: 1, documents: [], runs: [], selectedRun: null };
describe('AvatarQaComponent', () => {
  const service = { command: jasmine.createSpy('command') };
  beforeEach(async () => {
    service.command.calls.reset(); service.command.and.resolveTo(structuredClone(workspace));
    await TestBed.configureTestingModule({ imports: [AvatarQaComponent], providers: [provideZonelessChangeDetection(), provideRouter([]),
      { provide: ActivatedRoute, useValue: { paramMap: new BehaviorSubject(convertToParamMap({ boardId: 'b1', cardId: 'c1' })) } },
      { provide: AvatarQaService, useValue: service },
      { provide: TeamsService, useFactory: teamsServiceStub },
      { provide: AuthService, useValue: { waitForReady: async () => {}, uid: signal('owner'), profile: signal({ preferredCitySlug: 'philly' }), isAuthenticated: signal(true), signOut: async () => {} } },
      { provide: AtlasService, useValue: { activeAtlasWikiLink: signal('/wiki/philly') } },
    ] }).compileComponents();
  });
  async function render() {
    const fixture = TestBed.createComponent(AvatarQaComponent); fixture.detectChanges(); await fixture.componentInstance.load(true); fixture.detectChanges(); return fixture;
  }
  it('keeps the real shared sidebar and logo, starts with empty measured results', async () => {
    const fixture = await render(), root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('app-workspace-sidebar')).not.toBeNull();
    expect(root.querySelector('.workspace-sidebar__brand img')?.getAttribute('src')).toBe('/assets/image/lucky-paper-crane.png');
    expect(root.querySelector('.qa-logo img')?.getAttribute('src')).toBe('/assets/image/livingwiki-brand.svg');
    expect(root.textContent).toContain('Maya Chen'); expect(root.textContent).toContain('No conversations tested yet');
    expect(root.textContent).not.toContain('98.3%'); expect(root.querySelector('.qa-badge')?.textContent).toContain('Not tested');
  });
  it('validates imported IDs and keeps draft edits separate until saved', async () => {
    const fixture = await render(), page = fixture.componentInstance;
    page.importText.set(JSON.stringify([{...reference,id:'AMD-002'}])); page.importJson();
    expect(page.references().length).toBe(2); expect(page.dirty()).toBeTrue();
    expect(service.command.calls.allArgs().some(args => args[2] === 'save')).toBeFalse();
    page.importText.set(JSON.stringify([reference])); page.importJson();
    expect(page.importPreview().error).toContain('already exists'); expect(page.references().length).toBe(2);
  });
  it('previews an uploaded example before adding unsaved entries, without saving or starting a run', async () => {
    const fixture = await render(), page = fixture.componentInstance;
    page.openImport(); fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('#qa-test-file') as HTMLInputElement;
    const transfer = new DataTransfer();
    transfer.items.add(new File([JSON.stringify(gistExample)], 'gist-tests.json', { type: 'application/json' }));
    input.files = transfer.files;
    await page.readFile({ target: input } as unknown as Event); fixture.detectChanges();
    expect(page.importPreview().entries.length).toBe(3);
    expect(page.importPreview().turns).toBe(4);
    expect(page.references().length).toBe(1);
    expect(page.dirty()).toBeFalse();
    expect(fixture.nativeElement.querySelector('.qa-import-preview')?.textContent).toContain('GIST-001');
    expect(input.value).toBe('');
    page.importJson(); fixture.detectChanges();
    expect(page.references().length).toBe(4);
    expect(page.dirty()).toBeTrue();
    expect(page.tab()).toBe('library');
    expect(page.importOpen()).toBeFalse();
    expect(page.notice()).toContain('save the library');
    expect(service.command.calls.allArgs().some(args => ['save','start'].includes(args[2]))).toBeFalse();
  });
  it('rejects invalid, oversized, and non-JSON files without changing the library', async () => {
    const fixture = await render(), page = fixture.componentInstance;
    page.openImport(); fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('#qa-test-file') as HTMLInputElement;
    for (const [file, message] of [
      [new File(['not JSON'], 'tests.json'), 'not valid JSON'],
      [new File([' '], 'empty.json'), 'empty'],
      [new File(['x'.repeat(500001)], 'large.json'), '500 KB'],
      [new File(['some text'], 'tests.txt'), '.json file'],
    ] as const) {
      const transfer = new DataTransfer(); transfer.items.add(file); input.files = transfer.files;
      await page.readFile({ target: input } as unknown as Event); fixture.detectChanges();
      expect(page.importError() || page.importPreview().error).toContain(message);
      expect(page.references().length).toBe(1);
      expect(page.dirty()).toBeFalse();
    }
  });
  it('keeps a closed upload closed when its file finishes reading later', async () => {
    const fixture = await render(), page = fixture.componentInstance;
    let finish!: (text: string) => void;
    const pending = new Promise<string>(resolve => { finish = resolve; });
    const file = new File(['pending'], 'tests.json');
    spyOn(file, 'text').and.returnValue(pending);
    page.openImport();
    const reading = page.readFile({ target: { files: [file], value: '' } } as unknown as Event);
    page.closeImport();
    finish(JSON.stringify(gistExample)); await reading;
    expect(page.importOpen()).toBeFalse(); expect(page.importText()).toBe(''); expect(page.importReading()).toBeFalse();
    expect(page.references().length).toBe(1);
  });
  it('shows the avatar-specific example and explains exact wording in an accessible modal', async () => {
    const fixture = await render(), page = fixture.componentInstance;
    page.data.set({ ...workspace, target: { ...workspace.target, avatarName: 'Major Mordecai Gist' } });
    fixture.detectChanges();
    const link = fixture.nativeElement.querySelector('.qa-starter a[download]') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/assets/avatar-qa/mordecai-gist-example.json');
    expect(link.download).toBe('mordecai-gist-example.json');
    const help = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(button => button.textContent?.includes('How to test'))!;
    help.click(); fixture.detectChanges();
    const dialog = fixture.nativeElement.querySelector('[aria-labelledby="qa-help-title"]') as HTMLElement;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.textContent).toContain('A correct paraphrase can fail');
    expect(page.dialogOpen()).toBeTrue();
    page.closeDialog(); fixture.detectChanges();
    expect(page.helpOpen()).toBeFalse(); expect(page.dialogOpen()).toBeFalse();
  });
  it('requires the synthetic-fixture acknowledgement and a saved suite before running', async () => {
    const fixture = await render(), page = fixture.componentInstance;
    page.openRun(); await page.start();
    expect(service.command.calls.allArgs().some(args => args[2] === 'start')).toBeFalse();
    page.syntheticConfirmed.set(true); page.dirty.set(true); await page.start();
    expect(service.command.calls.allArgs().some(args => args[2] === 'start')).toBeFalse();
  });
  it('reuses a start request after an ambiguous timeout and replaces it after an explicit rejection', async () => {
    const fixture = await render(), page = fixture.componentInstance;
    page.syntheticConfirmed.set(true);
    let code = 'functions/deadline-exceeded';
    service.command.and.callFake(async () => { throw Object.assign(new Error('Start failed'), { code }); });
    await page.start();
    const first = service.command.calls.mostRecent().args[3].requestId;
    code = 'functions/aborted'; await page.start();
    const second = service.command.calls.mostRecent().args[3].requestId;
    code = 'functions/deadline-exceeded'; await page.start();
    const third = service.command.calls.mostRecent().args[3].requestId;
    expect(first).toBe(second); expect(third).not.toBe(first);
  });
  it('keeps the correct logo visible when the shared sidebar is collapsed', async () => {
    const fixture = await render();
    fixture.componentInstance.navigation.toggleSidebar(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.qa-logo--visible')).not.toBeNull();
    fixture.componentInstance.navigation.toggleSidebar();
  });
  it('shows real failure evidence, error counts and retest state without clearing raw results', async () => {
    const fixture = await render(), page = fixture.componentInstance;
    const run = { id: 'run1', createdAt: '2026-10-15T12:00:00Z', status: 'completed', total: 2, completed: 2, passed: 0, failed: 1, errors: 1, critical: 1, cancelled: 0, fingerprint: 'hash', suiteHash: 'suite', protocol: 'exact-text-v1', references: [reference], reviews: [], results: [{ id: reference.id, referenceId: reference.id, category: 'education' as const, status: 'failed', critical: true, turns: [] }] };
    page.data.set({...workspace,selectedRun:run,runs:[run]}); fixture.detectChanges();
    expect(page.readiness()).toBe('Blocked'); expect(page.passRate()).toBe(0);
    page.data.set({...workspace,selectedRun:{...run,stale:true},runs:[run]});
    expect(page.readiness()).toBe('Retest required'); expect(page.run()?.failed).toBe(1);
  });
  it('renders protocol, history and answer library with working navigation', async () => {
    const fixture = await render(), page = fixture.componentInstance;
    for (const [tab, text] of [['library','Answer key v1'], ['protocol','What this run measures'], ['history','No runs saved yet.']] as const) {
      page.tab.set(tab); fixture.detectChanges(); expect(fixture.nativeElement.textContent).toContain(text);
    }
  });
});

describe('QA file contract', () => {
  it('ships valid draft example files with the advertised scenario and question counts', () => {
    const gist = previewQaImport(JSON.stringify(gistExample), []);
    const generic = previewQaImport(JSON.stringify(genericExample), []);
    expect(gist.error).toBe(''); expect(gist.entries.length).toBe(3); expect(gist.turns).toBe(4); expect(gist.drafts).toBe(3);
    expect(generic.error).toBe(''); expect(generic.entries.length).toBe(2); expect(generic.drafts).toBe(2);
  });
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
