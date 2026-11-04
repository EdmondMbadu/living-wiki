import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { BackdropDismissDirective } from '../backdrop-dismiss.directive';
import { BOARD_COLLECTION_MAX_BOARDS, BoardCollectionsService, type BoardCollection, type BoardCollectionChoice, type LoadedBoardCollection } from '../board-collections.service';
import { CustomPublicUrlDialogComponent } from '../custom-public-url-dialog/custom-public-url-dialog';
import type { SetCustomPublicUrlResult } from '../custom-public-url';
import type { CityBoardListing } from '../city-board-listings.service';

type EditorTab = 'details' | 'boards' | 'link';

@Component({
  selector: 'app-board-collection-editor',
  imports: [BackdropDismissDirective, CustomPublicUrlDialogComponent],
  templateUrl: './board-collection-editor.html',
  styleUrl: './board-collection-editor.css',
})
export class BoardCollectionEditorComponent implements OnInit, AfterViewInit, OnDestroy {
  private readonly service = inject(BoardCollectionsService);
  private readonly dialog = viewChild.required<ElementRef<HTMLElement>>('dialog');
  readonly collection = input.required<BoardCollection>();
  readonly initialTab = input<EditorTab>('details');
  readonly initialPicker = input(false);
  readonly boards = input<CityBoardListing[]>([]);
  readonly eligible = input(false);
  readonly closed = output<void>();
  readonly saved = output<LoadedBoardCollection>();
  readonly customSaved = output<SetCustomPublicUrlResult>();
  readonly title = signal('');
  readonly description = signal('');
  readonly boardIds = signal<string[]>([]);
  readonly choices = signal<BoardCollectionChoice[]>([]);
  readonly loading = signal(false);
  readonly choicesError = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly saving = signal(false);
  readonly tab = signal<EditorTab>('details');
  readonly pickerOpen = signal(false);
  readonly search = signal('');
  readonly pendingIds = signal<string[]>([]);
  readonly discardOpen = signal(false);
  readonly customUrlOpen = signal(false);
  readonly maxBoards = BOARD_COLLECTION_MAX_BOARDS;
  private baseline!: BoardCollection;
  private previousFocus: HTMLElement | null = null;
  private previousOverflow = '';
  private focusFrame: number | null = null;
  private destroyed = false;
  private draggedId: string | null = null;
  readonly dirty = computed(() => !!this.baseline && (
    this.title() !== this.baseline.title || this.description() !== this.baseline.description
    || JSON.stringify(this.boardIds()) !== JSON.stringify(this.baseline.boardIds)
  ));
  readonly canSave = computed(() => !!this.title().trim() && this.dirty() && !this.saving());
  readonly filteredChoices = computed(() => {
    const query = this.search().trim().toLocaleLowerCase();
    return this.choices().filter(board => !this.boardIds().includes(board.id)
      && (!query || `${board.title} ${board.description}`.toLocaleLowerCase().includes(query)));
  });

  ngOnInit(): void {
    this.baseline = this.collection();
    this.title.set(this.baseline.title);
    this.description.set(this.baseline.description);
    this.boardIds.set([...this.baseline.boardIds]);
    this.choices.set(this.boards());
    this.tab.set(this.initialTab());
    this.pickerOpen.set(this.initialPicker());
    void this.loadChoices();
  }

  ngAfterViewInit(): void {
    this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    this.focusFrame = requestAnimationFrame(() => {
      this.focusFrame = null;
      this.dialog().nativeElement.querySelector<HTMLElement>('input, button')?.focus();
    });
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    if (this.focusFrame !== null) cancelAnimationFrame(this.focusFrame);
    document.body.style.overflow = this.previousOverflow;
    this.previousFocus?.focus();
  }

  async loadChoices(): Promise<void> {
    this.loading.set(true);
    this.choicesError.set(null);
    try {
      const choices = await this.service.listChoices(this.collection().ownerUserId);
      if (!this.destroyed) this.choices.set(choices);
    } catch {
      if (!this.destroyed) this.choicesError.set($localize`Your boards could not be loaded. You can still edit the collection or try again.`);
    } finally {
      if (!this.destroyed) this.loading.set(false);
    }
  }

  boardTitle(id: string): string {
    return this.choices().find(board => board.id === id)?.title || $localize`Unavailable board`;
  }

  boardImage(id: string): string { return this.choices().find(board => board.id === id)?.imageUrl || ''; }

  requestClose(): void {
    if (this.saving() || this.customUrlOpen()) return;
    if (this.dirty() || this.pendingIds().length) {
      this.discardOpen.set(true);
      this.focusControl('.editor-discard-actions button');
    }
    else this.closed.emit();
  }

  continueEditing(): void { this.discardOpen.set(false); this.focusControl('.editor-tabs button'); }

  closeCustomUrl(): void { this.customUrlOpen.set(false); this.focusControl('.editor-body button'); }

  togglePicker(): void {
    if (this.pickerOpen()) this.pendingIds.set([]);
    this.pickerOpen.update(open => !open);
  }

  private focusControl(selector: string): void {
    if (this.focusFrame !== null) cancelAnimationFrame(this.focusFrame);
    this.focusFrame = requestAnimationFrame(() => {
      this.focusFrame = null;
      this.dialog().nativeElement.querySelector<HTMLElement>(selector)?.focus();
    });
  }

  onKeydown(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      if (this.discardOpen()) this.continueEditing();
      else this.requestClose();
    }
    if (event.key !== 'Tab') return;
    const controls = Array.from(this.dialog().nativeElement.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href]',
    )).filter(element => element.getClientRects().length > 0);
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }

  toggleChoice(id: string): void {
    this.pendingIds.update(ids => ids.includes(id) ? ids.filter(value => value !== id)
      : this.boardIds().length + ids.length < this.maxBoards ? [...ids, id] : ids);
  }

  addSelected(): void {
    this.boardIds.update(ids => [...ids, ...this.pendingIds().filter(id => !ids.includes(id))].slice(0, this.maxBoards));
    this.pendingIds.set([]);
    this.pickerOpen.set(false);
    this.search.set('');
  }

  remove(id: string): void { if (!this.saving()) this.boardIds.update(ids => ids.filter(value => value !== id)); }

  move(id: string, direction: -1 | 1): void {
    if (this.saving()) return;
    const ids = [...this.boardIds()], from = ids.indexOf(id), to = from + direction;
    if (from < 0 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    this.boardIds.set(ids);
  }

  dragStart(id: string, event: DragEvent): void {
    this.draggedId = id;
    if (event.dataTransfer) { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', id); }
  }
  dragEnd(): void { this.draggedId = null; }
  dragOver(event: DragEvent): void { if (this.draggedId) event.preventDefault(); }
  drop(id: string, event: DragEvent): void {
    event.preventDefault();
    if (this.saving()) return;
    const ids = [...this.boardIds()], from = ids.indexOf(this.draggedId || ''), to = ids.indexOf(id);
    if (from >= 0 && to >= 0 && from !== to) { const [moved] = ids.splice(from, 1); ids.splice(to, 0, moved); this.boardIds.set(ids); }
    this.draggedId = null;
  }

  async save(): Promise<void> {
    if (!this.canSave() || this.pendingIds().length) return;
    this.saving.set(true);
    this.error.set(null);
    try {
      const result = await this.service.update(this.baseline, {
        title: this.title(), description: this.description(), boardIds: this.boardIds(),
      });
      this.saved.emit(result);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : $localize`The collection could not be saved. Try again.`);
    } finally { this.saving.set(false); }
  }
}
