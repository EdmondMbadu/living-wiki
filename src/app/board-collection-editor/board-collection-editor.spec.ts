import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BoardCollectionEditorComponent } from './board-collection-editor';
import { BoardCollectionsService, type BoardCollection, type BoardCollectionChoice } from '../board-collections.service';

const collection: BoardCollection = {
  id:'collection', slug:'music', customSlug:'music-link', ownerUserId:'owner', ownerPublicSlug:'owner',
  ownerDisplayName:'Owner', ownerPhotoUrl:'', ownerProfileIcon:'', ownerProfilePictureType:null,
  visibility:'public', title:'Music', description:'Favorites', boardIds:['one','unavailable'], createdAt:'created', updatedAt:'updated',
};
const choices: BoardCollectionChoice[] = ['one','two','three'].map(id => ({id,title:id,description:'',imageUrl:'',icon:'music_note',tone:'teal',kind:'standard',cardCount:10}));

describe('BoardCollectionEditorComponent', () => {
  async function setup() {
    const service = { listChoices:jasmine.createSpy().and.resolveTo(choices), update:jasmine.createSpy() };
    await TestBed.configureTestingModule({
      imports:[BoardCollectionEditorComponent],
      providers:[provideZonelessChangeDetection(),{provide:BoardCollectionsService,useValue:service}],
    }).compileComponents();
    const fixture = TestBed.createComponent(BoardCollectionEditorComponent);
    fixture.componentRef.setInput('collection',collection);
    fixture.detectChanges();
    await fixture.whenStable();
    return {fixture,editor:fixture.componentInstance,service};
  }

  it('keeps unavailable memberships during a rename and leaves links unchanged', async () => {
    const {editor,service}=await setup();
    const result={collection:{...collection,title:'New name'},boards:[]};
    service.update.and.resolveTo(result);
    const saved=jasmine.createSpy();editor.saved.subscribe(saved);
    editor.title.set('New name');await editor.save();
    expect(service.update).toHaveBeenCalledWith(collection,{title:'New name',description:'Favorites',boardIds:['one','unavailable']});
    expect(saved).toHaveBeenCalledWith(result);
    expect(collection.slug).toBe('music');expect(collection.customSlug).toBe('music-link');
  });

  it('supports removal of the last board without deleting boards', async () => {
    const {editor,service}=await setup();service.update.and.resolveTo({collection:{...collection,boardIds:[]},boards:[]});
    editor.remove('one');editor.remove('unavailable');await editor.save();
    expect(service.update.calls.mostRecent().args[1].boardIds).toEqual([]);
  });

  it('preserves pending selections through search and saves deliberate order', async () => {
    const {editor,service}=await setup();
    editor.toggleChoice('two');editor.search.set('three');
    expect(editor.pendingIds()).toEqual(['two']);expect(editor.filteredChoices().map(b=>b.id)).toEqual(['three']);
    editor.addSelected();editor.move('two',-1);editor.move('two',-1);
    service.update.and.resolveTo({collection,boards:[]});await editor.save();
    expect(service.update.calls.mostRecent().args[1].boardIds).toEqual(['two','one','unavailable']);
  });

  it('enforces the 50-board selection ceiling and excludes existing members', async () => {
    const {editor}=await setup();
    expect(editor.filteredChoices().map(b=>b.id)).toEqual(['two','three']);
    editor.boardIds.set(Array.from({length:49},(_,i)=>`id-${i}`));editor.toggleChoice('two');editor.toggleChoice('three');
    expect(editor.pendingIds()).toEqual(['two']);
  });

  it('asks before discarding changes and retains the draft after failed saves', async () => {
    const {editor,service}=await setup();const closed=jasmine.createSpy();editor.closed.subscribe(closed);
    editor.title.set('Draft');editor.requestClose();expect(editor.discardOpen()).toBeTrue();expect(closed).not.toHaveBeenCalled();
    service.update.and.rejectWith(new Error('Changed elsewhere'));await editor.save();
    expect(editor.title()).toBe('Draft');expect(editor.error()).toBe('Changed elsewhere');expect(editor.saving()).toBeFalse();
  });

  it('does not save uncommitted picker selections or blank titles', async () => {
    const {editor,service}=await setup();editor.title.set('');await editor.save();
    editor.title.set('New');editor.toggleChoice('two');await editor.save();expect(service.update).not.toHaveBeenCalled();
  });
});
