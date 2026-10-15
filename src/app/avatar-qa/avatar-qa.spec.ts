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
    expect(page.error()).toContain('overlap'); expect(page.references().length).toBe(2);
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
