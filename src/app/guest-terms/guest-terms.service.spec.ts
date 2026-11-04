import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../auth.service';
import { TERMS_EFFECTIVE_DATE, TERMS_VERSION } from '../legal/terms-policy';
import { GuestTermsService, GUEST_TERMS_STORAGE, GUEST_TERMS_STORAGE_KEY } from './guest-terms.service';
import { GuestTermsTestStorage, guestTermsAuthStub } from './guest-terms.testing';

describe('GuestTermsService', () => {
  let storage: GuestTermsTestStorage;
  let auth: ReturnType<typeof guestTermsAuthStub>;

  beforeEach(() => {
    storage = new GuestTermsTestStorage();
    auth = guestTermsAuthStub();
    TestBed.configureTestingModule({ providers: [
      provideZonelessChangeDetection(),
      { provide: AuthService, useValue: auth },
      { provide: GUEST_TERMS_STORAGE, useValue: storage },
    ] });
  });

  it('blocks a first-time guest and does not create an acceptance by visiting', async () => {
    const service = TestBed.inject(GuestTermsService);
    expect(service.hasConversationAccess()).toBeFalse();
    expect(await service.waitForAccess()).toBeFalse();
    expect(storage.length).toBe(0);
  });

  it('does not accept without an explicit checked agreement', () => {
    const service = TestBed.inject(GuestTermsService);
    expect(service.accept(false)).toBeFalse();
    expect(service.hasConversationAccess()).toBeFalse();
    expect(storage.length).toBe(0);
  });

  it('persists the current policy and timestamp only after explicit agreement', () => {
    const service = TestBed.inject(GuestTermsService);
    const before = Date.now();
    expect(service.accept(true)).toBeTrue();
    const saved = JSON.parse(storage.getItem(GUEST_TERMS_STORAGE_KEY)!);
    expect(saved.version).toBe(TERMS_VERSION);
    expect(saved.effectiveDate).toBe(TERMS_EFFECTIVE_DATE);
    expect(Date.parse(saved.acceptedAt)).toBeGreaterThanOrEqual(before);
    expect(service.hasConversationAccess()).toBeTrue();
  });

  it('recognizes acceptance on a later visit without asking again', async () => {
    const first = TestBed.inject(GuestTermsService);
    first.accept(true);
    // A new service instance simulates a new application load with the same storage.
    const next = TestBed.runInInjectionContext(() => new GuestTermsService());
    expect(await next.waitForAccess()).toBeTrue();
  });

  it('bypasses guest acceptance for an authenticated account', async () => {
    auth.isAuthenticated.set(true);
    expect(await TestBed.inject(GuestTermsService).waitForAccess()).toBeTrue();
    expect(storage.length).toBe(0);
  });

  it('waits for authentication restoration before allowing a conversation', () => {
    auth.initialized.set(false);
    auth.isAuthenticated.set(true);
    const service = TestBed.inject(GuestTermsService);
    expect(service.hasConversationAccess()).toBeFalse();
    auth.initialized.set(true);
    expect(service.hasConversationAccess()).toBeTrue();
  });

  for (const invalid of [
    'true', 'null', 'not json', '{}',
    JSON.stringify({ version: 'old', effectiveDate: TERMS_EFFECTIVE_DATE, acceptedAt: new Date().toISOString() }),
    JSON.stringify({ version: TERMS_VERSION, effectiveDate: 'old', acceptedAt: new Date().toISOString() }),
    JSON.stringify({ version: TERMS_VERSION, effectiveDate: TERMS_EFFECTIVE_DATE, acceptedAt: 'not a date' }),
    JSON.stringify({ version: TERMS_VERSION, effectiveDate: TERMS_EFFECTIVE_DATE, acceptedAt: '2999-01-01T00:00:00.000Z' }),
  ]) {
    it(`rejects missing, malformed, outdated, or future acceptance: ${invalid}`, async () => {
      storage.setItem(GUEST_TERMS_STORAGE_KEY, invalid);
      expect(await TestBed.inject(GuestTermsService).waitForAccess()).toBeFalse();
    });
  }

  it('fails closed when storage is unavailable', () => {
    TestBed.overrideProvider(GUEST_TERMS_STORAGE, { useValue: null });
    const service = TestBed.inject(GuestTermsService);
    expect(service.accept(true)).toBeFalse();
    expect(service.hasConversationAccess()).toBeFalse();
  });

  it('fails closed on denied reads or failed writes', async () => {
    spyOn(storage, 'getItem').and.throwError('Storage denied');
    spyOn(storage, 'setItem').and.throwError('Quota exceeded');
    const service = TestBed.inject(GuestTermsService);
    expect(await service.waitForAccess()).toBeFalse();
    expect(service.accept(true)).toBeFalse();
    expect(service.hasConversationAccess()).toBeFalse();
  });

  it('does not unlock the app if a storage write is silently lost', () => {
    spyOn(storage, 'setItem').and.stub();
    const service = TestBed.inject(GuestTermsService);
    expect(service.accept(true)).toBeFalse();
    expect(service.hasConversationAccess()).toBeFalse();
  });

  it('asks again after browser storage is cleared', async () => {
    const service = TestBed.inject(GuestTermsService);
    service.accept(true);
    storage.clear();
    expect(await service.waitForAccess()).toBeFalse();
  });
});
