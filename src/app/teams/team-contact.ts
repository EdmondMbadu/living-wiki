import { Component, ElementRef, ViewChild, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { httpsCallable } from 'firebase/functions';
import { getFirebaseFunctions } from '../firebase.client';
import { TeamsService } from './teams.service';
import { teamError } from './team.models';

@Component({
  selector: 'app-team-contact',
  imports: [FormsModule],
  template: `
    @if (!teams.hasAccess(teamId())) {
      <button class="contact-trigger" (click)="open()">
        <span class="material-symbols-outlined">mail</span> Contact the listing team
      </button>
      <dialog
        #dialog
        [attr.aria-labelledby]="'contact-heading-' + boardId()"
        (cancel)="busy() && $event.preventDefault()"
      >
        <button class="close" aria-label="Close contact form" [disabled]="busy()" (click)="close()">
          ×
        </button>
        @if (sent()) {
          <h2 [id]="'contact-heading-' + boardId()">Message sent</h2>
          <p>
            The listing team has your request and contact details. They’ll follow up with you
            directly.
          </p>
          <button (click)="close()">Done</button>
        } @else {
          <h2 [id]="'contact-heading-' + boardId()">Let’s talk about this listing</h2>
          <p>
            Send a question or request a showing. This goes to the listing’s representative and team
            admins.
          </p>
          <form (ngSubmit)="submit()">
            <fieldset [disabled]="busy()">
              <label
                >Your name<input
                  required
                  maxlength="100"
                  name="name"
                  autocomplete="name"
                  [(ngModel)]="form.name"
              /></label>
              <label
                >Email<input
                  required
                  type="email"
                  maxlength="254"
                  name="email"
                  autocomplete="email"
                  [(ngModel)]="form.email"
              /></label>
              <label
                >Phone (optional)<input
                  type="tel"
                  maxlength="40"
                  name="phone"
                  autocomplete="tel"
                  [(ngModel)]="form.phone"
              /></label>
              <label
                >How can we help?<textarea
                  required
                  rows="4"
                  maxlength="2000"
                  name="message"
                  [(ngModel)]="form.message"
                  placeholder="I’d like to arrange a showing…"
                ></textarea>
              </label>
              <div class="honeypot" aria-hidden="true">
                <label
                  >Website<input
                    name="website"
                    tabindex="-1"
                    autocomplete="off"
                    [(ngModel)]="form.website"
                /></label>
              </div>
              <label class="consent"
                ><input required type="checkbox" name="consent" [(ngModel)]="form.consent" /><span
                  >I agree that the listing team may contact me about this request.</span
                ></label
              >
              @if (error()) {
                <p class="error" role="alert">{{ error() }}</p>
              }
              <button type="submit" [disabled]="!form.consent">
                {{ busy() ? 'Sending…' : 'Send message' }}
              </button>
            </fieldset>
          </form>
        }
      </dialog>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .contact-trigger {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      width: 100%;
      background: #216b4c;
      color: white;
      border: 0;
      border-radius: 7px;
      padding: 11px 15px;
      font-size: 12px;
      font-weight: 600;
    }
    dialog {
      position: fixed;
      inset: 0;
      margin: auto;
      width: min(500px, calc(100vw - 28px));
      max-height: calc(100dvh - 32px);
      background: var(--surface);
      color: var(--text);
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 30px;
      box-shadow: 0 25px 70px #0003;
    }
    dialog::backdrop {
      background: #0b1c2880;
    }
    h2 {
      font-size: 24px;
      font-weight: 600;
      letter-spacing: -0.03em;
      margin: 10px 0 14px;
    }
    p {
      font-size: 12px;
      line-height: 1.7;
      color: var(--muted);
      margin: 12px 0 20px;
    }
    fieldset {
      border: 0;
      padding: 0;
    }
    label {
      display: flex;
      flex-direction: column;
      gap: 7px;
      margin-bottom: 15px;
      font-size: 12px;
    }
    input,
    textarea {
      padding: 10px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--surface);
      color: var(--text);
      font: inherit;
    }
    button {
      padding: 11px 17px;
      background: #216b4c;
      color: white;
      border-radius: 6px;
      font-size: 12px;
      cursor: pointer;
    }
    .close {
      position: absolute;
      right: 12px;
      top: 10px;
      background: transparent;
      color: var(--muted);
      padding: 5px 10px;
      font-size: 24px;
    }
    .consent {
      flex-direction: row;
      align-items: flex-start;
      gap: 9px;
      line-height: 1.6;
    }
    .consent input {
      margin-top: 3px;
      accent-color: #216b4c;
    }
    .honeypot {
      position: absolute;
      left: -9999px;
    }
    .error {
      color: #b33e35;
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    :focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 3px;
    }
  `,
})
export class TeamContactComponent {
  readonly teamId = input.required<string>();
  readonly boardId = input.required<string>();
  readonly teams = inject(TeamsService);
  @ViewChild('dialog') dialog?: ElementRef<HTMLDialogElement>;
  readonly busy = signal(false);
  readonly error = signal('');
  readonly sent = signal(false);
  form = { name: '', email: '', phone: '', message: '', consent: false, website: '' };
  private requestId = '';
  open(): void {
    this.dialog?.nativeElement.showModal();
  }
  close(): void {
    if (!this.busy()) this.dialog?.nativeElement.close();
  }
  async submit(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.requestId ||= crypto.randomUUID();
    try {
      await httpsCallable(
        getFirebaseFunctions(),
        'submitTeamContact',
      )({ ...this.form, boardId: this.boardId(), requestId: this.requestId });
      this.sent.set(true);
    } catch (error) {
      this.error.set(teamError(error));
    } finally {
      this.busy.set(false);
    }
  }
}
