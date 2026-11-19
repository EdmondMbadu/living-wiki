import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { EventPlan } from '../../../functions/src/event-guide-model';
import { EventGuideGuest } from './event-guide-guest';
import { EventGuideService } from './event-guide.service';

describe('Event Guide itinerary and email', () => {
  it('offers highlights without inventing an itinerary, validates email and prevents duplicate sends', async () => {
    let accept!: (value: { sent: boolean }) => void;
    const events = { send: jasmine.createSpy('send').and.callFake(() => new Promise(resolve => { accept = resolve; })) };
    await TestBed.configureTestingModule({
      imports: [EventGuideGuest],
      providers: [provideZonelessChangeDetection(), { provide: EventGuideService, useValue: events }],
    }).compileComponents();
    const fixture = TestBed.createComponent(EventGuideGuest);
    fixture.componentRef.setInput('settings', { datasetId: 'a'.repeat(64), name: 'Event', startDate: '2027-01-05', endDate: '2027-01-06', timeZone: 'America/Los_Angeles', informationUrl: '', privacyUrl: 'https://example.org/privacy', travelMinutes: 30 });
    fixture.componentRef.setInput('language', 'en');
    fixture.componentRef.setInput('recapMode', true);
    fixture.componentRef.setInput('recap', { voiceSessions: ['call-1'], textSessions: [], anonymousVisitorId: 'visitor' });
    fixture.componentRef.setInput('sponsor', { name: 'Test Sponsor', message: 'Supported by Test Sponsor.' });
    fixture.componentRef.setInput('interrupted', true);
    fixture.detectChanges();
    await fixture.whenStable();
    const page = fixture.componentInstance;
    const dismissed = jasmine.createSpy('dismissed');
    page.dismissed.subscribe(dismissed);
    expect(fixture.nativeElement.textContent).toContain('Your call was interrupted');
    expect(fixture.nativeElement.textContent).toContain('Keep your conversation highlights.');
    expect(fixture.nativeElement.textContent).not.toContain('Your personalized itinerary');
    expect(fixture.nativeElement.querySelector('.event-guide__email-sponsor')?.textContent).toContain('Test Sponsor');
    expect(fixture.nativeElement.querySelector('a')?.getAttribute('href')).toBe('https://example.org/privacy');
    page.email.set('invalid');
    await page.send(new Event('submit'));
    expect(events.send).not.toHaveBeenCalled();
    expect(page.error()).toBe('Enter a valid email address.');
    page.email.set('guest@example.org');
    const pending = page.send(new Event('submit'));
    await page.send(new Event('submit'));
    fixture.detectChanges();
    expect(events.send).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.querySelector('.event-guide__email-skip').disabled).toBeTrue();
    await Promise.resolve();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('input').disabled).toBeTrue();
    accept({ sent: true });
    await pending;
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('guest@example.org');
    fixture.nativeElement.querySelector('.event-guide__email-skip').click();
    expect(dismissed).toHaveBeenCalledTimes(1);
  });

  it('keeps the recap email-only and retains the full itinerary on send failure and retry', async () => {
    const itinerary: EventPlan = {
      id: 'plan-id', key: 'private-key', warnings: [],
      days: [
        { date: '2027-01-05', attending: true, items: [{ start: 600, end: 640, kind: 'Session', title: 'Robotics demo', location: 'Hall A', url: '', note: '' }], alternatives: [] },
        { date: '2027-01-06', attending: false, items: [], alternatives: [] },
      ],
    };
    const events = { plan: jasmine.createSpy('plan').and.resolveTo(itinerary), send: jasmine.createSpy('send').and.rejectWith(new Error('Try again.')) };
    await TestBed.configureTestingModule({
      imports: [EventGuideGuest],
      providers: [provideZonelessChangeDetection(), { provide: EventGuideService, useValue: events }],
    }).compileComponents();
    const fixture = TestBed.createComponent(EventGuideGuest);
    const page = fixture.componentInstance;
    fixture.componentRef.setInput('boardId', 'board');
    fixture.componentRef.setInput('cardId', 'card');
    fixture.componentRef.setInput('language', 'en');
    fixture.componentRef.setInput('settings', {
      datasetId: 'a'.repeat(64), name: 'Event', startDate: '2027-01-05', endDate: '2027-01-06',
      timeZone: 'America/Los_Angeles', informationUrl: '', privacyUrl: '', travelMinutes: 30,
    });
    fixture.detectChanges();
    expect(await page.build()).toBeNull();
    expect(events.plan).not.toHaveBeenCalled();
    page.toggleDay('2027-01-05', true);
    await page.build();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Robotics demo');
    expect(fixture.nativeElement.textContent).toContain('Day off');
    page.email.set('guest@example.org');
    await page.send(new Event('submit'));
    expect(events.send).not.toHaveBeenCalled();
    fixture.componentRef.setInput('recapMode', true);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Robotics demo');
    expect(fixture.nativeElement.textContent).not.toContain('Day off');
    expect(fixture.nativeElement.querySelector('.event-guide__days')).toBeNull();
    expect(fixture.nativeElement.querySelector('.event-guide__source')).toBeNull();
    expect(fixture.nativeElement.querySelector('input[type="email"]')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Enter your email to receive your personalized itinerary and a link to view or edit it.');
    await page.send(new Event('submit'));
    expect(page.error()).toBe('Try again.');
    expect(page.plan()).toEqual(itinerary);
    events.send.and.resolveTo({ sent: true });
    await page.send(new Event('submit'));
    await page.send(new Event('submit'));
    expect(events.send.calls.count()).toBe(2);
    expect(events.send).toHaveBeenCalledWith({ boardId: 'board', cardId: 'card' }, itinerary, 'guest@example.org', 'en');
    expect(page.sent()).toBeTrue();
    expect(page.email()).toBe('');
    expect(page.sentTo()).toBe('guest@example.org');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="status"]')?.textContent).toContain('guest@example.org');
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Robotics demo');
  });

  it('loads the saved itinerary from the link and saves a removed stop without opening email', async () => {
    const settings = {
      datasetId: 'a'.repeat(64), name: 'Event', startDate: '2027-01-05', endDate: '2027-01-06',
      timeZone: 'America/Los_Angeles', informationUrl: '', privacyUrl: '', travelMinutes: 30,
    };
    const stop = { start: 600, end: 640, kind: 'Session' as const, title: 'Robotics demo', location: 'Hall A', url: '', note: '' };
    const day = { date: '2027-01-05', attending: true, items: [stop], alternatives: [] };
    const plan = { id: 'plan-id', key: 'edit-key', warnings: [], days: [day] };
    const preferences = { days: [day.date], interests: 'Robotics', mustSee: '', constraints: '', pace: 'curated' as const, firstTimer: false };
    const draft = { settings, language: 'en' as const, preferences, plan, revision: 0 };
    const updateItinerary = jasmine.createSpy('updateItinerary').and.resolveTo({
      ...draft, plan: { ...plan, days: [{ ...day, items: [] }] }, revision: 1,
    });
    await TestBed.configureTestingModule({
      imports: [EventGuideGuest],
      providers: [provideZonelessChangeDetection(), { provide: EventGuideService, useValue: { updateItinerary } }],
    }).compileComponents();
    const fixture = TestBed.createComponent(EventGuideGuest);
    fixture.componentRef.setInput('settings', settings);
    fixture.componentRef.setInput('language', 'en');
    fixture.componentRef.setInput('initialDraft', draft);
    fixture.detectChanges();
    const remove: HTMLButtonElement = fixture.nativeElement.querySelector('.event-guide__remove-stop');
    expect(fixture.nativeElement.textContent).toContain('Robotics demo');
    remove.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(updateItinerary).toHaveBeenCalledOnceWith(plan, 0, { remove: { date: day.date, index: 0 } });
    expect(fixture.nativeElement.textContent).not.toContain('Robotics demo');
    expect(fixture.nativeElement.textContent).toContain('Itinerary saved.');
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
  });
});
