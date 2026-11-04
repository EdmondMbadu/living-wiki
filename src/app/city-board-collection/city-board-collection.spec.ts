import { PLATFORM_ID, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { CityBoardCollectionComponent } from './city-board-collection';
import { BoardCollectionsService, type BoardCollection } from '../board-collections.service';
import { AuthService } from '../auth.service';
import { AtlasService } from '../atlas.service';
import { CityBoardListingsService, type CityBoardListing } from '../city-board-listings.service';
import { StackNarrationSessionService } from '../stack-narration-session.service';

const collection: BoardCollection = {
  id:'collection', slug:'music', customSlug:'', ownerUserId:'owner', ownerPublicSlug:'owner',
  ownerDisplayName:'Owner', ownerPhotoUrl:'', ownerProfileIcon:'', ownerProfilePictureType:null,
  visibility:'public', title:'Music', description:'Favorites', boardIds:['first','second'], createdAt:'created', updatedAt:'updated',
};
const boards = ['first','second'].map((id,index) => ({
  id,title:id,description:'',atlasId:'',icon:'music_note',tone:'teal',imageUrl:'',kind:'standard',cardCount:10,
  publisherName:'Owner',templateId:'',categoryId:'',topicIds:[],featuredRank:index,approvedAt:null,updatedAt:null,
})) as CityBoardListing[];

describe('CityBoardCollectionComponent management', () => {
  async function setup(uid='owner',admin=false) {
    const service={getPublic:jasmine.createSpy().and.resolveTo({collection,boards}),delete:jasmine.createSpy().and.resolveTo(undefined)};
    await TestBed.configureTestingModule({
      imports:[CityBoardCollectionComponent],
      providers:[provideZonelessChangeDetection(),provideRouter([]),{provide:PLATFORM_ID,useValue:'server'},
        {provide:ActivatedRoute,useValue:{paramMap:of(convertToParamMap({slug:'music',ownerKey:'owner'})),snapshot:{paramMap:convertToParamMap({slug:'music',ownerKey:'owner'}),data:{userCollection:true}}}},
        {provide:BoardCollectionsService,useValue:service},
        {provide:AuthService,useValue:{uid:signal(uid),isAdmin:()=>admin,hasActivePersonalWikiPlan:()=>false}},
        {provide:AtlasService,useValue:{}},{provide:CityBoardListingsService,useValue:{}},
        {provide:StackNarrationSessionService,useValue:{unlock:jasmine.createSpy().and.resolveTo(undefined)}},
      ],
    }).overrideComponent(CityBoardCollectionComponent,{set:{template:'',imports:[]}}).compileComponents();
    const fixture=TestBed.createComponent(CityBoardCollectionComponent);fixture.detectChanges();await fixture.whenStable();
    return {component:fixture.componentInstance,service,router:TestBed.inject(Router)};
  }

  it('shows editing only to the owner while retaining admin URL and deletion management', async () => {
    const {component}=await setup('admin',true);
    expect(component.canManageCollection()).toBeTrue();expect(component.canEditCollection()).toBeFalse();
    component.openEditor('details');expect(component.editorTab()).toBeNull();
  });
  it('keeps the saved board order in the spotlight and refreshes every view after editing', async () => {
    const {component}=await setup();expect(component.featuredBoards().map(b=>b.id)).toEqual(['first','second']);
    component.openEditor('boards');component.searchQuery.set('old search');
    component.handleCollectionSaved({collection:{...collection,title:'New title',boardIds:['second','first']},boards:[boards[1],boards[0]]});
    expect(component.featuredBoards().map(b=>b.id)).toEqual(['second','first']);
    expect(component.activeFeatured()?.id).toBe('second');expect(component.searchQuery()).toBe('');expect(component.editorTab()).toBeNull();
    expect(component.pageHeading()).toBe('New title');
  });
  it('keeps drafts open when a custom URL is saved inside the editor', async () => {
    const {component,router}=await setup();const navigate=spyOn(router,'navigate').and.resolveTo(true);
    component.openEditor('details');component.handleCustomUrlSaved({resourceType:'collection',resourceId:'collection',slug:'new-link',path:'/collections/new-link'});
    expect(component.userCollection()?.customSlug).toBe('new-link');expect(component.editorTab()).toBe('details');expect(navigate).not.toHaveBeenCalled();
  });
  it('returns to the owner profile after deleting only the collection', async () => {
    const {component,service,router}=await setup();const navigate=spyOn(router,'navigate').and.resolveTo(true);
    await component.deleteCollection();expect(service.delete).toHaveBeenCalledOnceWith(collection);expect(navigate).toHaveBeenCalledWith(['/boards/u','owner']);
  });
  it('retains the page and reports deletion failures', async () => {
    const {component,service,router}=await setup();service.delete.and.rejectWith(new Error('Denied'));const navigate=spyOn(router,'navigate');
    component.deleteOpen.set(true);await component.deleteCollection();expect(component.deleteOpen()).toBeTrue();expect(component.managementError()).toBeTruthy();expect(component.deleting()).toBeFalse();expect(navigate).not.toHaveBeenCalled();
  });
});
