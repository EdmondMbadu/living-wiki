import { AfterViewInit, Component, ElementRef, HostListener, OnDestroy, ViewChild, computed, input, output, signal } from '@angular/core';
import { generateQrSvg, generateQrSvgDataUrl } from '../qr-code';
import { canShareCardPublicly, findCardPath, narratedLiveCard, publicCardUrl, type ShareableBoard } from './card-share';
import { trapCardDialogFocus } from './card-dialog-focus';

@Component({
  selector: 'app-card-share-dialog',
  templateUrl: './card-share-dialog.html',
})
export class CardShareDialogComponent implements AfterViewInit, OnDestroy {
  readonly boards = input.required<readonly ShareableBoard[]>();
  readonly target = input.required<{ boardId: string; cardId: string }>();
  readonly closed = output<void>();
  readonly feedback = signal<string | null>(null);
  readonly board = computed(() => this.boards().find((board) => board.id === this.target().boardId) ?? null);
  readonly path = computed(() => {
    const board = this.board();
    return board ? findCardPath(board.cards, this.target().cardId) : null;
  });
  readonly title = computed(() => this.path()?.card.title || 'card');
  readonly opensLive = computed(() => {
    const board = this.board();
    return !!board && !!narratedLiveCard(board.cards, this.target().cardId);
  });
  readonly allowed = computed(() => {
    const board = this.board();
    const path = this.path();
    return !!board && !!path && canShareCardPublicly(board.visibility, board.teamDraft, path.authorOnly);
  });
  readonly url = computed(() => this.allowed() ? publicCardUrl(this.target().boardId, this.target().cardId) : '');
  readonly qrImage = computed(() => this.url() ? generateQrSvgDataUrl(this.url()) : '');
  @ViewChild('closeButton') private closeButton?: ElementRef<HTMLButtonElement>;

  ngAfterViewInit(): void {
    this.closeButton?.nativeElement.focus();
  }

  ngOnDestroy(): void {
    if (typeof window === 'undefined') return;
    const cardId = this.target().cardId;
    window.setTimeout(() => {
      (document.querySelector<HTMLButtonElement>('.card-focus-dialog__close')
        ?? document.getElementById(`card-action-trigger-card:${cardId}`)
        ?? document.querySelector<HTMLButtonElement>('.stack-viewer-actions button'))?.focus();
    }, 0);
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') { event.preventDefault(); this.closed.emit(); }
    else if (event.key === 'Tab') {
      const root = this.closeButton?.nativeElement.closest<HTMLElement>('.card-share-dialog');
      if (root) trapCardDialogFocus(event, root);
    }
  }

  async copyUrl(): Promise<void> {
    const url = this.url();
    if (!url) return;
    let copied = false;
    if (navigator.clipboard?.writeText) {
      try {
        copied = await Promise.race([
          navigator.clipboard.writeText(url).then(() => true),
          new Promise<boolean>((resolve) => window.setTimeout(() => resolve(false), 700)),
        ]);
      } catch { /* Fall through to selection-based copying. */ }
    }
    if (!copied) {
      const field = document.createElement('textarea');
      field.value = url;
      field.readOnly = true;
      field.style.position = 'fixed';
      field.style.left = '-9999px';
      document.body.appendChild(field);
      field.select();
      copied = document.execCommand('copy');
      field.remove();
    }
    this.feedback.set(copied ? $localize`Card link copied.` : $localize`Copy failed. You can select the link above.`);
  }

  private downloadBlob(blob: Blob, extension: 'svg' | 'png'): void {
    const filename = this.title().toLowerCase().normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'card';
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${filename}-qr.${extension}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async download(format: 'svg' | 'png'): Promise<void> {
    if (!this.url()) return;
    const svg = generateQrSvg(this.url());
    if (format === 'svg') {
      this.downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), 'svg');
      return;
    }
    try {
      const image = new Image();
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 1200;
      canvas.height = 1200;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas unavailable');
      context.imageSmoothingEnabled = false;
      context.drawImage(image, 0, 0, 1200, 1200);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('PNG unavailable');
      this.downloadBlob(blob, 'png');
    } catch {
      this.feedback.set($localize`PNG download failed. Try the SVG download.`);
    }
  }
}
