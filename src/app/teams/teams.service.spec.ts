import { signal } from '@angular/core';
import { TeamsService } from './teams.service';
import { teamsServiceStub } from './teams.testing';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe('TeamsService account availability', () => {
  let service: TeamsService;
  let uid: ReturnType<typeof signal<string | null>>;
  let command: jasmine.Spy;
  beforeEach(() => {
    uid = signal<string | null>('owner');
    command = jasmine.createSpy('command');
    // Exercise the real refresh method without starting Firebase listeners or making network calls.
    const { refreshAccount, ...state } = teamsServiceStub();
    service = Object.assign(Object.create(TeamsService.prototype), state, {
      auth: { uid },
      browser: true,
      accountRequest: 0,
      command,
    });
  });

  it('reports failed checks as errors, not a denied allowance or an empty inbox', async () => {
    command.and.rejectWith(new Error('Service unavailable'));
    await service.refreshAccount();
    expect(service.canCreate()).toBeNull();
    expect(service.allowanceState()).toBe('error');
    expect(service.invitationsState()).toBe('error');
  });

  it('shows loading until confirmed and recovers from an error on retry', async () => {
    command.and.rejectWith(new Error('Offline'));
    await service.refreshAccount();
    const allowance = deferred<{ canCreate: boolean }>();
    const inbox = deferred<{ invitations: [] }>();
    command.and.callFake((action: string) =>
      action === 'allowance' ? allowance.promise : inbox.promise,
    );
    const refresh = service.refreshAccount();
    expect(service.allowanceState()).toBe('loading');
    expect(service.invitationsState()).toBe('loading');
    allowance.resolve({ canCreate: true });
    inbox.resolve({ invitations: [] });
    await refresh;
    expect(service.canCreate()).toBeTrue();
    expect(service.allowanceState()).toBe('ready');
    expect(service.invitationsState()).toBe('ready');
    expect(service.invitations()).toEqual([]);
  });

  it('keeps an inbox failure independent of a confirmed creation allowance', async () => {
    command.and.callFake((action: string) =>
      action === 'allowance'
        ? Promise.resolve({ canCreate: true })
        : Promise.reject(new Error('Inbox failed')),
    );
    await service.refreshAccount();
    expect(service.canCreate()).toBeTrue();
    expect(service.allowanceState()).toBe('ready');
    expect(service.invitationsState()).toBe('error');
  });

  it('does not let an older failed request overwrite a successful retry', async () => {
    const old = deferred<any>();
    command.and.returnValue(old.promise);
    const first = service.refreshAccount();
    command.and.callFake(async (action: string) =>
      action === 'allowance' ? { canCreate: false } : { invitations: [] },
    );
    await service.refreshAccount();
    old.reject(new Error('Late failure'));
    await first;
    expect(service.canCreate()).toBeFalse();
    expect(service.allowanceState()).toBe('ready');
    expect(service.invitationsState()).toBe('ready');
  });

  it('ignores responses after the signed-in account changes', async () => {
    const old = deferred<any>();
    command.and.returnValue(old.promise);
    const refresh = service.refreshAccount();
    uid.set('another-owner');
    old.resolve({ canCreate: false, invitations: [] });
    await refresh;
    expect(service.canCreate()).toBeTrue();
    expect(service.allowanceState()).toBe('loading');
  });
});
