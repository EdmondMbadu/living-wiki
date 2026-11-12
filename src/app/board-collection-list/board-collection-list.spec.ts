import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BoardCollectionsService, type BoardCollection, type BoardCollectionCoverBoard } from '../board-collections.service';
import { BoardCollectionListComponent } from './board-collection-list';

describe('BoardCollectionListComponent covers', () => {
  const pixel = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  const board = (id: string, fields: Partial<BoardCollectionCoverBoard> = {}): BoardCollectionCoverBoard => ({
    id, ownerUserId: 'owner', visibility: 'public', imageUrl: `${pixel}#${id}`, ...fields,
  });
  const collection: BoardCollection = {
    id: 'collection', slug: 'day-trips', customSlug: '', ownerUserId: 'owner',
    ownerPublicSlug: 'curator', ownerDisplayName: 'Curator', ownerPhotoUrl: '',
    ownerProfileIcon: '', ownerProfilePictureType: null, visibility: 'public',
    title: 'Day trips', description: '', boardIds: [], createdAt: '', updatedAt: '',
  };
  const load = jasmine.createSpy('listPublicCoverBoards');

  beforeEach(() => {
    load.calls.reset();
    load.and.resolveTo([]);
    TestBed.configureTestingModule({
      imports: [BoardCollectionListComponent],
      providers: [
        provideZonelessChangeDetection(), provideRouter([]),
        { provide: BoardCollectionsService, useValue: { listPublicCoverBoards: load } },
      ],
    });
  });

  function render(boardIds: string[], boards: BoardCollectionCoverBoard[]) {
    const fixture = TestBed.createComponent(BoardCollectionListComponent);
    fixture.componentRef.setInput('collections', [{ ...collection, boardIds }]);
    fixture.componentRef.setInput('coverBoards', boards);
    fixture.detectChanges();
    return fixture;
  }

  it('uses up to three distinct covers in collection order and excludes ineligible boards', () => {
    const first = board('first');
    const second = board('second');
    const third = board('third');
    const fixture = render(['private', 'first', 'duplicate', 'other-owner', 'nested', 'second', 'third', 'later'], [
      third, second, first, board('later'), board('duplicate', { imageUrl: first.imageUrl }),
      board('private', { visibility: 'private' }), board('other-owner', { ownerUserId: 'someone-else' }),
      board('nested', { parentCardId: 'parent-card' }),
    ]);
    const root: HTMLElement = fixture.nativeElement;
    const images = Array.from(root.querySelectorAll('img'));
    expect(images.map(image => image.getAttribute('src'))).toEqual([first.imageUrl, second.imageUrl, third.imageUrl]);
    expect(root.querySelector('.board-collection-card__covers--mosaic')).not.toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it('loads covers for boards outside the current profile page', async () => {
    const first = board('first');
    const second = board('second');
    load.and.resolveTo([first]);
    const fixture = render(['first', 'second'], [second]);
    await Promise.resolve();
    await fixture.whenStable();
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    expect(load).toHaveBeenCalledOnceWith(['first']);
    expect(Array.from(root.querySelectorAll('img')).map(image => image.getAttribute('src'))).toEqual([first.imageUrl, second.imageUrl]);
    expect(root.querySelector('.board-collection-card__covers--split')).not.toBeNull();
  });

  it('uses the collection artwork when its only cover fails to load', () => {
    const fixture = render(['first'], [board('first')]);
    const root: HTMLElement = fixture.nativeElement;
    root.querySelector('img')!.dispatchEvent(new Event('error'));
    fixture.detectChanges();
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('.board-collection-card__art .material-symbols-outlined')?.textContent).toBe('collections_bookmark');
  });
});
