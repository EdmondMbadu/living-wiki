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
