import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../auth.service';
import { OffGridService } from './off-grid.service';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return {promise, resolve};
}
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
