import { NO_ERRORS_SCHEMA, provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { provideRouter, RouterLink } from '@angular/router';
import { OffGridsComponent } from './off-grids';
import { OffGridService } from './off-grid.service';
const item = (id: string) => ({ id, title: id, tip: '', creatorName: 'Owner', visibility: 'public', status: 'active', location: null, cover: false });

async function settle(fixture: ComponentFixture<unknown>) {
  // Flush native promise continuations as well as Angular's zoneless rendering.
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  fixture.detectChanges();
  await fixture.whenStable();
}

describe('Off Grid browse return', () => {
  const browse = {
    uid: '', scope: 'explore', mode: 'grid', search: 'park', items: [item('second')],
    cursor: { id: 'second', createdAt: 'now' }, more: true, mapItems: null,
    mapTruncated: false, bounds: null, scrollY: 240, selectedId: 'second',
  };
  let service: any;
  beforeEach(() => {
    service = {
      auth: { uid: () => '', isAuthenticated: () => false, waitForReady: async () => undefined },
      restoreBrowse: () => browse, savedIds: async () => new Set(),
      list: jasmine.createSpy('list').and.resolveTo({ items: [], cursor: null }),
      rememberSelection: jasmine.createSpy('rememberSelection'), rememberBrowse: jasmine.createSpy('rememberBrowse'),
    };
    TestBed.configureTestingModule({ imports: [OffGridsComponent], providers: [provideZonelessChangeDetection(), provideRouter([]), { provide: OffGridService, useValue: service }] })
      .overrideComponent(OffGridsComponent, { set: { imports: [FormsModule, RouterLink], schemas: [NO_ERRORS_SCHEMA] } });
    spyOn(window, 'scrollTo');
  });
  it('restores cached search, pages and scroll without a directory request', async () => {
    const fixture = TestBed.createComponent(OffGridsComponent);
    fixture.detectChanges();
    await settle(fixture);
    expect(fixture.componentInstance.search).toBe('park');
    expect(fixture.componentInstance.items().length).toBe(1);
    expect(fixture.componentInstance.more()).toBeTrue();
    expect(service.list).not.toHaveBeenCalled();
    expect(window.scrollTo as jasmine.Spy).toHaveBeenCalledWith({ top: 240, behavior: 'instant' });
    expect(document.activeElement?.getAttribute('data-spot-id')).toBe('second');
    fixture.destroy();
  });
  it('revalidates stale pages up to the previous count and then restores position', async () => {
    service.restoreBrowse = () => ({ ...browse, items: [], cursor: null, restoreCount: 2 });
    service.list.and.returnValues(Promise.resolve({ items: [item('first')], cursor: { id: 'first', createdAt: 'now' } }), Promise.resolve({ items: [item('second')], cursor: null }));
    const fixture = TestBed.createComponent(OffGridsComponent);
    fixture.detectChanges();
    await settle(fixture);
    expect(service.list).toHaveBeenCalledTimes(2);
    expect(fixture.componentInstance.items().map(s => s.id)).toEqual(['first', 'second']);
    expect(window.scrollTo as jasmine.Spy).toHaveBeenCalledWith({ top: 240, behavior: 'instant' });
    fixture.destroy();
  });
});
