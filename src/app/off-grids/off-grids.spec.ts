import { NO_ERRORS_SCHEMA, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { provideRouter, RouterLink } from '@angular/router';
import { OffGridsComponent } from './off-grids';
import { OffGridService } from './off-grid.service';

describe('Off Grid sheets', () => {
  it('moves focus into the rendered dialog, traps Tab and restores focus on Escape', async () => {
    TestBed.configureTestingModule({
      imports: [OffGridsComponent],
      providers: [
        provideZonelessChangeDetection(), provideRouter([]),
        { provide: OffGridService, useValue: {
          auth: {uid: () => 'owner', isAuthenticated: () => true, waitForReady: async () => undefined},
          list: async () => ({items: [], cursor: null}), savedIds: async () => new Set(),
        }},
      ],
    }).overrideComponent(OffGridsComponent, {
      set: {imports: [FormsModule, RouterLink], schemas: [NO_ERRORS_SCHEMA]},
    });
    const fixture = TestBed.createComponent(OffGridsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentInstance.selected.set({
      id: 'gem', title: 'A private gem', tip: '', ownerUid: 'owner', creatorUid: 'owner',
      creatorName: 'Owner', createdAt: 'now', visibility: 'private', status: 'active',
      location: null, cover: false,
    });
    fixture.detectChanges();
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    fixture.componentInstance.openSheet('share');
    fixture.detectChanges();
    await fixture.whenStable();
    const dialog = fixture.nativeElement.querySelector('.action-sheet') as HTMLElement;
    const close = dialog.querySelector('button') as HTMLButtonElement;
    expect(document.activeElement).toBe(close);
    const last = dialog.querySelector('a') as HTMLAnchorElement;
    last.focus();
    const tab = new KeyboardEvent('keydown', {key: 'Tab', cancelable: true});
    fixture.componentInstance.onKey(tab);
    expect(tab.defaultPrevented).toBeTrue();
    expect(document.activeElement).toBe(close);
    fixture.componentInstance.onKey(new KeyboardEvent('keydown', {key: 'Escape', cancelable: true}));
    fixture.detectChanges();
    expect(fixture.componentInstance.sheet()).toBeNull();
    expect(document.activeElement).toBe(opener);
    opener.remove();
    fixture.destroy();
  });
});
