import { Component, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PlacePhotoDirective, PLACE_PHOTO_FALLBACK } from './place-photo.directive';
import { PLACE_PHOTO_ENDPOINT } from './place-photo';

@Component({ imports: [PlacePhotoDirective], template: '<div><img [src]="url" alt="A place" /></div>' })
class Host { url = ''; }

describe('PlacePhotoDirective', () => {
  const stable = PLACE_PHOTO_ENDPOINT + '?placeId=ChIJd8kca4PIxokRqW59OWceihQ';
  const response = () => new Response(new Blob([Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), (c) => c.charCodeAt(0))], { type: 'image/gif' }), {
    headers: { 'content-type': 'image/jpeg', 'X-Place-Attributions': encodeURIComponent(JSON.stringify(['<a href="https://example.com">Test photographer</a>'])) },
  });
  beforeEach(() => TestBed.configureTestingModule({ imports: [Host], providers: [provideZonelessChangeDetection()] }));
  it('leaves non-Google images on the native loading path', () => {
    const fetcher = spyOn(window, 'fetch');
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.url = PLACE_PHOTO_FALLBACK;
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('img').src).toBe(PLACE_PHOTO_FALLBACK);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('loads a stable image, renders safe current credits and releases object URLs', async () => {
    spyOn(window, 'fetch').and.resolveTo(response());
    const create = spyOn(URL, 'createObjectURL').and.callThrough();
    const revoke = spyOn(URL, 'revokeObjectURL');
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.url = stable;
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fixture.nativeElement.querySelector('img').src).toBe(create.calls.mostRecent().returnValue);
    expect(fixture.nativeElement.querySelector('[data-place-photo-credit]').textContent).toBe('Google Maps · Test photographer');
    expect(fixture.nativeElement.querySelector('[data-place-photo-credit] a')).toBeNull();
    fixture.destroy();
    expect(revoke).toHaveBeenCalledWith(create.calls.mostRecent().returnValue);
  });
  it('uses a clear placeholder on unavailable photos', async () => {
    spyOn(window, 'fetch').and.resolveTo(new Response('', { status: 404 }));
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.url = stable;
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fixture.nativeElement.querySelector('img').src).toBe(PLACE_PHOTO_FALLBACK);
    expect(fixture.nativeElement.querySelector('[data-place-photo-credit]')).toBeNull();
  });
  it('does not duplicate foreground credits on decorative image backdrops', async () => {
    spyOn(window, 'fetch').and.resolveTo(response());
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.url = stable;
    fixture.detectChanges();
    fixture.nativeElement.querySelector('img').setAttribute('aria-hidden', 'true');
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fixture.nativeElement.querySelector('img').src.startsWith('blob:')).toBeTrue();
    expect(fixture.nativeElement.querySelector('[data-place-photo-credit]')).toBeNull();
  });
  it('ignores stale requests after switching to a custom image', async () => {
    let finish!: (response: Response) => void;
    spyOn(window, 'fetch').and.returnValue(new Promise((resolve) => { finish = resolve; }));
    const create = spyOn(URL, 'createObjectURL');
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.url = stable;
    fixture.detectChanges();
    fixture.componentInstance.url = PLACE_PHOTO_FALLBACK;
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    finish(response());
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fixture.nativeElement.querySelector('img').src).toBe(PLACE_PHOTO_FALLBACK);
    expect(create).not.toHaveBeenCalled();
  });
});
