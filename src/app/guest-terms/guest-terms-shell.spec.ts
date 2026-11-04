import { Component, CUSTOM_ELEMENTS_SCHEMA, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, RouterOutlet } from '@angular/router';
import { App } from '../app';
import { ThemeService } from '../theme.service';
import { GuestTermsService } from './guest-terms.service';

@Component({ template: '' })
class EmptyReportComponent {}

describe('guest acceptance in the app shell', () => {
  const promptOpen = signal(false);
  beforeEach(async () => {
    promptOpen.set(false);
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([{ path: 'reports/boards/:slug', component: EmptyReportComponent }]),
        { provide: GuestTermsService, useValue: { promptOpen } },
        { provide: ThemeService, useValue: {} },
      ],
    }).overrideComponent(App, {
      // Keep the real root template and conditional rendering. Avoid creating real
      // voice/network integrations while asserting whether they would be mounted.
      set: { imports: [RouterOutlet], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
    }).compileComponents();
  });

  it('keeps browsing and launchers available without automatically showing consent', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    for (const selector of ['app-kiwi', 'app-workspace-navigation-overlay', 'app-spotify-player', 'app-invitation-alert', 'app-talkthru-plan-dialog']) {
      expect(fixture.nativeElement.querySelector(selector)).not.toBeNull();
    }
  });

  it('opens a consent dialog only for an explicit conversation request', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    promptOpen.set(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-guest-terms-dialog')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('app-kiwi')).not.toBeNull();
  });

  it('continues suppressing assistants on shared analytics reports after acceptance', async () => {
    promptOpen.set(true);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await TestBed.inject(Router).navigateByUrl('/reports/boards/example');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-kiwi')).toBeNull();
  });
});
