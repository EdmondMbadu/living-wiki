import { Component, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService } from '../auth.service';
import { TeamsService } from '../teams/teams.service';

@Component({
  selector: 'app-invitation-alert',
  imports: [RouterLink],
  template: `@if (visible()) {
    <aside
      class="invite-alert"
      role="status"
      aria-live="polite"
      aria-label="Pending team invitation"
    >
      <span class="material-symbols-outlined alert-icon" aria-hidden="true">mark_email_unread</span>
      <div>
        <strong>{{
          teams.invitations().length === 1
            ? 'You have a team invitation'
            : teams.invitations().length + ' team invitations'
        }}</strong>
        <p>
          {{
            teams.invitations().length === 1
              ? teams.invitations()[0].teamName + ' is waiting for your response.'
              : 'Your teams are waiting for your response.'
          }}
        </p>
        <a routerLink="/notifications" [queryParams]="{ filter: 'invitations' }"
          >Review invitation{{ teams.invitations().length === 1 ? '' : 's' }}
          <span aria-hidden="true">→</span></a
        >
      </div>
      <button
        type="button"
        (click)="dismiss()"
        aria-label="Dismiss invitation reminder; invitations remain in Notifications"
      >
        ×
      </button>
    </aside>
  }`,
  styles: [
    `
      :host {
        position: fixed;
        right: 24px;
        bottom: 24px;
        z-index: 45;
        max-width: calc(100vw - 32px);
      }
      .invite-alert {
        display: flex;
        gap: 14px;
        align-items: flex-start;
        max-width: 420px;
        padding: 20px;
        border: 1px solid #e5a962;
        border-left: 4px solid #dd7625;
        border-radius: 16px;
        background: var(--surface, #fff);
        color: var(--text, #19372b);
        box-shadow: 0 14px 50px #13291f26;
      }
      .alert-icon {
        color: #c96215;
        background: #fff1e1;
        border-radius: 12px;
        padding: 10px;
      }
      .invite-alert strong {
        font-size: 14px;
      }
      .invite-alert p {
        margin: 5px 0 12px;
        font-size: 13px;
        color: var(--muted, #68776e);
        overflow-wrap: anywhere;
      }
      .invite-alert a {
        font-size: 13px;
        font-weight: 750;
        color: var(--accent, #216b4c);
        text-decoration: underline;
        text-underline-offset: 3px;
      }
      .invite-alert button {
        padding: 0 5px;
        font-size: 23px;
        background: none;
        border: 0;
        color: var(--muted);
        cursor: pointer;
      }
      .invite-alert :focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 4px;
      }
      @media (max-width: 600px) {
        :host {
          right: 16px;
          bottom: 16px;
        }
        .invite-alert {
          padding: 16px;
          gap: 10px;
        }
      }
    `,
  ],
})
export class InvitationAlertComponent {
  readonly teams = inject(TeamsService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly route = signal(this.router.url);
  private readonly dismissed = signal('');
  readonly fingerprint = computed(
    () =>
      this.auth.uid() +
      ':' +
      this.teams
        .invitations()
        .map((i) => i.id + ':' + (i.sentAt || i.expiresAt))
        .sort()
        .join(','),
  );
  readonly visible = computed(() => {
    if (
      !this.auth.isAuthenticated() ||
      !this.teams.invitations().length ||
      /\/(notifications|teams\/invitations|sign-in|create-account|verify-email|auth\/action)(\?|$)/.test(
        this.route(),
      )
    )
      return false;
    if (this.dismissed() === this.fingerprint()) return false;
    try {
      return sessionStorage.getItem('livingwiki-invitation-reminder') !== this.fingerprint();
    } catch {
      return true;
    }
  });
  constructor() {
    this.router.events.pipe(takeUntilDestroyed()).subscribe((event) => {
      if (event instanceof NavigationEnd) this.route.set(event.urlAfterRedirects);
    });
  }
  dismiss(): void {
    this.dismissed.set(this.fingerprint());
    try {
      sessionStorage.setItem('livingwiki-invitation-reminder', this.fingerprint());
    } catch {
      /* Memory fallback for private browsers. */
    }
  }
}
