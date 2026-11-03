import { LOCALE_ID, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LanguageSwitcherComponent } from './language-switcher';

describe('shared site language switcher', () => {
  for (const localeId of ['en-US', 'ar']) {
    it(`offers all twelve site languages from the ${localeId} interface`, async () => {
      await TestBed.configureTestingModule({imports:[LanguageSwitcherComponent], providers:[
        provideZonelessChangeDetection(), {provide:LOCALE_ID, useValue:localeId},
      ]}).compileComponents();
      const fixture = TestBed.createComponent(LanguageSwitcherComponent);
      fixture.detectChanges();
      fixture.nativeElement.querySelector('button').click(); fixture.detectChanges();
      const host: HTMLElement = fixture.nativeElement;
      expect(host.querySelectorAll('[role=menuitemradio]').length).toBe(12);
      for (const label of ['Italiano','한국어','العربية','हिन्दी','Русский']) expect(host.textContent).toContain(label);
      expect(host.querySelector('[lang=ar]')?.getAttribute('dir')).toBe('rtl');
      expect(host.querySelector('[aria-checked=true]')?.textContent).toContain(localeId === 'ar' ? 'العربية' : 'English');
      const menu = host.querySelector('[role=menu]')!;
      expect(menu.scrollHeight).toBeGreaterThan(menu.clientHeight);
      fixture.componentInstance.onEscape(); fixture.detectChanges();
      expect(host.querySelector('[role=menu]')).toBeNull();
      fixture.destroy();
    });
  }
});
