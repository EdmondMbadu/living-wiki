import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../auth.service';
import { OffGridService } from './off-grid.service';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return {promise, resolve};
}
describe('Off Grid directory loading', () => {
  const page = {items: [], cursor: null};
  let uid: ReturnType<typeof signal<string | null>>;
  beforeEach(() => {
    uid = signal<string | null>(null);
    TestBed.configureTestingModule({providers: [provideZonelessChangeDetection(), {
      provide: AuthService, useValue: {uid, waitForReady: () => new Promise(() => {})},
    }]});
  });
  it('loads public gems without waiting for sign-in restoration and shares simultaneous requests', async () => {
    const service = TestBed.inject(OffGridService), pending = deferred<any>();
    const read = spyOn(service, 'publicList').and.returnValue(pending.promise);
    const command = spyOn(service, 'command');
    const first = service.list('explore');
    uid.set('signed-in');
    const second = service.list('explore');
    expect(read).toHaveBeenCalledTimes(1);
    pending.resolve(page);
    expect(await first).toEqual(page);
    expect(await second).toEqual(page);
    expect(await service.list('explore')).toEqual(page);
    expect(read).toHaveBeenCalledTimes(1);
    expect(command).not.toHaveBeenCalled();
  });
  it('does not cache an old response after a privacy change invalidates the directory', async () => {
    const service = TestBed.inject(OffGridService), old = deferred<any>();
    const read = spyOn(service, 'publicList').and.returnValues(old.promise, Promise.resolve(page));
    const first = service.list('explore');
    service.invalidate();
    await service.list('explore');
    old.resolve({items: [{id: 'formerly-public'}], cursor: null});
    await first;
    expect(await service.list('explore')).toEqual(page);
    expect(read).toHaveBeenCalledTimes(2);
  });
  it('allows retry after a failed public request', async () => {
    const service = TestBed.inject(OffGridService);
    const read = spyOn(service, 'publicList').and.returnValues(Promise.reject(new Error('offline')), Promise.resolve(page));
    await expectAsync(service.list('explore')).toBeRejectedWithError('offline');
    expect(await service.list('explore')).toEqual(page);
    expect(read).toHaveBeenCalledTimes(2);
  });
});
describe('Off Grid upload cancellation', () => {
  let original: typeof XMLHttpRequest;
  class UploadRequest {
    status = 200;
    upload = {onprogress: null};
    onload: (() => void) | null = null;
    onabort: (() => void) | null = null;
    onerror: (() => void) | null = null;
    open() {}
    setRequestHeader() {}
    send() { queueMicrotask(() => this.onload?.()); }
    abort() { this.onabort?.(); }
  }
  beforeEach(() => {
    original = window.XMLHttpRequest;
    Object.defineProperty(window, 'XMLHttpRequest', {value: UploadRequest, configurable: true});
    TestBed.configureTestingModule({providers: [provideZonelessChangeDetection(), {provide: AuthService, useValue: {}}]});
  });
  afterEach(() => Object.defineProperty(window, 'XMLHttpRequest', {value: original, configurable: true}));
  const file = new Blob(['test'], {type: 'video/webm'});
  const ticket = {ticketId: 'ticket', uploadUrl: 'https://upload.test/session'};

  it('cancels a ticket that arrives after the user already cancelled', async () => {
    const service = TestBed.inject(OffGridService), pending = deferred<any>();
    const command = spyOn(service, 'command').and.callFake(async action =>
      action === 'beginUpload' ? pending.promise : {} as any);
    const upload = service.upload('gem', file, 'video', {}, () => {});
    upload.cancel();
    pending.resolve(ticket);
    await expectAsync(upload.promise).toBeRejectedWithError('Upload cancelled.');
    expect(command).toHaveBeenCalledWith('cancelUpload', 'gem', {ticketId: 'ticket'});
    expect(command.calls.allArgs().some(args => args[0] === 'finishUpload')).toBeFalse();
  });
  it('does not report success when cancellation races with finalization', async () => {
    const service = TestBed.inject(OffGridService);
    const pending = deferred<any>(), started = deferred<void>();
    const command = spyOn(service, 'command').and.callFake(async action => {
      if (action === 'beginUpload') return ticket as any;
      if (action === 'finishUpload') { started.resolve(); return pending.promise; }
      return {} as any;
    });
    const upload = service.upload('gem', file, 'video', {}, () => {});
    await started.promise;
    upload.cancel();
    pending.resolve({});
    await expectAsync(upload.promise).toBeRejectedWithError('Upload cancelled.');
    expect(command).toHaveBeenCalledWith('cancelUpload', 'gem', {ticketId: 'ticket'});
  });
  it('does not retract a completed upload when its composer is destroyed', async () => {
    const service = TestBed.inject(OffGridService);
    const command = spyOn(service, 'command').and.callFake(async action =>
      action === 'beginUpload' ? ticket as any : {} as any);
    const upload = service.upload('gem', file, 'video', {}, () => {});
    await expectAsync(upload.promise).toBeResolvedTo({ticketId: 'ticket'});
    upload.cancel();
    expect(command.calls.allArgs().some(args => args[0] === 'cancelUpload')).toBeFalse();
  });
});

