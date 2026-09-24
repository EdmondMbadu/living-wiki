import { offGridCopy } from './off-grid-copy';
import { isPlatformBrowser } from '@angular/common';
import { Component, afterNextRender, Injector, effect, DestroyRef, PLATFORM_ID, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, Scroll } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { WorkspaceSidebarComponent } from '../workspace-sidebar/workspace-sidebar';
import { MobileMenuComponent } from '../mobile-menu/mobile-menu';
import { AccountMenuComponent } from '../account-menu/account-menu';
import { ThemeToggleComponent } from '../theme-toggle/theme-toggle';
import { OffGridBrowseState, OffGridService } from './off-grid.service';
import { OffGridScope, OffGridSpot, SpotPage } from './off-grid.models';
import { OffGridMapComponent } from './off-grid-map';
@Component({
  selector: 'app-off-grids',
  imports: [FormsModule, RouterLink, WorkspaceSidebarComponent, MobileMenuComponent, AccountMenuComponent, ThemeToggleComponent, OffGridMapComponent],
  templateUrl: './off-grids.html',
  styleUrl: './off-grids.css',
})
export class OffGridsComponent {
  readonly copy = offGridCopy;
  readonly service = inject(OffGridService);
  private router = inject(Router);
  private destroy = inject(DestroyRef);
  private injector = inject(Injector);
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  readonly items = signal<OffGridSpot[]>([]);
  readonly scope = signal<OffGridScope>('explore');
  readonly mode = signal<'grid' | 'map'>('grid');
  readonly loading = signal(true);
  readonly error = signal('');
  readonly message = signal('');
  readonly saved = signal(new Set<string>());
  readonly busy = signal(false);
  readonly mapItems = signal<OffGridSpot[] | null>(null);
  readonly mapBusy = signal(false);
  readonly mapTruncated = signal(false);
  readonly more = signal(false);
  private cursor: SpotPage['cursor'] = null;
  search = '';
  private requestVersion = 0;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  bounds: { north: number; south: number; east: number; west: number } | null = null;
  private disposed = false;
  private authReady = false;
  constructor() {
    if (!this.isBrowser) { this.loading.set(false); return; }
    const browse = this.service.restoreBrowse();
    if (browse) {
      // Angular's global scroll-to-top runs after navigation. Restore our browse
      // position after that event as well as after any stale-page refresh.
      this.router.events.pipe(takeUntilDestroyed(this.destroy)).subscribe(event => {
        if (event instanceof Scroll && !event.anchor && this.items().length && !this.loading()) this.restorePosition(browse);
      });
    }
    if (browse) {
      this.scope.set(browse.scope);
      this.mode.set(browse.mode);
      this.search = browse.search;
      this.items.set(browse.items);
      this.cursor = browse.cursor;
      this.more.set(browse.more);
      this.mapItems.set(browse.mapItems);
      this.mapTruncated.set(browse.mapTruncated);
      this.bounds = browse.bounds;
      if (browse.items.length) {
        this.loading.set(false);
        this.restorePosition(browse);
      }
    }
    if (!this.items().length) {
      if (browse) void this.refreshBrowse(browse);
      else void this.load();
    }
    let previousUid = this.service.auth.uid();
    effect(() => {
      const uid = this.service.auth.uid();
      if (uid !== previousUid) {
        if (previousUid) {
          this.requestVersion++;
          this.service.invalidate();
          this.saved.set(new Set());
          this.scope.set('explore');
          this.items.set([]);
          this.mapItems.set(null);
          void this.load();
        }
        if (this.authReady) void this.loadSaved();
      }
      previousUid = uid;
    });
    void this.service.auth.waitForReady().then(() => {
      this.authReady = true;
      if (!this.disposed) void this.loadSaved();
    });
    this.destroy.onDestroy(() => {
      this.disposed = true;
      this.requestVersion++;
      if (this.searchTimer) clearTimeout(this.searchTimer);
    });
  }
  private restorePosition(browse: OffGridBrowseState): void {
    afterNextRender(() => {
      if (this.disposed) return;
      const card = Array.from(document.querySelectorAll<HTMLElement>('[data-spot-id]')).find(el => el.dataset['spotId'] === browse.selectedId);
      card?.focus({ preventScroll: true });
      window.scrollTo({ top: browse.scrollY, behavior: 'instant' });
    }, { injector: this.injector });
  }
  private async refreshBrowse(browse: OffGridBrowseState): Promise<void> {
    await this.load();
    let version = this.requestVersion;
    while (!this.disposed && !this.error() && version === this.requestVersion && this.more() && this.items().length < (browse.restoreCount || 0)) {
      await this.load(true);
      version++;
    }
    if (this.disposed || version !== this.requestVersion || browse.uid !== this.service.auth.uid()) return;
    if (browse.mode === 'map' && browse.bounds) await this.searchMap();
    if (!this.disposed && version === this.requestVersion) this.restorePosition(browse);
  }
  private async loadSaved(): Promise<void> {
    const uid = this.service.auth.uid();
    try {
      const ids = await this.service.savedIds();
      if (!this.disposed && uid === this.service.auth.uid()) this.saved.set(ids);
    } catch { /* Browse remains usable when optional Saved state is unavailable. */ }
  }
  async load(append = false): Promise<void> {
    const version = ++this.requestVersion;
    const scope = this.scope();
    const uid = this.service.auth.uid();
    this.loading.set(true);
    this.error.set('');
    try {
      const page = await this.service.list(scope, append ? this.cursor : null, this.search);
      if (this.disposed || version !== this.requestVersion || (scope !== 'explore' && uid !== this.service.auth.uid())) return;
      this.items.set(append ? [...this.items(), ...page.items.filter(s => !this.items().some(old => old.id === s.id))] : page.items);
      this.cursor = page.cursor;
      this.more.set(!!page.cursor);
    } catch (error) {
      if (!this.disposed && version === this.requestVersion) this.error.set(error instanceof Error ? error.message : $localize`Could not load gems.`);
    } finally {
      if (!this.disposed && version === this.requestVersion) this.loading.set(false);
    }
  }
  setScope(scope: OffGridScope): void {
    if (scope !== 'explore' && !this.service.auth.isAuthenticated()) {
      void this.router.navigate(['/sign-in'], { queryParams: { redirectTo: '/off-grids' } });
      return;
    }
    this.scope.set(scope);
    this.items.set([]);
    this.cursor = null;
    this.more.set(false);
    this.mapItems.set(null);
    void this.load();
  }
  searchChanged(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.requestVersion++;
    this.items.set([]);
    this.mapItems.set(null);
    this.cursor = null;
    this.more.set(false);
    this.loading.set(true);
    this.searchTimer = setTimeout(() => { this.searchTimer = null; void this.load(); }, 300);
  }
  rememberSelection(spot: OffGridSpot, event?: MouseEvent): void {
    // Preserve standard link behavior for a new tab, while remembering ordinary navigation.
    if (event && (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)) return;
    this.service.rememberSelection(spot);
    this.service.rememberBrowse({
      uid: this.service.auth.uid(), scope: this.scope(), mode: this.mode(), search: this.search,
      items: this.items(), cursor: this.cursor, more: this.more(), mapItems: this.mapItems(),
      mapTruncated: this.mapTruncated(), bounds: this.bounds, scrollY: window.scrollY, selectedId: spot.id,
    });
  }
  open(spot: OffGridSpot): void {
    this.rememberSelection(spot);
    void this.router.navigate(['/off-grids', spot.id]);
  }
  async toggleSave(spot: OffGridSpot): Promise<void> {
    if (this.busy()) return;
    if (!this.service.auth.uid()) {
      void this.router.navigate(['/sign-in'], { queryParams: { redirectTo: `/off-grids/${spot.id}` } });
      return;
    }
    this.busy.set(true);
    try {
      const value = !this.saved().has(spot.id);
      await this.service.savePin(spot.id, value);
      if (this.disposed) return;
      this.saved.update(set => { const next = new Set(set); value ? next.add(spot.id) : next.delete(spot.id); return next; });
      if (this.scope() === 'saved') void this.load();
    } catch { this.message.set($localize`Could not save this gem. Please retry.`); }
    finally { this.busy.set(false); }
  }
  mapBounds(bounds: { north: number; south: number; east: number; west: number }): void { this.bounds = bounds; }
  async searchMap(): Promise<void> {
    if (!this.bounds || this.mapBusy()) return;
    const version = this.requestVersion;
    this.mapBusy.set(true);
    try {
      const page = await this.service.command<SpotPage>('map', 'directory', { bounds: this.bounds });
      if (this.disposed || version !== this.requestVersion) return;
      this.mapItems.set(page.items);
      this.mapTruncated.set(!!page.truncated);
    } catch { this.message.set($localize`Could not load this map area. Try again.`); }
    finally { this.mapBusy.set(false); }
  }
}
