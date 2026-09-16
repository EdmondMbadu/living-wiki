import { offGridCopy } from './off-grid-copy';
import { isPlatformBrowser } from '@angular/common';
import {
  Component,
  afterNextRender,
  Injector,
  HostListener,
  effect,
  DestroyRef,
  PLATFORM_ID,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Title, Meta } from '@angular/platform-browser';
import { WorkspaceSidebarComponent } from '../workspace-sidebar/workspace-sidebar';
import { MobileMenuComponent } from '../mobile-menu/mobile-menu';
import { AccountMenuComponent } from '../account-menu/account-menu';
import { ThemeToggleComponent } from '../theme-toggle/theme-toggle';
import { OffGridService } from './off-grid.service';
import { OffGridScope, OffGridSpot, SpotPage, directionsUrl } from './off-grid.models';
import { OffGridMapComponent } from './off-grid-map';
import { PinTalkRecorderComponent } from './pin-talk-recorder';
@Component({
  selector: 'app-off-grids',
  imports: [
    FormsModule,
    RouterLink,
    WorkspaceSidebarComponent,
    MobileMenuComponent,
    AccountMenuComponent,
    ThemeToggleComponent,
    OffGridMapComponent,
    PinTalkRecorderComponent,
  ],
  templateUrl: './off-grids.html',
  styleUrl: './off-grids.css',
})
export class OffGridsComponent {
  readonly copy = offGridCopy;
  readonly service = inject(OffGridService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroy = inject(DestroyRef);
  private injector = inject(Injector);
  private title = inject(Title);
  private meta = inject(Meta);
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  readonly items = signal<OffGridSpot[]>([]);
  readonly scope = signal<OffGridScope>('explore');
  readonly mode = signal<'grid' | 'map'>('grid');
  readonly selected = signal<OffGridSpot | null>(null);
  readonly loading = signal(true);
  readonly detailLoading = signal(false);
  readonly error = signal('');
  readonly detailError = signal('');
  readonly message = signal('');
  readonly saved = signal(new Set<string>());
  readonly composer = signal(false);
  readonly sheet = signal<'share' | 'directions' | null>(null);
  readonly qr = signal('');
  readonly busy = signal(false);
  readonly mapItems = signal<OffGridSpot[] | null>(null);
  readonly mapBusy = signal(false);
  readonly mapTruncated = signal(false);
  private cursor: SpotPage['cursor'] = null;
  readonly more = signal(false);
  search = '';
  private requestVersion = 0;
  private detailVersion = 0;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private bounds: { north: number; south: number; east: number; west: number } | null = null;
  private previousFocus: HTMLElement | null = null;
  openSheet(value: 'share' | 'directions'): void {
    this.previousFocus = document.activeElement as HTMLElement;
    this.sheet.set(value);
    afterNextRender(() => document.querySelector<HTMLElement>('.action-sheet button')?.focus(), { injector: this.injector });
  }
  closeSheet(): void {
    this.sheet.set(null);
    this.previousFocus?.focus();
  }
  @HostListener('document:keydown', ['$event']) onKey(event: KeyboardEvent): void {
    if (!this.sheet()) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeSheet();
      return;
    }
    if (event.key !== 'Tab') return;
    const nodes = Array.from(
      document.querySelectorAll<HTMLElement>(
        '.action-sheet button:not(:disabled),.action-sheet a[href],.action-sheet input',
      ),
    );
    if (!nodes.length) return;
    const first = nodes[0],
      last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
  readonly toggle = (v: boolean) => !v;
  get routeSpotId(): string {
    return this.route.snapshot.paramMap.get('spotId') || '';
  }
  private renewed = false;
  renewPlayback(): void {
    if (!this.renewed && this.selected()?.visibility === 'private') {
      this.renewed = true;
      void this.loadDetail(this.selected()!.id);
    }
  }
  readonly owner = computed(
    () => !!this.selected() && this.selected()!.ownerUid === this.service.auth.uid(),
  );
  readonly sortedClips = computed(() =>
    [...(this.selected()?.clips || [])].sort((a, b) => Number(b.featured) - Number(a.featured)),
  );
  constructor() {
    if (!this.isBrowser) {
      this.loading.set(false);
      return;
    }
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroy)).subscribe((params) => {
      const id = params.get('spotId');
      this.sheet.set(null);
      this.composer.set(false);
      if (id) void this.loadDetail(id);
      else {
        this.detailVersion++;
        this.selected.set(null);
        this.detailError.set('');
        this.detailLoading.set(false);
        this.title.setTitle($localize`Off Grids | LivingWiki`);
        this.meta.removeTag('property="og:image"');
      }
    });
    let previousUid = this.service.auth.uid();
    effect(() => {
      const uid = this.service.auth.uid();
      if (previousUid && uid !== previousUid) {
        this.service.invalidate();
        this.saved.set(new Set());
        if (this.selected()?.visibility === 'private') this.close();
        if (this.scope() !== 'explore') {
          this.scope.set('explore');
          this.items.set([]);
          void this.load();
        }
      }
      previousUid = uid;
    });
    void this.load();
    void this.service.auth.waitForReady().then(() => {
      void this.service
        .savedIds()
        .then((ids) => this.saved.set(ids))
        .catch(() => undefined);
      if (this.selected()) void this.loadDetail(this.selected()!.id);
    });
    this.destroy.onDestroy(() => {
      if (this.searchTimer) clearTimeout(this.searchTimer);
    });
  }
  async load(append = false): Promise<void> {
    const version = ++this.requestVersion;
    this.loading.set(true);
    this.error.set('');
    try {
      const page = await this.service.list(this.scope(), append ? this.cursor : null, this.search);
      if (version !== this.requestVersion) return;
      this.items.set(
        append
          ? [
              ...this.items(),
              ...page.items.filter((s) => !this.items().some((old) => old.id === s.id)),
            ]
          : page.items,
      );
      this.cursor = page.cursor;
      this.more.set(!!page.cursor);
    } catch (error) {
      if (version === this.requestVersion)
        this.error.set(error instanceof Error ? error.message : 'Could not load gems.');
    } finally {
      if (version === this.requestVersion) this.loading.set(false);
    }
  }
  setScope(scope: OffGridScope): void {
    if (scope !== 'explore' && !this.service.auth.isAuthenticated()) {
      void this.router.navigate(['/sign-in'], { queryParams: { redirectTo: '/off-grids' } });
      return;
    }
    this.scope.set(scope);
    this.mapItems.set(null);
    void this.load();
  }
  searchChanged(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => void this.load(), 300);
  }
  open(spot: OffGridSpot): void {
    void this.router.navigate(['/off-grids', spot.id]);
  }
  close(): void {
    void this.router.navigate(['/off-grids']);
  }
  async loadDetail(id: string): Promise<void> {
    const version = ++this.detailVersion;
    this.detailLoading.set(true);
    this.detailError.set('');
    try {
      const spot = await this.service.detail(id);
      if (version !== this.detailVersion) return;
      this.selected.set(spot);
      this.title.setTitle(`${spot.title} · Off Grids | LivingWiki`);
      this.meta.updateTag({ name: 'description', content: spot.tip });
      if (spot.visibility === 'public')
        this.meta.updateTag({ property: 'og:image', content: spot.coverUrl || '' });
      else this.meta.removeTag('property="og:image"');
    } catch (error) {
      if (version !== this.detailVersion) return;
      this.selected.set(null);
      this.detailError.set(
        $localize`This gem is private or unavailable. Sign in if it belongs to you.`,
      );
    } finally {
      if (version === this.detailVersion) this.detailLoading.set(false);
    }
  }
  async toggleSave(spot: OffGridSpot): Promise<void> {
    if (this.busy()) return;
    if (!this.service.auth.uid()) {
      void this.router.navigate(['/sign-in'], {
        queryParams: { redirectTo: `/off-grids/${spot.id}` },
      });
      return;
    }
    this.busy.set(true);
    try {
      const value = !this.saved().has(spot.id);
      await this.service.savePin(spot.id, value);
      this.saved.update((set) => {
        const next = new Set(set);
        value ? next.add(spot.id) : next.delete(spot.id);
        return next;
      });
      if (this.scope() === 'saved') void this.load();
    } catch {
      this.message.set($localize`Could not save this gem. Please retry.`);
    } finally {
      this.busy.set(false);
    }
  }
  directions(spot: OffGridSpot): string {
    return spot.location ? directionsUrl(spot.location) : '';
  }
  async copyToClipboard(value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      this.message.set($localize`Copied to clipboard.`);
    } catch {
      this.message.set($localize`Copy is unavailable. Select and copy the link shown below.`);
    }
  }
  async share(): Promise<void> {
    const spot = this.selected();
    if (!spot || spot.visibility !== 'public') return;
    const data = { title: spot.title, text: spot.tip, url: spot.shareUrl };
    try {
      if (navigator.share) await navigator.share(data);
      else await this.copyToClipboard(spot.shareUrl || location.href);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError'))
        this.message.set($localize`Sharing is unavailable. Use Copy link.`);
    }
  }
  async showQr(): Promise<void> {
    try {
      const { generateQrSvgDataUrl } = await import('../qr-code');
      this.qr.set(generateQrSvgDataUrl(this.selected()?.shareUrl || '', { margin: 4 }));
    } catch {
      this.message.set($localize`Could not generate the QR code.`);
    }
  }
  async clipAction(action: string, clipId: string): Promise<void> {
    if (this.busy()) return;
    const id = this.selected()!.id;
    this.busy.set(true);
    try {
      await this.service.command(action, id, { clipId });
      this.service.invalidate();
      await this.loadDetail(id);
    } catch {
      this.message.set($localize`Could not update this PinTalk. Please retry.`);
    } finally {
      this.busy.set(false);
    }
  }
  async pinTalkAdded(): Promise<void> {
    this.composer.set(false);
    this.message.set(
      this.owner() ? 'PinTalk added.' : 'Your PinTalk was sent to the owner for approval.',
    );
    this.service.invalidate();
    await this.loadDetail(this.selected()!.id);
  }
  mapBounds(bounds: { north: number; south: number; east: number; west: number }): void {
    this.bounds = bounds;
  }
  async searchMap(): Promise<void> {
    if (!this.bounds || this.mapBusy()) return;
    this.mapBusy.set(true);
    try {
      const page = await this.service.command<SpotPage>('map', 'directory', {
        bounds: this.bounds,
      });
      this.mapItems.set(page.items);
      this.mapTruncated.set(!!page.truncated);
    } catch {
      this.message.set($localize`Could not load this map area. Try again.`);
    } finally {
      this.mapBusy.set(false);
    }
  }
  async unpublish(): Promise<void> {
    const spot = this.selected();
    if (!spot || this.busy()) return;
    this.busy.set(true);
    try {
      await this.service.command('save', spot.id, {
        ...spot,
        visibility: 'private',
        status: 'active',
      });
      this.service.invalidate();
      await this.loadDetail(spot.id);
      void this.load();
      this.sheet.set(null);
      this.message.set($localize`This gem is now private.`);
    } catch (error) {
      this.message.set(error instanceof Error ? error.message : 'Could not make this gem private.');
    } finally {
      this.busy.set(false);
    }
  }
}
