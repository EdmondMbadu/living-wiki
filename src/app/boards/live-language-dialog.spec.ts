import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { LiveLanguageDialogComponent } from './live-language-dialog';

describe('Live language chooser', () => {
  it('shows twelve native language choices, confirms the selected choice and uses a modal dialog', async () => {
    await TestBed.configureTestingModule({ imports: [LiveLanguageDialogComponent], providers: [provideZonelessChangeDetection()] }).compileComponents();
    const fixture = TestBed.createComponent(LiveLanguageDialogComponent);
    fixture.componentRef.setInput('firstVisit', true);
    fixture.componentRef.setInput('initialLanguage', 'zh');
    const selected = jasmine.createSpy('selected');
    fixture.componentInstance.selected.subscribe(selected);
    fixture.detectChanges();
    await fixture.whenStable(); fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement;
    const dialog = host.querySelector('dialog')!;
    expect(dialog.open).toBeTrue();
    expect(dialog.classList.contains('live-language-dialog--first')).toBeTrue();
    const bounds = dialog.getBoundingClientRect();
    expect(Math.abs(bounds.left - (window.innerWidth - bounds.width) / 2)).toBeLessThan(2);
    expect(host.querySelectorAll('input[type=radio]').length).toBe(12);
    const choices = host.querySelector('fieldset')!;
    const confirm = host.querySelector('.continue')!.getBoundingClientRect();
    expect(choices.scrollHeight).toBeGreaterThan(choices.clientHeight);
    expect(confirm.bottom).toBeLessThanOrEqual(window.innerHeight);
    expect(confirm.top).toBeGreaterThanOrEqual(0);
    expect(host.querySelector('strong[dir=rtl]')?.textContent).toContain('العربية');
    for (const name of ['Italiano', '한국어', 'العربية', 'हिन्दी', 'Русский']) expect(host.textContent).toContain(name);
    expect(host.textContent).toContain('Deutsch'); expect(host.textContent).toContain('简体中文');
    expect((host.querySelector('input[value=zh]') as HTMLInputElement).checked).toBeTrue();
    (host.querySelector('input[value=de]') as HTMLInputElement).click(); fixture.detectChanges();
    host.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(selected).toHaveBeenCalledOnceWith('de');
    fixture.destroy();
  });

  for (const firstVisit of [true, false]) {
    it(`keeps confirmation reachable with twelve choices (${firstVisit ? 'first visit' : 'language change'})`, async () => {
      await TestBed.configureTestingModule({ imports: [LiveLanguageDialogComponent], providers: [provideZonelessChangeDetection()] }).compileComponents();
      const fixture = TestBed.createComponent(LiveLanguageDialogComponent);
      fixture.componentRef.setInput('firstVisit', firstVisit);
      fixture.componentRef.setInput('initialLanguage', 'ar');
      fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
      const host: HTMLElement = fixture.nativeElement;
      const last = host.querySelector('input[value=ru]') as HTMLInputElement;
      last.scrollIntoView({block:'nearest'}); last.click(); fixture.detectChanges();
      const button = host.querySelector('.continue')!.getBoundingClientRect();
      const dialog = host.querySelector('dialog')!.getBoundingClientRect();
      expect(dialog.left).toBeGreaterThanOrEqual(0);
      expect(dialog.right).toBeLessThanOrEqual(window.innerWidth);
      expect(button.top).toBeGreaterThanOrEqual(0);
      expect(button.bottom).toBeLessThanOrEqual(window.innerHeight);
      expect(last.checked).toBeTrue();
      expect(getComputedStyle(host.querySelector('strong[dir=rtl]')!).direction).toBe('rtl');
      fixture.destroy();
    });
  }

  it('Escape dismisses the chooser without confirming a language', async () => {
    await TestBed.configureTestingModule({ imports: [LiveLanguageDialogComponent], providers: [provideZonelessChangeDetection()] }).compileComponents();
    const fixture = TestBed.createComponent(LiveLanguageDialogComponent);
    const dismissed = jasmine.createSpy('dismissed'); const selected = jasmine.createSpy('selected');
    fixture.componentInstance.dismissed.subscribe(dismissed); fixture.componentInstance.selected.subscribe(selected);
    fixture.detectChanges();
    fixture.nativeElement.querySelector('dialog').dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(dismissed).toHaveBeenCalledTimes(1); expect(selected).not.toHaveBeenCalled();
    fixture.destroy();
  });
});
