import { Component, DestroyRef, EventEmitter, Output, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BoardCollectionsService, type BoardCollection, type BoardCollectionCoverBoard } from '../board-collections.service';

const MAX_COVERS = 3;

@Component({
  selector: 'app-board-collection-list',
  imports: [RouterLink],
  templateUrl: './board-collection-list.html',
  styleUrl: './board-collection-list.css',
})
export class BoardCollectionListComponent {
  private readonly service = inject(BoardCollectionsService);
  private readonly destroyRef = inject(DestroyRef);
  readonly templateText = {
    message1: $localize`A curated set of LivingWiki boards.`,
    message2: $localize`Collections are unavailable.`,
    message3: $localize`No collections match that search.`,
    message4: $localize`No collections yet.`,
    message5: $localize`board`,
    message6: $localize`boards`,
  };
  readonly collections = input.required<BoardCollection[]>();
  readonly coverBoards = input.required<readonly BoardCollectionCoverBoard[]>();
  readonly loading = input(false);
  readonly error = input<string | null>(null);
  readonly canCreate = input(false);
  readonly searching = input(false);
  @Output() createRequested = new EventEmitter<void>();

  private readonly fetchedBoards = signal<ReadonlyMap<string, BoardCollectionCoverBoard | null>>(new Map());
  private readonly pendingIds = new Set<string>();
  private readonly failedUrls = signal<ReadonlySet<string>>(new Set());
  private readonly boardsById = computed(() => {
    const boards = new Map(this.fetchedBoards());
    for (const board of this.coverBoards()) boards.set(board.id, board);
    return boards;
  });

  readonly tiles = computed(() => {
    const boards = this.boardsById();
    const failed = this.failedUrls();
    return this.collections().map(collection => {
      const covers: BoardCollectionCoverBoard[] = [];
      const missingIds: string[] = [];
      for (const id of collection.boardIds) {
        const board = boards.get(id);
        if (board === undefined && missingIds.length < MAX_COVERS) missingIds.push(id);
        if (!board || board.visibility !== 'public' || board.parentCardId || board.ownerUserId !== collection.ownerUserId) continue;
        if (!board.imageUrl || failed.has(board.imageUrl) || covers.some(cover => cover.imageUrl === board.imageUrl)) continue;
        covers.push(board);
        if (covers.length === MAX_COVERS) break;
      }
      return { collection, covers, missingIds };
    });
  });

  constructor() {
    effect(() => {
      if (this.loading()) return;
      const ids = [...new Set(this.tiles().flatMap(tile => tile.missingIds))].filter(id => !this.pendingIds.has(id));
      if (ids.length) void this.fetchCoverBoards(ids);
    });
  }

  markCoverFailed(url: string): void {
    this.failedUrls.update(failed => new Set(failed).add(url));
  }

  private async fetchCoverBoards(ids: string[]): Promise<void> {
    ids.forEach(id => this.pendingIds.add(id));
    const boards = await this.service.listPublicCoverBoards(ids).catch(() => []);
    if (this.destroyRef.destroyed) return;
    const loaded = new Map(boards.map(board => [board.id, board]));
    ids.forEach(id => this.pendingIds.delete(id));
    this.fetchedBoards.update(previous => {
      const next = new Map(previous);
      ids.forEach(id => next.set(id, loaded.get(id) ?? null));
      return next;
    });
  }

  collectionRoute(collectionItem: BoardCollection): string[] {
    if (collectionItem.customSlug) {
      return ['/collections', collectionItem.customSlug];
    }
    return ['/boards/u', collectionItem.ownerPublicSlug, 'collections', collectionItem.slug];
  }
}
