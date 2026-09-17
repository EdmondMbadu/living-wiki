import { NO_ERRORS_SCHEMA, provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, RouterLink } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { OffGridDetailComponent } from './off-grid-detail';
import { OffGridService } from './off-grid.service';
import { OffGridSpot } from './off-grid.models';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const gem = (id = 'gem', title = 'The complete gem story'): OffGridSpot => ({
  id, title, tip: 'The full story\nwith a second paragraph.', ownerUid: 'owner', creatorUid: 'owner',
  creatorName: 'Owner', createdAt: 'now', visibility: 'public', status: 'active',
  location: { lat: 0, lng: -75, source: 'map', confirmedAt: 'now' }, cover: false,
  clips: [], shareUrl: 'https://example.test/share/off-grid/' + id,
});

async function settle(fixture: ComponentFixture<unknown>) {
  // Flush native promise continuations as well as Angular's zoneless rendering.
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  fixture.detectChanges();
  await fixture.whenStable();
}

describe('Off Grid destination', () => {
  let uid: ReturnType<typeof signal<string>>;
  let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let ready: ReturnType<typeof deferred<void>>;
  let service: any;
  beforeEach(() => {
    uid = signal('');
    params = new BehaviorSubject(convertToParamMap({ spotId: 'gem' }));
    ready = deferred<void>();
    service = {
      auth: { uid, isAuthenticated: () => !!uid(), waitForReady: () => ready.promise },
      list: jasmine.createSpy('list'), preview: jasmine.createSpy('preview').and.returnValue(null),
      detail: jasmine.createSpy('detail').and.resolveTo(gem()), savedIds: async () => new Set(),
      invalidate: jasmine.createSpy('invalidate'), command: jasmine.createSpy('command').and.resolveTo({}),
      savePin: jasmine.createSpy('savePin').and.resolveTo(undefined),
    };
    TestBed.configureTestingModule({
      imports: [OffGridDetailComponent],
      providers: [provideZonelessChangeDetection(), provideRouter([]),
        { provide: ActivatedRoute, useValue: { paramMap: params, get snapshot() { return { paramMap: params.value }; } } },
        { provide: OffGridService, useValue: service }],
    }).overrideComponent(OffGridDetailComponent, { set: { imports: [RouterLink], schemas: [NO_ERRORS_SCHEMA] } });
    spyOn(window, 'scrollTo');
  });
  it('loads a direct URL once, renders a centered page with the full story, and never loads the directory', async () => {
    const fixture = TestBed.createComponent(OffGridDetailComponent);
    fixture.detectChanges();
    await settle(fixture);
    expect(service.detail).toHaveBeenCalledTimes(1);
    expect(service.list).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('.directory')).toBeNull();
    expect(fixture.nativeElement.querySelector('h1').textContent).toContain(gem().title);
    expect(fixture.nativeElement.querySelector('.detail-tip').textContent).toContain('with a second paragraph.');
    ready.resolve();
    await settle(fixture);
    expect(service.detail).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.directions(gem())).toContain('destination=0%2C-75');
    fixture.destroy();
  });
  it('shows a preview immediately but gates actions and clears it if current access is denied', async () => {
    const request = deferred<OffGridSpot>();
    service.preview.and.returnValue(gem());
    service.detail.and.returnValue(request.promise);
    const fixture = TestBed.createComponent(OffGridDetailComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h1').textContent).toContain(gem().title);
    expect(fixture.nativeElement.querySelector('.main-actions button').disabled).toBeTrue();
    expect(fixture.nativeElement.querySelector('.pin-talk-section')).toBeNull();
    ready.resolve();
    request.reject(new Error('private'));
    await settle(fixture);
    expect(fixture.componentInstance.selected()).toBeNull();
    expect(fixture.nativeElement.querySelector('.stage-error')).not.toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain(gem().title);
    fixture.destroy();
  });
  it('discards a late response after A-to-B navigation and clears A during B loading', async () => {
    const first = deferred<OffGridSpot>(), second = deferred<OffGridSpot>();
    service.detail.and.returnValues(first.promise, second.promise);
    const fixture = TestBed.createComponent(OffGridDetailComponent);
    fixture.detectChanges();
    params.next(convertToParamMap({ spotId: 'second' }));
    fixture.detectChanges();
    expect(fixture.componentInstance.selected()).toBeNull();
    second.resolve(gem('second', 'Second gem'));
    await settle(fixture);
    first.resolve(gem('gem', 'Stale first gem'));
    await settle(fixture);
    expect(fixture.componentInstance.selected()?.id).toBe('second');
    expect(fixture.nativeElement.querySelector('h1').textContent).toContain('Second gem');
    expect(fixture.nativeElement.textContent).not.toContain('Stale first gem');
    fixture.destroy();
  });
  it('refreshes permissions when the restored user changes, and clears private detail on logout', async () => {
    const guest = deferred<OffGridSpot>();
    service.detail.and.callFake(() => {
      if (service.detail.calls.count() === 1) return guest.promise;
      return uid() ? Promise.resolve({ ...gem(), visibility: 'private' }) : Promise.reject(new Error('private'));
    });
    const fixture = TestBed.createComponent(OffGridDetailComponent);
    fixture.detectChanges();
    uid.set('owner');
    fixture.detectChanges();
    ready.resolve();
    await settle(fixture);
    expect(fixture.componentInstance.owner()).toBeTrue();
    guest.resolve(gem('gem', 'Late anonymous result'));
    await settle(fixture);
    expect(fixture.componentInstance.selected()?.visibility).toBe('private');
    uid.set('');
    fixture.detectChanges();
    expect(fixture.componentInstance.selected()).toBeNull();
    await settle(fixture);
    expect(fixture.componentInstance.owner()).toBeFalse();
    expect(fixture.componentInstance.detailError()).not.toBe('');
    fixture.destroy();
  });
  it('cannot reopen an old gem when a moderation operation finishes after navigation', async () => {
    uid.set('owner');
    const mutation = deferred<any>();
    service.command.and.returnValue(mutation.promise);
    service.detail.and.callFake(async (id: string) => gem(id));
    const fixture = TestBed.createComponent(OffGridDetailComponent);
    fixture.detectChanges();
    await settle(fixture);
    const action = fixture.componentInstance.clipAction('approveClip', 'clip');
    params.next(convertToParamMap({ spotId: 'second' }));
    await settle(fixture);
    mutation.resolve({});
    await action;
    expect(service.detail.calls.allArgs()).toEqual([['gem'], ['second']]);
    expect(fixture.componentInstance.selected()?.id).toBe('second');
    fixture.destroy();
  });
  it('does not let an old action clear a new route action’s busy state', async () => {
    uid.set('owner');
    const first = deferred<any>(), second = deferred<any>();
    service.command.and.returnValues(first.promise, second.promise);
    service.detail.and.callFake(async (id: string) => gem(id));
    const fixture = TestBed.createComponent(OffGridDetailComponent);
    fixture.detectChanges();
    await settle(fixture);
    const oldAction = fixture.componentInstance.clipAction('approveClip', 'first-clip');
    params.next(convertToParamMap({ spotId: 'second' }));
    await settle(fixture);
    expect(fixture.componentInstance.busy()).toBeFalse();
    const currentAction = fixture.componentInstance.clipAction('approveClip', 'second-clip');
    first.resolve({});
    await oldAction;
    expect(fixture.componentInstance.busy()).toBeTrue();
    second.resolve({});
    await currentAction;
    expect(fixture.componentInstance.busy()).toBeFalse();
    fixture.destroy();
  });
  it('saves and unsaves the validated gem and keeps existing public clip ordering', async () => {
    uid.set('owner');
    service.detail.and.resolveTo({ ...gem(), clips: [
      { id: 'regular', featured: false }, { id: 'featured', featured: true },
    ] });
    const fixture = TestBed.createComponent(OffGridDetailComponent);
    fixture.detectChanges();
    await settle(fixture);
    await fixture.componentInstance.toggleSave(gem());
    expect(service.savePin).toHaveBeenCalledWith('gem', true);
    expect(fixture.componentInstance.saved().has('gem')).toBeTrue();
    await fixture.componentInstance.toggleSave(gem());
    expect(service.savePin).toHaveBeenCalledWith('gem', false);
    expect(fixture.componentInstance.saved().has('gem')).toBeFalse();
    expect(fixture.componentInstance.sortedClips().map(clip => clip.id)).toEqual(['featured', 'regular']);
    fixture.destroy();
  });
  it('moves focus into the dialog, traps Tab and restores focus on Escape', async () => {
    uid.set('owner');
    service.detail.and.resolveTo({ ...gem(), visibility: 'private' });
    const fixture = TestBed.createComponent(OffGridDetailComponent);
    fixture.detectChanges();
    await settle(fixture);
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    fixture.componentInstance.openSheet('share');
    fixture.detectChanges();
    await settle(fixture);
    const dialog = fixture.nativeElement.querySelector('.action-sheet') as HTMLElement;
    const close = dialog.querySelector('button') as HTMLButtonElement;
    expect(document.activeElement).toBe(close);
    const last = dialog.querySelector('a') as HTMLAnchorElement;
    last.focus();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });
    fixture.componentInstance.onKey(tab);
    expect(tab.defaultPrevented).toBeTrue();
    expect(document.activeElement).toBe(close);
    fixture.componentInstance.onKey(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    fixture.detectChanges();
    expect(fixture.componentInstance.sheet()).toBeNull();
    expect(document.activeElement).toBe(opener);
    opener.remove();
    fixture.destroy();
  });
});
