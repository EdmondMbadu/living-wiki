import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { NgForm } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../auth.service';
import { TalkThruBillingService } from '../talkthru-billing/talkthru-billing.service';
import { TeamsService } from '../teams/teams.service';
import { TalkThrusComponent } from './talkthrus';

describe('TalkThrus landing page', () => {
  let fixture: ComponentFixture<TalkThrusComponent>;
  let component: TalkThrusComponent;
  let auth: { waitForReady: jasmine.Spy; isAuthenticated: jasmine.Spy };
  let router: { navigate: jasmine.Spy; navigateByUrl: jasmine.Spy };
  let billing: { rememberPlanIntent: jasmine.Spy; startCheckout: jasmine.Spy; redirecting: jasmine.Spy; ensureStatus: jasmine.Spy; prompt: jasmine.Spy };
  let teams: { activeMemberships: jasmine.Spy; memberships: jasmine.Spy };
  const validForm = { invalid: false } as NgForm;

  beforeEach(async () => {
    auth = { waitForReady: jasmine.createSpy().and.resolveTo(), isAuthenticated: jasmine.createSpy().and.returnValue(false) };
    router = { navigate: jasmine.createSpy().and.resolveTo(true), navigateByUrl: jasmine.createSpy().and.resolveTo(true) };
    billing = {
      rememberPlanIntent: jasmine.createSpy(), startCheckout: jasmine.createSpy().and.resolveTo(),
      redirecting: jasmine.createSpy().and.returnValue(false), ensureStatus: jasmine.createSpy().and.resolveTo({ activeLimit: 1, activeCount: 0 }), prompt: jasmine.createSpy(),
    };
    teams = { activeMemberships: jasmine.createSpy().and.returnValue([]), memberships: jasmine.createSpy().and.returnValue([]) };
    await TestBed.configureTestingModule({ imports: [TalkThrusComponent], providers: [provideZonelessChangeDetection(),
      { provide: AuthService, useValue: auth }, { provide: Router, useValue: router },
      { provide: TalkThruBillingService, useValue: billing }, { provide: TeamsService, useValue: teams },
    ] }).compileComponents();
    fixture = TestBed.createComponent(TalkThrusComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('updates all recurring prices while Done For You stays per listing', () => {
    component.cycle.set('annual');
    fixture.detectChanges();
    const prices = [...fixture.nativeElement.querySelectorAll('.plan-price')].map((node: any) => node.textContent);
    expect(prices).toEqual(['$190/yr', '$390/yr', '$199/listing', '$250/agent/yr']);
    expect(component.teamTiers().second).toBe('$190');
  });

  it('keeps paid signup tied to the chosen plan and billing cycle', async () => {
    component.cycle.set('annual');
    await component.subscribe('pro');
    expect(billing.rememberPlanIntent).toHaveBeenCalledWith('pro');
    expect(router.navigate).toHaveBeenCalledWith(['/create-account'], { queryParams: { redirectTo: '/talkthrus/billing?checkout=pro&cycle=annual' } });
    expect(billing.startCheckout).not.toHaveBeenCalled();
  });

  it('sends signed-in subscribers through the existing checkout', async () => {
    auth.isAuthenticated.and.returnValue(true);
    await component.subscribe('solo');
    expect(billing.startCheckout).toHaveBeenCalledWith({ plan: 'solo', billingCycle: 'monthly', returnPath: '/boards?create=real-estate' });
    expect(router.navigateByUrl).toHaveBeenCalledWith('/boards?create=real-estate');
  });

  it('offers a plan when a free account reaches its listing limit', async () => {
    auth.isAuthenticated.and.returnValue(true);
    billing.ensureStatus.and.resolveTo({ activeLimit: 1, activeCount: 1 });
    await component.tryFree();
    expect(billing.prompt).toHaveBeenCalledWith({ reason: 'listing_limit', returnPath: '/boards?create=real-estate', preferredCycle: 'monthly' });
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('keeps the team checkout context for an existing administrator', async () => {
    auth.isAuthenticated.and.returnValue(true);
    teams.activeMemberships.and.returnValue([{ role: 'admin', teamId: 'test-team' }]);
    component.cycle.set('annual');
    await component.startTeam();
    expect(router.navigate).toHaveBeenCalledWith(['/teams', 'test-team'], { queryParams: { plan: 'team', cycle: 'annual' } });
  });

  it('shows recoverable free and team action failures', async () => {
    auth.waitForReady.and.rejectWith(new Error('offline'));
    await component.tryFree();
    expect(component.ctaError()).toBeTruthy();
    expect(component.ctaBusy()).toBe('');
    await component.startTeam();
    expect(component.ctaError()).toBeTruthy();
    expect(component.ctaBusy()).toBe('');
  });

  it('selects the booked service and founding city from their buttons', () => {
    fixture.nativeElement.addEventListener('click', (event: Event) => event.preventDefault());
    fixture.nativeElement.querySelector('.done-for-you a').click();
    expect(component.requestType).toBe('done_for_you');
    fixture.nativeElement.querySelector('.city-row a').click();
    expect(component.requestType).toBe('founding');
    expect(component.city).toBe('Miami');
  });

  it('requires a valid email, HTTPS listing, consent and founding city', async () => {
    const setInput = async (name: string, value: string | boolean) => {
      const element = fixture.nativeElement.querySelector(`[name="${name}"]`);
      if (typeof value === 'boolean') element.checked = value;
      else element.value = value;
      element.dispatchEvent(new Event(element.tagName === 'SELECT' || typeof value === 'boolean' ? 'change' : 'input', { bubbles: true }));
      fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    };
    await setInput('name', 'Test Agent'); await setInput('email', 'invalid');
    await setInput('agency', 'Test Agency'); await setInput('consent', true);
    const submit = fixture.nativeElement.querySelector('button[type=submit]');
    expect(submit.disabled).toBeTrue();
    await setInput('email', 'test@example.com'); await setInput('listing', 'http://example.com');
    expect(submit.disabled).toBeTrue();
    await setInput('listing', 'https://example.com'); await setInput('requestType', 'founding');
    expect(submit.disabled).toBeTrue();
    await setInput('city', 'Miami');
    expect(submit.disabled).toBeFalse();
    await setInput('consent', false);
    expect(submit.disabled).toBeTrue();
  });

  it('preserves request context and idempotency on a submission retry', async () => {
    const send = spyOn<any>(component, 'sendInterest').and.rejectWith(new Error('offline'));
    component.selectRequest('founding', false, ' Miami ');
    component.name = ' Test Agent '; component.email = 'test@example.com'; component.agency = ' Test Agency '; component.consent = true;
    await component.submit(validForm);
    expect(component.submitted()).toBeFalse();
    expect(component.error()).toBeTruthy();
    const first = send.calls.mostRecent().args[0] as Record<string, unknown>;
    expect(first).toEqual(jasmine.objectContaining({ requestType: 'founding', city: 'Miami', name: 'Test Agent', agency: 'Test Agency' }));
    send.and.resolveTo();
    await component.submit(validForm);
    expect((send.calls.mostRecent().args[0] as Record<string, unknown>)['submissionId']).toBe(first['submissionId']);
    expect(component.submitted()).toBeTrue();
  });

  it('does not submit invalid forms or stale city values on ordinary requests', async () => {
    const send = spyOn<any>(component, 'sendInterest').and.resolveTo();
    await component.submit({ invalid: true } as NgForm);
    expect(send).not.toHaveBeenCalled();
    component.city = 'Miami'; component.requestType = 'done_for_you';
    await component.submit(validForm);
    expect((send.calls.mostRecent().args[0] as Record<string, unknown>)['city']).toBe('');
  });

  it('supports arrow keys and Home/End through the preview tabs', () => {
    const tabs = fixture.nativeElement.querySelectorAll('[role=tab]');
    tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    fixture.detectChanges();
    expect(component.selectedPreview()).toBe(2);
    expect(tabs[2].getAttribute('aria-selected')).toBe('true');
    expect(fixture.nativeElement.querySelectorAll('[role=tabpanel]:not([hidden])').length).toBe(1);
    tabs[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(component.selectedPreview()).toBe(0);
  });
});
