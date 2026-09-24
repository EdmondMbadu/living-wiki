import { isLinkReadableVisibility } from '../board-visibility';
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
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Title, Meta } from '@angular/platform-browser';
import { WorkspaceSidebarComponent } from '../workspace-sidebar/workspace-sidebar';
import { MobileMenuComponent } from '../mobile-menu/mobile-menu';
import { AccountMenuComponent } from '../account-menu/account-menu';
import { ThemeToggleComponent } from '../theme-toggle/theme-toggle';
import { OffGridService } from './off-grid.service';
import { OffGridSpot, directionsUrl } from './off-grid.models';
import { OffGridMapComponent } from './off-grid-map';
import { PinTalkRecorderComponent } from './pin-talk-recorder';
@Component({
  selector: 'app-off-grid-detail',
  imports: [
    RouterLink,
    WorkspaceSidebarComponent,
    MobileMenuComponent,
    AccountMenuComponent,
    ThemeToggleComponent,
    OffGridMapComponent,
    PinTalkRecorderComponent,
  ],
  templateUrl: './off-grid-detail.html',
  styleUrls: ['./off-grids.css', './off-grid-detail.css'],
})
export class OffGridDetailComponent {
  readonly templateText = {
    message1: $localize`s`,
  };
  readonly copy = offGridCopy;
  readonly service = inject(OffGridService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroy = inject(DestroyRef);
  private injector = inject(Injector);
  private title = inject(Title);
  private meta = inject(Meta);
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  readonly selected = signal<OffGridSpot | null>(null);
  readonly validated = signal(false);
  readonly detailLoading = signal(true);
  readonly detailError = signal('');
  readonly message = signal('');
  readonly saved = signal(new Set<string>());
  readonly composer = signal(false);
  readonly sheet = signal<'share' | 'directions' | null>(null);
  readonly qr = signal('');
  readonly busy = signal(false);
  readonly heroUrl = signal('');
  private detailVersion = 0;
  private readonly activeId = signal('');
  private requestUid = '';
  private authReady = false;
  private disposed = false;
  private focusPending = true;
  readonly previewCover = signal('');
  readonly heroReady = signal(false);
  private actionVersion = 0;
  private previousFocus: HTMLElement | null = null;
  openSheet(value: 'share' | 'directions'): void {
    if (!this.validated() || !this.selected()) return;
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
    return this.activeId();
  }
  private renewed = false;
  renewPlayback(): void {
    if (!this.renewed && this.service.auth.uid() && this.selected()) {
      this.renewed = true;
      void this.loadDetail(this.selected()!.id);
    }
  }
  readonly owner = computed(
    () => this.validated() && !!this.service.auth.uid() && this.selected()?.ownerUid === this.service.auth.uid(),
  );
  readonly sortedClips = computed(() =>
    [...(this.selected()?.clips || [])].sort((a, b) => Number(b.featured) - Number(a.featured)),
  );
  constructor() {
    if (!this.isBrowser) return;
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroy)).subscribe((params) => {
      const id = params.get('spotId') || '';
      this.activeId.set(id);
      this.detailVersion++;
      this.selected.set(null);
      this.validated.set(false);
      this.heroUrl.set('');
      this.previewCover.set('');
      this.heroReady.set(false);
      this.actionVersion++;
      this.busy.set(false);
      this.sheet.set(null);
      this.composer.set(false);
      this.qr.set('');
      this.message.set('');
      this.renewed = false;
      this.focusPending = true;
      this.title.setTitle($localize`Off Grids | LivingWiki`);
      this.meta.removeTag('property="og:image"');
      this.meta.removeTag('name="description"');
      const preview = this.service.preview(id);
      if (preview) {
        this.selected.set(preview);
        this.previewCover.set(preview.coverUrl || '');
        this.heroUrl.set(this.previewCover());
      }
      window.scrollTo({ top: 0, behavior: 'instant' });
      void this.loadDetail(id);
    });
    effect(() => {
      const uid = this.service.auth.uid();
      if (uid !== this.requestUid && this.activeId()) {
        if (this.requestUid) this.service.invalidate();
        this.saved.set(new Set());
        this.selected.set(null);
        this.validated.set(false);
        this.heroUrl.set('');
        this.previewCover.set('');
        this.heroReady.set(false);
        this.actionVersion++;
        this.busy.set(false);
        this.meta.removeTag('property="og:image"');
        this.meta.removeTag('name="description"');
        this.sheet.set(null);
        this.composer.set(false);
        this.focusPending = true;
        void this.loadDetail(this.activeId());
        if (this.authReady) void this.loadSaved();
      }
    });
    void this.service.auth.waitForReady().then(() => {
      if (this.disposed) return;
      this.authReady = true;
      // Retry a guest failure once the session is known. Successful details with
      // the same auth context need no second request or fresh media grant.
      if (this.activeId() && this.detailError() && this.requestUid !== this.service.auth.uid()) {
        void this.loadDetail(this.activeId());
      }
      void this.loadSaved();
    });
    this.destroy.onDestroy(() => {
      this.meta.removeTag('name="robots"');
      this.disposed = true;
      this.detailVersion++;
    });
  }
  private async loadSaved(): Promise<void> {
    const uid = this.service.auth.uid();
    try {
      const ids = await this.service.savedIds();
      if (!this.disposed && uid === this.service.auth.uid()) this.saved.set(ids);
    } catch { /* Saving is optional; the public page remains usable. */ }
  }
  private setHero(url: string): void {
    if (url !== this.heroUrl()) this.heroReady.set(false);
    this.heroUrl.set(url);
  }
  heroLoaded(event: Event): void {
    if ((event.target as HTMLImageElement).getAttribute('src') === this.heroUrl()) this.heroReady.set(true);
  }
  coverFailed(): void {
    this.heroReady.set(false);
    if (this.previewCover() && this.heroUrl() !== this.previewCover()) this.heroUrl.set(this.previewCover());
    else this.heroUrl.set('');
  }
  async loadDetail(id: string): Promise<void> {
    if (!id || this.disposed || id !== this.activeId()) return;
    const version = ++this.detailVersion;
    const uid = this.service.auth.uid();
    this.requestUid = uid;
    this.detailLoading.set(true);
    this.detailError.set('');
    try {
      const spot = await this.service.detail(id);
      if (this.disposed || version !== this.detailVersion || uid !== this.service.auth.uid()) return;
      this.selected.set(spot);
      this.validated.set(true);
      this.setHero(spot.coverUrl || '');
      this.title.setTitle(`${spot.title} · Off Grids | LivingWiki`);
      this.meta.updateTag({ name: 'description', content: spot.tip });
      this.meta.updateTag({ name: 'robots', content: spot.visibility === 'public' ? 'index,follow' : 'noindex,nofollow' });
      if (isLinkReadableVisibility(spot.visibility)) this.meta.updateTag({ property: 'og:image', content: spot.coverUrl || '' });
      else this.meta.removeTag('property="og:image"');
    } catch (error) {
      if (!uid && !this.authReady) await this.service.auth.waitForReady();
      if (this.disposed || version !== this.detailVersion || uid !== this.service.auth.uid()) return;
      this.selected.set(null);
      this.validated.set(false);
      this.heroUrl.set('');
      this.meta.removeTag('property="og:image"');
      this.meta.removeTag('name="description"');
      this.detailError.set($localize`This gem is private or unavailable. Sign in if it belongs to you.`);
    } finally {
      if (!this.disposed && version === this.detailVersion) {
        this.detailLoading.set(false);
        if (this.focusPending) {
          this.focusPending = false;
          afterNextRender(() => document.querySelector<HTMLElement>('.gem-stage .detail-title')?.focus({ preventScroll: true }), { injector: this.injector });
        }
      }
    }
  }
  async toggleSave(spot: OffGridSpot): Promise<void> {
    if (this.busy() || !this.validated()) return;
    if (!this.service.auth.uid()) {
      void this.router.navigate(['/sign-in'], {
        queryParams: { redirectTo: `/off-grids/${spot.id}` },
      });
      return;
    }
    this.busy.set(true);
    const actionVersion = ++this.actionVersion;
    const uid = this.service.auth.uid();
    try {
      const value = !this.saved().has(spot.id);
      await this.service.savePin(spot.id, value);
      if (this.disposed || actionVersion !== this.actionVersion || uid !== this.service.auth.uid()) return;
      this.saved.update((set) => {
        const next = new Set(set);
        value ? next.add(spot.id) : next.delete(spot.id);
        return next;
      });
    } catch {
      if (actionVersion === this.actionVersion) this.message.set($localize`Could not save this gem. Please retry.`);
    } finally {
      if (actionVersion === this.actionVersion) this.busy.set(false);
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
  readonly isLinkReadableVisibility = isLinkReadableVisibility;
  async share(): Promise<void> {
    const spot = this.selected();
    if (!spot || !isLinkReadableVisibility(spot.visibility)) return;
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
    const spot = this.selected();
    if (!spot || !this.owner() || this.busy()) return;
    const id = spot.id;
    this.busy.set(true);
    const actionVersion = ++this.actionVersion;
    try {
      await this.service.command(action, id, { clipId });
      this.service.invalidate();
      if (this.disposed || actionVersion !== this.actionVersion || id !== this.activeId()) return;
      await this.loadDetail(id);
    } catch {
      if (actionVersion === this.actionVersion) this.message.set($localize`Could not update this PinTalk. Please retry.`);
    } finally {
      if (actionVersion === this.actionVersion) this.busy.set(false);
    }
  }
  async pinTalkAdded(id: string): Promise<void> {
    this.service.invalidate();
    if (this.disposed || id !== this.activeId()) return;
    this.composer.set(false);
    this.message.set(
      this.owner() ? $localize`PinTalk added.` : $localize`Your PinTalk was sent to the owner for approval.`,
    );
    await this.loadDetail(id);
  }
  async unpublish(): Promise<void> {
    const spot = this.selected();
    if (!spot || !this.owner() || this.busy()) return;
    this.busy.set(true);
    const actionVersion = ++this.actionVersion;
    try {
      await this.service.command('save', spot.id, {
        ...spot,
        visibility: 'private',
        status: 'active',
      });
      this.service.invalidate();
      if (this.disposed || actionVersion !== this.actionVersion || spot.id !== this.activeId()) return;
      await this.loadDetail(spot.id);
      if (actionVersion !== this.actionVersion) return;
      this.sheet.set(null);
      this.message.set($localize`This gem is now private.`);
    } catch (error) {
      if (actionVersion === this.actionVersion) this.message.set(error instanceof Error ? error.message : $localize`Could not make this gem private.`);
    } finally {
      if (actionVersion === this.actionVersion) this.busy.set(false);
    }
  }
}
