import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { AuthService } from '../auth.service';
import { GuestTermsComponent } from './guest-terms';
import { GUEST_TERMS_STORAGE, GUEST_TERMS_STORAGE_KEY, GuestTermsService } from './guest-terms.service';
import { GuestTermsTestStorage, guestTermsAuthStub } from './guest-terms.testing';

describe('GuestTermsComponent', () => {
  let storage: GuestTermsTestStorage;
  beforeEach(async () => {
    storage = new GuestTermsTestStorage();
    await TestBed.configureTestingModule({ imports: [GuestTermsComponent], providers: [
      provideZonelessChangeDetection(), provideRouter([]),
      { provide: AuthService, useValue: guestTermsAuthStub() },
      { provide: GUEST_TERMS_STORAGE, useValue: storage },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({ returnTo: '/chat/city?voice=1' }) } } },
    ] }).compileComponents();
  });

  it('starts unchecked with continue disabled and readable policies in new tabs', () => {
    const fixture = TestBed.createComponent(GuestTermsComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('input').checked).toBeFalse();
    expect(fixture.nativeElement.querySelector('button[type="submit"]').disabled).toBeTrue();
    for (const path of ['/terms', '/privacy']) {
      const link = fixture.nativeElement.querySelector(`a[href="${path}"]`);
      expect(link.target).toBe('_blank');
      expect(link.rel).toContain('noopener');
    }
  });

  it('does not accept or navigate if an unchecked form is submitted directly', async () => {
    const fixture = TestBed.createComponent(GuestTermsComponent);
    const navigate = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
    await fixture.componentInstance.accept(new Event('submit'));
    expect(navigate).not.toHaveBeenCalled();
    expect(storage.length).toBe(0);
  });

  it('enables continue only after checking the agreement', () => {
    const fixture = TestBed.createComponent(GuestTermsComponent);
    fixture.detectChanges();
    const checkbox = fixture.nativeElement.querySelector('input');
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button[type="submit"]').disabled).toBeFalse();
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button[type="submit"]').disabled).toBeTrue();
    expect(storage.length).toBe(0); // Checking alone does not accept the terms.
  });

  it('does not record acceptance on Not now and stays blocked', () => {
    const fixture = TestBed.createComponent(GuestTermsComponent);
    fixture.componentInstance.setAgreed(true);
    fixture.componentInstance.decline();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('input').checked).toBeFalse();
    expect(fixture.nativeElement.querySelector('[role="status"]')).not.toBeNull();
    expect(TestBed.inject(GuestTermsService).hasConversationAccess()).toBeFalse();
    expect(storage.length).toBe(0);
  });

  it('shows an error and stays blocked when acceptance cannot be saved', async () => {
    spyOn(storage, 'setItem').and.throwError('Storage denied');
    const fixture = TestBed.createComponent(GuestTermsComponent);
    const navigate = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
    fixture.componentInstance.setAgreed(true);
    await fixture.componentInstance.accept(new Event('submit'));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
    expect(TestBed.inject(GuestTermsService).hasConversationAccess()).toBeFalse();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('records acceptance before allowing the waiting conversation', async () => {
    const fixture = TestBed.createComponent(GuestTermsComponent);
    const finish = spyOn(TestBed.inject(GuestTermsService), 'finishConversationConsent').and.callFake(allowed => {
      expect(allowed).toBeTrue();
      expect(storage.getItem(GUEST_TERMS_STORAGE_KEY)).not.toBeNull();
    });
    fixture.componentInstance.setAgreed(true);
    await fixture.componentInstance.accept(new Event('submit'));
    expect(finish).toHaveBeenCalledWith(true);
  });
});
