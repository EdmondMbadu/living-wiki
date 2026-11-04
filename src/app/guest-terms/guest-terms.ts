import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TERMS_UPDATED_LABEL } from '../legal/terms-policy';
import { GuestTermsService } from './guest-terms.service';

@Component({
  selector: 'app-guest-terms',
  imports: [RouterLink],
  templateUrl: './guest-terms.html',
  styleUrl: './guest-terms.css',
})
export class GuestTermsComponent {
  private readonly terms = inject(GuestTermsService);
  private readonly router = inject(Router);

  readonly agreed = signal(false);
  readonly submitting = signal(false);
  readonly declined = signal(false);
  readonly error = signal(false);
  readonly policyLabel = TERMS_UPDATED_LABEL;

  setAgreed(checked: boolean): void {
    this.agreed.set(checked);
    this.declined.set(false);
    this.error.set(false);
  }

  async accept(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.agreed() || this.submitting()) return;
    this.submitting.set(true);
    this.error.set(false);
    try {
      if (!this.terms.accept(this.agreed())) {
        this.error.set(true);
        return;
      }
      this.terms.finishConversationConsent(true);
    } finally {
      this.submitting.set(false);
    }
  }

  decline(): void {
    this.agreed.set(false);
    this.declined.set(true);
    this.error.set(false);
    this.terms.finishConversationConsent(false);
  }

  returnTo(): string {
    return this.router.url;
  }
}
