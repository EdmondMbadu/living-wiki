import { Component, inject, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AuthService } from '../auth.service';
import { GuestTermsComponent } from './guest-terms';
import { safeGuestReturnTo } from './guest-terms-navigation';
import { GuestTermsService, GUEST_TERMS_STORAGE } from './guest-terms.service';
import { GuestTermsTestStorage, guestTermsAuthStub } from './guest-terms.testing';

@Component({ template: '<h1>Browse normally</h1><button (click)="talk()">Talk to avatar</button>' })
class BrowsingComponent {
  readonly terms = inject(GuestTermsService);
  started = 0;
  async talk(): Promise<void> { if (await this.terms.requestConversation()) this.started += 1; }
}

describe('conversation-only guest acceptance', () => {
  let auth: ReturnType<typeof guestTermsAuthStub>;
  beforeEach(() => {
    auth = guestTermsAuthStub();
    TestBed.configureTestingModule({ providers: [
      provideZonelessChangeDetection(),
      { provide: AuthService, useValue: auth },
      { provide: GUEST_TERMS_STORAGE, useValue: new GuestTermsTestStorage() },
      provideRouter([
        { path: 'guest-terms', redirectTo: ({ queryParams }) => {
          const router = inject(Router);
          return router.parseUrl(safeGuestReturnTo(queryParams['returnTo'] ?? null, router));
        } },
        { path: '**', component: BrowsingComponent },
      ]),
    ] });
  });

  for (const url of ['/', '/chat/city?voice=1#talk', '/boards/shared?card=123', '/talkthrus', '/terms', '/privacy']) {
    it(`allows guest browsing without prompting: ${url}`, async () => {
      await RouterTestingHarness.create(url);
      expect(TestBed.inject(Router).url).toBe(url);
      const terms = TestBed.inject(GuestTermsService);
      expect(terms.promptOpen()).toBeFalse();
      expect(terms.hasAccepted()).toBeFalse();
    });
  }

  it('opens consent only on Talk, then resumes the action without navigation after accepting', async () => {
    const harness = await RouterTestingHarness.create('/boards/shared?card=123');
    const page = harness.routeDebugElement!.componentInstance as BrowsingComponent;
    const terms = TestBed.inject(GuestTermsService);
    const talking = page.talk();
    await TestBed.inject(AuthService).waitForReady();
    await Promise.resolve();
    expect(terms.promptOpen()).toBeTrue();
    expect(page.started).toBe(0);
    const consent = TestBed.createComponent(GuestTermsComponent);
    consent.componentInstance.setAgreed(true);
    await consent.componentInstance.accept(new Event('submit'));
    await talking;
    expect(page.started).toBe(1);
    expect(terms.promptOpen()).toBeFalse();
    expect(TestBed.inject(Router).url).toBe('/boards/shared?card=123');
    await page.talk();
    expect(page.started).toBe(2);
    expect(terms.promptOpen()).toBeFalse();
  });

  it('cancels only the conversation when the visitor declines', async () => {
    const harness = await RouterTestingHarness.create('/boards/shared');
    const page = harness.routeDebugElement!.componentInstance as BrowsingComponent;
    const talking = page.talk();
    await TestBed.inject(AuthService).waitForReady();
    await Promise.resolve();
    const consent = TestBed.createComponent(GuestTermsComponent);
    consent.componentInstance.decline();
    await talking;
    expect(page.started).toBe(0);
    expect(TestBed.inject(Router).url).toBe('/boards/shared');
    expect(TestBed.inject(GuestTermsService).hasAccepted()).toBeFalse();
  });

  it('never prompts an already signed-in user', async () => {
    auth.isAuthenticated.set(true);
    const harness = await RouterTestingHarness.create('/chat/city');
    const page = harness.routeDebugElement!.componentInstance as BrowsingComponent;
    await page.talk();
    expect(page.started).toBe(1);
    expect(TestBed.inject(GuestTermsService).promptOpen()).toBeFalse();
  });

  it('waits for restored authentication instead of mistaking a signed-in user for a guest', async () => {
    let ready!: () => void;
    auth.initialized.set(false);
    auth.waitForReady = () => new Promise<void>(resolve => { ready = resolve; });
    const harness = await RouterTestingHarness.create('/chat/city');
    const page = harness.routeDebugElement!.componentInstance as BrowsingComponent;
    const talking = page.talk();
    const terms = TestBed.inject(GuestTermsService);
    expect(terms.promptOpen()).toBeFalse();
    auth.isAuthenticated.set(true);
    auth.initialized.set(true);
    ready();
    await talking;
    expect(terms.promptOpen()).toBeFalse();
    expect(page.started).toBe(1);
  });

  it('cancels a pending conversation on navigation', async () => {
    const harness = await RouterTestingHarness.create('/chat/city');
    const page = harness.routeDebugElement!.componentInstance as BrowsingComponent;
    const talking = page.talk();
    await TestBed.inject(AuthService).waitForReady();
    await Promise.resolve();
    await harness.navigateByUrl('/boards/another');
    await talking;
    expect(page.started).toBe(0);
    expect(TestBed.inject(GuestTermsService).promptOpen()).toBeFalse();
  });

  it('does not allow dismissal to count as consent', async () => {
    const harness = await RouterTestingHarness.create('/chat/city');
    const page = harness.routeDebugElement!.componentInstance as BrowsingComponent;
    const talking = page.talk();
    await TestBed.inject(AuthService).waitForReady();
    await Promise.resolve();
    TestBed.inject(GuestTermsService).finishConversationConsent(false);
    await talking;
    expect(page.started).toBe(0);
  });

  it('redirects old standalone consent URLs back to the original browsing destination', async () => {
    await RouterTestingHarness.create('/guest-terms?returnTo=%2Fboards%2Fshared');
    expect(TestBed.inject(Router).url).toBe('/boards/shared');
    expect(TestBed.inject(GuestTermsService).promptOpen()).toBeFalse();
  });

  it('rejects unsafe or looping old return destinations', () => {
    const router = TestBed.inject(Router);
    for (const unsafe of [null, 'https://example.com', '//example.com', '/\\example.com', '/guest-terms?returnTo=/guest-terms', '/\nfoo']) {
      expect(safeGuestReturnTo(unsafe, router)).toBe('/');
    }
  });
});
