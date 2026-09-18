import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ListingPhotoSourceComponent } from './listing-photo-source';
import { BoardsComponent } from './boards';

describe('listing photo source controls', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ListingPhotoSourceComponent], providers: [provideZonelessChangeDetection()] }).compileComponents();
  });
  it('starts with URL photos and lets the user choose uploads without submitting the form', async () => {
    const fixture = TestBed.createComponent(ListingPhotoSourceComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('input[type=file]')).toBeNull();
    expect(host.querySelector('button[aria-pressed=true]')?.textContent).toContain('listing URL');
    (host.querySelectorAll('.source-options button')[1] as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(fixture.componentInstance.source()).toBe('upload');
    expect(host.querySelector('input[type=file]')).not.toBeNull();
    expect(host.textContent).toContain('Property facts still come from the listing URL');
    expect(Array.from(host.querySelectorAll('button')).every((button) => button.type === 'button')).toBeTrue();
  });
  it('shows cover selection and emits removal and cover actions for stable photo IDs', async () => {
    const fixture = TestBed.createComponent(ListingPhotoSourceComponent);
    fixture.componentRef.setInput('source', 'upload');
    fixture.componentRef.setInput('photos', [{ id: 'a', name: 'Kitchen.jpg', imageUrl: '' }, { id: 'b', name: 'Bedroom.jpg', imageUrl: '' }]);
    const removed = jasmine.createSpy('removed'); const cover = jasmine.createSpy('cover');
    fixture.componentInstance.removed.subscribe(removed);
    fixture.componentInstance.coverChanged.subscribe(cover);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelectorAll('.cover-label').length).toBe(1);
    expect(host.textContent).toContain('2 photos selected');
    (host.querySelector('button[aria-label="Use Bedroom.jpg as cover"]') as HTMLButtonElement).click();
    (host.querySelector('button[aria-label="Remove Kitchen.jpg"]') as HTMLButtonElement).click();
    expect(cover).toHaveBeenCalledWith('b'); expect(removed).toHaveBeenCalledWith('a');
    fixture.componentRef.setInput('loading', true);
    await fixture.whenStable();
    expect((host.querySelector('input[type=file]') as HTMLInputElement).disabled).toBeTrue();
    expect(host.querySelector('[role=status]')?.textContent).toContain('Preparing');
  });
  it('prevents adding beyond 24 photos and reports preparation errors accessibly', () => {
    const fixture = TestBed.createComponent(ListingPhotoSourceComponent);
    fixture.componentRef.setInput('source', 'upload');
    fixture.componentRef.setInput('photos', Array.from({ length: 24 }, (_, index) => ({ id: `${index}`, name: 'Photo', imageUrl: '' })));
    fixture.componentRef.setInput('error', 'A photo could not be converted.');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('input[type=file]').disabled).toBeTrue();
    expect(fixture.nativeElement.querySelector('[role=alert]').textContent).toContain('could not be converted');
  });
});

describe('listing upload preparation and restoration', () => {
  function harness(): any {
    return Object.assign(Object.create(BoardsComponent.prototype), {
      authService: { uid: () => 'member' }, teamContextId: signal('team-a'), wizardActiveDraftId: signal('draft-a'),
      wizardEntryIntent: signal('real-estate'), wizardListingPhotoSource: signal('upload'), wizardPhotoImportRun: 0,
      wizardPhotos: signal([{ id: 'a', name: 'Kitchen.jpg', imageUrl: 'data:image/jpeg;base64,a', caption: '', sourceKey: 'a', analysisDataUrl: '' },
        { id: 'b', name: 'Bedroom.jpg', imageUrl: 'data:image/jpeg;base64,b', caption: '', sourceKey: 'b', analysisDataUrl: '' }]),
      wizardPhotosLoading: signal(false), wizardListingPhotoUploading: signal(false), wizardPhotoError: signal(null),
      wizardLoadingTask: signal(null), wizardCount: signal(10), teams: { storeMedia: jasmine.createSpy('storeMedia') },
      wizardDefaultType: signal('place'), wizardVibe: signal('curator'), wizardPrompt: signal(''), wizardTargetBoardTitle: signal(''),
      cardTypes: [{ id: 'place' }], cardScopes: [{ id: 'place' }], cardStatuses: [{ id: 'saved' }],
    });
  }
  it('retains successful uploads after a partial failure and retries only remaining photos', async () => {
    const page = harness();
    page.teams.storeMedia.and.returnValues(Promise.resolve('team-media:team-media/team-a/draft-a/a.jpg'), Promise.reject(new Error('Upload interrupted')));
    await expectAsync(page.prepareWizardListingPhotos()).toBeRejectedWithError('Upload interrupted');
    expect(page.wizardPhotos()[0].storagePath).toBe('team-media/team-a/draft-a/a.jpg');
    expect(page.wizardPhotos()[1].storagePath).toBeUndefined();
    expect(page.wizardListingPhotoUploading()).toBeFalse();
    page.teams.storeMedia.and.returnValue(Promise.resolve('team-media:team-media/team-a/draft-a/b.jpg'));
    const stored = await page.prepareWizardListingPhotos();
    expect(page.teams.storeMedia.calls.count()).toBe(3);
    expect(stored.map((photo: any) => photo.id)).toEqual(['a', 'b']);
    expect(stored.every((photo: any) => photo.imageUrl.startsWith('team-media:'))).toBeTrue();
    expect(page.wizardCount()).toBe(10);
    page.makeWizardPhotoCover('b');
    expect(page.storedWizardListingPhotos().map((photo: any) => photo.id)).toEqual(['b', 'a']);
    page.removeWizardPhoto('a');
    expect(page.wizardCount()).toBe(10);
  });
  it('does not attach an in-flight upload to a different draft', async () => {
    const page = harness();
    let finish!: (value: string) => void;
    page.teams.storeMedia.and.returnValue(new Promise<string>((resolve) => { finish = resolve; }));
    const preparing = page.prepareWizardListingPhotos();
    page.wizardActiveDraftId.set('different-draft');
    finish('team-media:team-media/team-a/draft-a/a.jpg');
    await expectAsync(preparing).toBeRejectedWithError(/builder changed/);
    expect(page.wizardPhotos().every((photo: any) => !photo.storagePath)).toBeTrue();
  });
  it('preserves uploaded provenance and the whole gallery when normalizing generated cards', () => {
    const page = harness();
    const urls = Array.from({ length: 24 }, (_, index) => `blob:uploaded-${index}`);
    const card = page.normalizeWizardGeneratedCard({ title: 'Property Overview', type: 'place', notes: 'A property overview.',
      sourceUrl: 'https://example.com/listing', imageSource: 'user-upload', imageUrl: urls[0], imageUrls: urls,
      tags: ['listing', 'real-estate', 'listing-story', 'listing-group', 'group-overview', 'uploaded-image'] });
    expect(card.imageSource).toBe('user-upload');
    expect(card.imageUrls).toEqual(urls);
  });
});
