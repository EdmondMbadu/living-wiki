import { NO_ERRORS_SCHEMA, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { provideRouter, RouterLink } from '@angular/router';
import { OffGridEditorComponent } from './off-grid-editor';
import { OffGridService } from './off-grid.service';

describe('Off Grid coordinate entry', () => {
  beforeEach(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('lw-off-grid-') && key.includes('test-editor')) localStorage.removeItem(key);
    }
    TestBed.configureTestingModule({
      imports: [OffGridEditorComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        {
          provide: OffGridService,
          useValue: {
            auth: { uid: () => 'test-editor', waitForReady: async () => undefined },
            command: async () => ({}),
            detail: async () => ({
              ownerUid: 'test-editor', title: 'Untitled gem', tip: '', visibility: 'private',
              status: 'draft', createdAt: 'now', location: null,
            }),
          },
        },
      ],
    }).overrideComponent(OffGridEditorComponent, {
      set: { imports: [FormsModule, RouterLink], schemas: [NO_ERRORS_SCHEMA] },
    });
  });

  it('handles numeric input, zero coordinates, and clearing a confirmed coordinate', async () => {
    const fixture = TestBed.createComponent(OffGridEditorComponent);
    fixture.detectChanges();
    // Complete authentication/draft promises before observing the rendered editor.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance.error()).toBe('');
    expect(fixture.componentInstance.id()).not.toBe('');
    const inputs = fixture.nativeElement.querySelectorAll('input[type=number]') as NodeListOf<HTMLInputElement>;
    expect(inputs.length).toBe(2);
    for (const input of inputs) {
      input.value = '0';
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    }
    expect(fixture.componentInstance.point()?.lat).toBe(0);
    expect(fixture.componentInstance.point()?.lng).toBe(0);
    fixture.componentInstance.confirmPoint();
    expect(fixture.componentInstance.confirmed()).toBeTrue();
    inputs[0].value = '';
    inputs[0].dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(fixture.componentInstance.point()).toBeNull();
    expect(fixture.componentInstance.confirmed()).toBeFalse();
    fixture.destroy();
  });
});
