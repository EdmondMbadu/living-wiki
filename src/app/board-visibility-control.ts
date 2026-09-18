import { Component, input, output } from '@angular/core';
import { boardVisibilityDescription, type BoardVisibility } from './board-visibility';

@Component({
  selector: 'app-board-visibility-control',
  template: `
    <div class="choices" role="group" aria-label="Board visibility">
      @for (choice of choices; track choice.value) {
        <button type="button" [class.selected]="value() === choice.value"
          [attr.aria-pressed]="value() === choice.value" [disabled]="disabled()"
          (click)="valueChange.emit(choice.value)">
          <span class="material-symbols-outlined" aria-hidden="true">{{ choice.icon }}</span>
          {{ choice.label }}
        </button>
      }
    </div>
    <p class="help" aria-live="polite">{{ description() }}</p>
  `,
  styles: `
    :host { display: block; width: 100%; }
    .choices { display: flex; flex-wrap: wrap; gap: .5rem; }
    button { display: flex; flex: 1; align-items: center; justify-content: center; gap: .35rem;
      padding: .65rem .6rem; border: 1px solid var(--line, #b6bdb6); border-radius: .65rem;
      background: var(--surface, #fff); color: var(--ink, #193c32); cursor: pointer; font: inherit; }
    button.selected { border-color: var(--accent, #193c32); box-shadow: inset 0 0 0 1px var(--accent, #193c32);
      background: color-mix(in srgb, var(--accent, #193c32) 10%, var(--surface, #fff)); font-weight: 700; }
    button:focus-visible { outline: 2px solid var(--accent, #193c32); outline-offset: 3px; }
    button:disabled { opacity: .6; cursor: default; }
    .material-symbols-outlined { font-size: 1.2rem; }
    .help { margin: .55rem 0 0; font-size: .85rem; line-height: 1.45; color: var(--muted, #52615a); }
  `,
})
export class BoardVisibilityControlComponent {
  readonly value = input.required<BoardVisibility>();
  readonly disabled = input(false);
  readonly team = input(false);
  readonly valueChange = output<BoardVisibility>();
  readonly choices: Array<{ value: BoardVisibility; label: string; icon: string }> = [
    { value: 'public', label: 'Public', icon: 'public' },
    { value: 'unlisted', label: 'Unlisted', icon: 'link' },
    { value: 'private', label: 'Private', icon: 'lock' },
  ];
  description(): string {
    return this.team() && this.value() === 'private'
      ? 'Only accepted team members can view the working copy. Visitor links are unavailable.'
      : boardVisibilityDescription(this.value());
  }
}
