import { PLATFORM_ID, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '../auth.service';
import { CityWeeklyUpdatesComponent } from './city-weekly-updates';
import { CityWeeklyUpdatesService, type CityWeeklySettings } from './city-weekly-updates.service';

describe('Profile weekly city updates', () => {
  const initial: CityWeeklySettings = { enabled: true, citySlug: 'philly', cityName: 'Philadelphia', available: true, emailVerified: true };
  let preference: jasmine.Spy;
  let profile: ReturnType<typeof signal<any>>;
  function setup(browser = false) {
    profile = signal({ preferredCitySlug: 'philly' });
    preference = jasmine.createSpy().and.resolveTo({ ...initial });
    TestBed.configureTestingModule({
      imports: [CityWeeklyUpdatesComponent],
      providers: [provideZonelessChangeDetection(), provideRouter([]),
        { provide: PLATFORM_ID, useValue: browser ? 'browser' : 'server' },
        { provide: AuthService, useValue: { uid: signal('account'), profile } },
        { provide: CityWeeklyUpdatesService, useValue: { preference } },
      ],
    });
    const fixture = TestBed.createComponent(CityWeeklyUpdatesComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('shows the saved city and an accessible On switch', async () => {
    const fixture = setup();
    await fixture.componentInstance.load(); fixture.detectChanges();
    const button = fixture.nativeElement.querySelector('[role=switch]');
    expect(button.getAttribute('aria-checked')).toBe('true');
    expect(fixture.nativeElement.textContent).toContain('Weekly Philadelphia updates');
    expect(fixture.nativeElement.textContent).toContain('Automatically follows your saved city');
  });

  it('turns off only after the server confirms, and preserves the account-wide explanation', async () => {
    const fixture = setup(); const component = fixture.componentInstance;
    await component.load();
    let resolve!: (value: CityWeeklySettings) => void;
    preference.and.returnValue(new Promise<CityWeeklySettings>(done => resolve = done));
    const pending = component.toggle(); fixture.detectChanges();
    expect(component.settings()?.enabled).toBeTrue();
    expect(fixture.nativeElement.querySelector('[role=switch]').disabled).toBeTrue();
    resolve({ ...initial, enabled: false }); await pending; fixture.detectChanges();
    expect(preference).toHaveBeenCalledWith(false);
    expect(fixture.nativeElement.querySelector('[role=switch]').getAttribute('aria-checked')).toBe('false');
    expect(fixture.nativeElement.textContent).toContain('Changing cities keeps updates off');
    expect(fixture.nativeElement.textContent).toContain('Preference saved');
  });

  it('handles failed saves without claiming success and requires a reload to resolve uncertain state', async () => {
    const fixture = setup(); const component = fixture.componentInstance;
    await component.load();
    preference.and.rejectWith(new Error('Network unavailable'));
    await component.toggle(); fixture.detectChanges();
    expect(component.settings()?.enabled).toBeTrue();
    expect(component.saved()).toBeFalse();
    expect(fixture.nativeElement.querySelector('[role=alert]').textContent).toContain('Could not confirm');
    expect(fixture.nativeElement.querySelector('[role=switch]').disabled).toBeTrue();
    preference.and.resolveTo({ ...initial, enabled: false });
    await component.load(); fixture.detectChanges();
    expect(component.error()).toBeNull();
    expect(fixture.nativeElement.querySelector('[role=switch]').disabled).toBeFalse();
    expect(component.settings()?.enabled).toBeFalse();
  });

  it('allows recovery when loading the setting fails', async () => {
    const fixture = setup(); const component = fixture.componentInstance;
    preference.and.rejectWith(new Error('Offline')); await component.load(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role=alert]').textContent).toContain('Could not load');
    expect(fixture.nativeElement.querySelector('[role=switch]')).toBeNull();
    preference.and.resolveTo(initial); await component.load(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role=switch]')).not.toBeNull();
  });

  it('explains missing cities, unverified emails and paused newsletters accurately', async () => {
    const fixture = setup(); const component = fixture.componentInstance;
    for (const [patch, expected] of [
      [{ citySlug: null, cityName: null }, 'Choose and save a home city'],
      [{ emailVerified: false }, 'Verify your account email'],
      [{ available: false }, 'currently unavailable'],
    ] as [Partial<CityWeeklySettings>, string][]) {
      preference.and.resolveTo({ ...initial, ...patch }); await component.load(); fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain(expected);
    }
  });

  it('refreshes when the saved account city changes, with stale responses ignored', async () => {
    const fixture = setup(true); await fixture.whenStable();
    expect(preference).toHaveBeenCalledTimes(1);
    let resolve!: (value: CityWeeklySettings) => void;
    preference.and.returnValue(new Promise<CityWeeklySettings>(done => resolve = done));
    const old = fixture.componentInstance.load();
    preference.and.resolveTo({ ...initial, citySlug: 'boston', cityName: 'Boston' });
    profile.set({ preferredCitySlug: 'boston' }); fixture.detectChanges(); await fixture.whenStable();
    resolve(initial); await old; fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Weekly Boston updates');
    expect(fixture.componentInstance.busy()).toBeFalse();
  });

  it('ignores repeated toggle clicks during a pending save', async () => {
    const fixture = setup(); const component = fixture.componentInstance;
    await component.load();
    let resolve!: (value: CityWeeklySettings) => void;
    preference.and.returnValue(new Promise<CityWeeklySettings>(done => resolve = done));
    const pending = component.toggle(); await component.toggle(); await component.toggle();
    expect(preference).toHaveBeenCalledTimes(2);
    resolve({ ...initial, enabled: false }); await pending;
  });
});
