import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { EventImportResult } from '../../../functions/src/event-guide-model';
import { EventGuideSetup } from './event-guide-setup';
import { EventGuideService } from './event-guide.service';

describe('Event Guide source review', () => {
  it('previews an upload before adopting it and preserves accepted records after a failed replacement', async () => {
    const preview: EventImportResult = {
      sessions: [{ id: 'one', date: '2027-01-05', start: 600, end: 640, title: 'Robotics demo',
        room: 'Hall A', venue: 'Hall A', topics: '', kind: 'Session', url: '', access: '', note: '' }],
      exhibitors: [], floorHours: [], warnings: [], sheet: 'Program', sheets: ['Readme', 'Program'],
      columns: ['Talk', 'Day', 'Starts', 'Ends'],
    };
    const events = { preview: jasmine.createSpy('preview').and.resolveTo(preview) };
    await TestBed.configureTestingModule({
      imports: [EventGuideSetup],
      providers: [provideZonelessChangeDetection(), { provide: EventGuideService, useValue: events }],
    }).compileComponents();
    const fixture = TestBed.createComponent(EventGuideSetup);
    const page = fixture.componentInstance;
    fixture.componentRef.setInput('boardId', 'board');
    fixture.componentRef.setInput('dataset', {});
    fixture.componentRef.setInput('settings', {
      datasetId: '', name: 'Test Event', startDate: '', endDate: '', timeZone: 'UTC',
      informationUrl: '', privacyUrl: '', travelMinutes: 30,
    });
    fixture.detectChanges();
    const file = new File(['test'], 'agenda.xlsx');
    const element: HTMLInputElement = fixture.nativeElement.querySelector('input[type=file]');
    const files = new DataTransfer();
    files.items.add(file);
    element.files = files.files;
    element.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(page.dataset().sessions).toBeUndefined();
    expect(fixture.nativeElement.textContent).toContain('Robotics demo');
    page.setMapping('schedule', 'title', 'Talk');
    page.applyMapping('schedule');
    await fixture.whenStable();
    expect(events.preview).toHaveBeenCalledWith('board', 'schedule', file, '', 'Program', { title: 'Talk' });
    page.accept('schedule');
    expect(page.dataset().sessions).toEqual(preview.sessions);
    expect(page.settings().startDate).toBe('2027-01-05');

    events.preview.and.rejectWith(new Error('Unreadable workbook'));
    const replacement = new File(['replacement'], 'replacement.xlsx');
    const replacementFiles = new DataTransfer();
    replacementFiles.items.add(replacement);
    fixture.detectChanges();
    element.files = replacementFiles.files;
    element.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(events.preview).toHaveBeenCalledWith('board', 'schedule', replacement, '2027-01-05', '', {});
    expect(page.error()).toBe('Unreadable workbook');
    expect(page.dataset().sessions).toEqual(preview.sessions);
  });

  it('adds, edits, and removes a manual session alongside a published session', async () => {
    const publishedSession = {
      id: 'published', date: '2027-01-05', start: 600, end: 640, title: 'Opening keynote',
      room: 'Hall A', venue: 'Hall A', topics: '', kind: 'Keynote', url: '', access: '', note: '',
    };
    const events = { readOrganizerRecords: jasmine.createSpy('readOrganizerRecords').and.resolveTo({
      sessions: [publishedSession], exhibitors: [], floorHours: [],
    }) };
    await TestBed.configureTestingModule({
      imports: [EventGuideSetup],
      providers: [provideZonelessChangeDetection(), { provide: EventGuideService, useValue: events }],
    }).compileComponents();
    const fixture = TestBed.createComponent(EventGuideSetup);
    fixture.componentRef.setInput('boardId', 'board');
    fixture.componentRef.setInput('cardId', 'card');
    fixture.componentRef.setInput('dataset', {});
    fixture.componentRef.setInput('settings', {
      datasetId: 'a'.repeat(64), name: 'Test Event', startDate: '2027-01-05', endDate: '2027-01-05', timeZone: 'UTC',
      informationUrl: '', privacyUrl: '', travelMinutes: 30,
    });
    fixture.detectChanges();
    await fixture.whenStable();
    const page = fixture.componentInstance;
    expect(events.readOrganizerRecords).toHaveBeenCalledOnceWith({ boardId: 'board', cardId: 'card' });
    expect(page.sessions().length).toBe(1);
    page.openSession();
    page.updateSession('title', 'Late showcase');
    page.updateSession('date', '2027-01-06');
    page.updateSession('start', '23:00');
    page.updateSession('end', '22:00');
    page.saveManual();
    expect(page.manualError()).toContain('end time after the start');
    expect(page.dataset().sessions).toBeUndefined();

    page.updateSession('end', '00:00');
    page.saveManual();
    const added = page.sessions().at(-1)!;
    expect(added.end).toBe(1440);
    expect(page.sessions()[0]).toEqual(jasmine.objectContaining(publishedSession));
    expect(page.settings().endDate).toBe('2027-01-06');

    page.openSession(added);
    page.updateSession('title', 'Evening showcase');
    page.saveManual();
    expect(page.sessions().at(-1)?.title).toBe('Evening showcase');
    expect(page.sessions().length).toBe(2);
    page.openSession(page.sessions()[1]);
    page.removeManual();
    expect(page.sessions().length).toBe(1);

    page.openExhibitor();
    page.updateExhibitor('name', 'Robotics Co');
    page.updateExhibitor('status', 'booth');
    page.saveManual();
    expect(page.manualError()).toContain('confirmed location');
    page.updateExhibitor('location', 'Booth 105');
    page.saveManual();
    expect(page.dataset().exhibitors?.[0]).toEqual(jasmine.objectContaining({ name: 'Robotics Co', location: 'Booth 105' }));
  });
});
