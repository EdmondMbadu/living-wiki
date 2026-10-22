import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { LiveLanguageDialogComponent } from './live-language-dialog';

describe('Live language chooser', () => {
  it('shows seven native language choices, confirms the selected choice and uses a modal dialog', async () => {
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
    expect(host.querySelectorAll('input[type=radio]').length).toBe(7);
    expect(host.textContent).toContain('Deutsch'); expect(host.textContent).toContain('简体中文');
    expect((host.querySelector('input[value=zh]') as HTMLInputElement).checked).toBeTrue();
    (host.querySelector('input[value=de]') as HTMLInputElement).click(); fixture.detectChanges();
    host.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(selected).toHaveBeenCalledOnceWith('de');
    fixture.destroy();
  });

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
