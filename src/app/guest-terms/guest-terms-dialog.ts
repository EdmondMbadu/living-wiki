import { afterNextRender, Component, ElementRef, inject, viewChild } from '@angular/core';
import { GuestTermsComponent } from './guest-terms';
import { GuestTermsService } from './guest-terms.service';

@Component({
  selector: 'app-guest-terms-dialog',
  imports: [GuestTermsComponent],
  template: `
    <dialog #dialog aria-labelledby="guest-terms-title" (cancel)="cancel($event)" (click)="dismissBackdrop($event)">
      <app-guest-terms />
    </dialog>
  `,
  styles: `
    dialog { position: fixed; inset: 0; margin: auto; width: min(42rem, calc(100% - 2rem));
      max-height: calc(100dvh - 2rem); padding: 0; overflow: auto; border: 1px solid #ddd;
      border-radius: 1rem; background: #fff; color: #171717; }
    dialog::backdrop { background: rgb(0 0 0 / 35%); }
  `,
})
export class GuestTermsDialogComponent {
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly terms = inject(GuestTermsService);

  constructor() {
    afterNextRender(() => this.dialog().nativeElement.showModal());
  }

  cancel(event: Event): void {
    event.preventDefault();
    this.terms.finishConversationConsent(false);
  }

  dismissBackdrop(event: MouseEvent): void {
    if (event.target === this.dialog().nativeElement) this.terms.finishConversationConsent(false);
  }
}
