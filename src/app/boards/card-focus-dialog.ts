import { AfterViewInit, Component, ElementRef, HostListener, ViewChild, computed, input, output } from '@angular/core';
import { findCardPath, type ShareableCard } from './card-share';
import { trapCardDialogFocus } from './card-dialog-focus';
import { ActivatedRoute, Router } from '@angular/router';
import { inject } from '@angular/core';

@Component({
  selector: 'app-card-focus-dialog',
  templateUrl: './card-focus-dialog.html',
})
export class CardFocusDialogComponent implements AfterViewInit {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly boardTitle = input.required<string>();
  readonly cards = input.required<readonly ShareableCard[]>();
  readonly cardId = input.required<string>();
  readonly canViewAuthorOnly = input.required<boolean>();
  readonly suspended = input(false);
  readonly path = computed(() => {
    const path = findCardPath(this.cards(), this.cardId());
    return path && (!path.authorOnly || this.canViewAuthorOnly()) ? path : null;
  });
  readonly imageUrl = computed(() => {
    const card = this.path()?.card;
    return card?.imageUrl || card?.imageUrls?.[0] || '';
  });
  readonly viewBoard = output<{ cardId: string; parentId: string | null }>();
  readonly share = output<string>();
  @ViewChild('closeButton') private closeButton?: ElementRef<HTMLButtonElement>;

  ngAfterViewInit(): void {
    this.closeButton?.nativeElement.focus();
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (this.suspended()) return;
    if (event.key === 'Escape') { event.preventDefault(); this.close(); }
    else if (event.key === 'Tab') {
      const root = this.closeButton?.nativeElement.closest<HTMLElement>('.card-focus-dialog');
      if (root) trapCardDialogFocus(event, root);
    }
  }

  showOnBoard(): void {
    const path = this.path();
    if (!path) { this.close(); return; }
    this.viewBoard.emit({ cardId: path.card.id, parentId: path.parentId });
    this.close();
    window.setTimeout(() => {
      const card = document.querySelector<HTMLElement>(`[data-analytics-card-id="${CSS.escape(path.card.id)}"]`);
      card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card?.focus({ preventScroll: true });
    }, 100);
  }

  close(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { card: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
