import { PLATFORM_ID, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService } from './auth.service';
import { PicamoTrackingService } from './picamo-tracking.service';
describe('Picamo session identity', () => {
  let service: PicamoTrackingService;
  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: AuthService, useValue: { uid: signal('member') } },
      ],
    });
    service = TestBed.inject(PicamoTrackingService);
  });
  it('keeps a session across panel reopens with distinct IDs per user submit', () => {
    const first = service.next('assistant')!,
      second = service.next('assistant')!;
    expect(second.sessionId).toBe(first.sessionId);
    expect(second.requestId).not.toBe(first.requestId);
  });
  it('binds a first city question to its returned thread and respects explicit new chats', () => {
    const first = service.city('miami')!;
    service.bindCity('miami', 'thread-1', first);
    expect(service.city('miami', 'thread-1')!.sessionId).toBe(first.sessionId);
    expect(service.city('miami', 'thread-1', true)!.sessionId).not.toBe(first.sessionId);
    expect(service.city('boston')!.sessionId).not.toBe(first.sessionId);
  });
  it('rotates after 30 minutes of inactivity and when explicitly requested', () => {
    const clock = spyOn(Date, 'now').and.returnValue(10000000);
    const first = service.next('assistant')!;
    clock.and.returnValue(10000000 + 31 * 60000);
    const next = service.next('assistant')!;
    expect(next.sessionId).not.toBe(first.sessionId);
    expect(service.next('assistant', true)!.sessionId).not.toBe(next.sessionId);
  });
  it('does not require browser APIs during SSR', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: PLATFORM_ID, useValue: 'server' },
        { provide: AuthService, useValue: { uid: signal('') } },
      ],
    });
    expect(TestBed.inject(PicamoTrackingService).next('assistant')).toBeUndefined();
  });
});