describe('Off Grid detail request coordination and browse snapshots', () => {
  let uid: ReturnType<typeof signal<string>>;
  beforeEach(() => {
    uid = signal('owner');
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), { provide: AuthService, useValue: { uid, waitForSession: async () => undefined } }] });
  });
  it('combines identical in-flight details and permits fresh reads after completion', async () => {
    const service = TestBed.inject(OffGridService), request = deferred<any>();
    const command = spyOn(service, 'command').and.returnValue(request.promise);
    const first = service.detail('gem'), second = service.detail('gem');
    await Promise.resolve();
    expect(command).toHaveBeenCalledTimes(1);
    request.resolve({ id: 'gem' });
    await first;
    await service.detail('gem');
    expect(command).toHaveBeenCalledTimes(2);
  });
  it('waits only for authentication restoration and combines reads across initial sign-in', async () => {
    uid.set('');
    const session = deferred<void>();
    TestBed.overrideProvider(AuthService, { useValue: {
      uid, waitForSession: () => session.promise, waitForReady: () => new Promise(() => {}),
    } });
    const service = TestBed.inject(OffGridService);
    const command = spyOn(service, 'command').and.resolveTo({ id: 'gem' } as any);
    const first = service.detail('gem');
    uid.set('owner');
    const second = service.detail('gem');
    expect(command).not.toHaveBeenCalled();
    session.resolve();
    expect((await first).id).toBe('gem');
    expect((await second).id).toBe('gem');
    expect(command).toHaveBeenCalledTimes(1);
  });
  it('keeps users separate and an invalidated old request cannot clear a newer one', async () => {
    const service = TestBed.inject(OffGridService), old = deferred<any>(), fresh = deferred<any>();
    const command = spyOn(service, 'command').and.returnValues(old.promise, fresh.promise, Promise.resolve({ id: 'gem' }) as any);
    const first = service.detail('gem');
    await Promise.resolve();
    service.invalidate();
    const second = service.detail('gem');
    await Promise.resolve();
    old.resolve({ id: 'gem' });
    await first;
    const combined = service.detail('gem');
    await Promise.resolve();
    expect(command).toHaveBeenCalledTimes(2);
    uid.set('other');
    await service.detail('gem');
    expect(command).toHaveBeenCalledTimes(3);
    fresh.resolve({ id: 'gem' });
    await second;
    await combined;
  });
  it('allows detail retry after failure', async () => {
    const service = TestBed.inject(OffGridService);
    const command = spyOn(service, 'command').and.callFake(async () => {
      if (command.calls.count() === 1) throw new Error('offline');
      return { id: 'gem' } as any;
    });
    await expectAsync(service.detail('gem')).toBeRejectedWithError('offline');
    expect((await service.detail('gem')).id).toBe('gem');
  });
  const spot: any = { id: 'gem', title: 'Private title', ownerUid: 'owner', creatorUid: 'owner', visibility: 'private', clips: [{ id: 'pending' }], canContribute: true, sourceRef: { boardId: 'board', cardId: 'card' } };
  const browse: any = { uid: 'owner', scope: 'mine', mode: 'grid', search: 'park', items: [spot], cursor: null, more: false, mapItems: null, mapTruncated: false, bounds: null, scrollY: 150, selectedId: 'gem' };
  it('never treats a preview as authority and drops private state on account change', () => {
    const service = TestBed.inject(OffGridService);
    service.rememberBrowse(browse);
    service.rememberSelection(spot);
    expect(service.preview('gem')?.ownerUid).toBe('');
    expect(service.preview('gem')?.clips).toEqual([]);
    expect(service.preview('gem')?.canContribute).toBeFalse();
    expect(service.preview('gem')?.sourceRef).toBeNull();
    uid.set('other');
    expect(service.preview('gem')).toBeNull();
    expect(service.restoreBrowse()).toBeNull();
  });
  it('retains navigation state but revalidates stale or invalidated pages', () => {
    const service = TestBed.inject(OffGridService);
    service.rememberBrowse(browse);
    expect(service.restoreBrowse()?.items.length).toBe(1);
    service.invalidate();
    const restored = service.restoreBrowse();
    expect(restored?.items).toEqual([]);
    expect(restored?.restoreCount).toBe(1);
    expect(restored?.search).toBe('park');
    expect(restored?.scrollY).toBe(150);
    expect(service.preview('gem')).toBeNull();
  });
  it('removes a previous account snapshot instead of reviving it after another switch', () => {
    const service = TestBed.inject(OffGridService);
    service.rememberBrowse(browse);
    uid.set('other');
    service.invalidate();
    uid.set('owner');
    expect(service.restoreBrowse()).toBeNull();
  });
});
