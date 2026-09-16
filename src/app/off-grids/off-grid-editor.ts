import { offGridCopy } from './off-grid-copy';
import { isPlatformBrowser } from '@angular/common';
import { Component, DestroyRef, PLATFORM_ID, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { WorkspaceSidebarComponent } from '../workspace-sidebar/workspace-sidebar';
import { MobileMenuComponent } from '../mobile-menu/mobile-menu';
import { ThemeToggleComponent } from '../theme-toggle/theme-toggle';
import { AccountMenuComponent } from '../account-menu/account-menu';
import { OffGridMapComponent } from './off-grid-map';
import { PinTalkRecorderComponent } from './pin-talk-recorder';
import { OffGridLocation, OffGridSpot, parseCoordinates, validPoint } from './off-grid.models';
import { MediaUpload, OffGridService } from './off-grid.service';
import { normalizeWhat3WordsAddress } from '../boards/off-grid-location';
@Component({
  selector: 'app-off-grid-editor',
  imports: [
    FormsModule,
    RouterLink,
    WorkspaceSidebarComponent,
    MobileMenuComponent,
    ThemeToggleComponent,
    AccountMenuComponent,
    OffGridMapComponent,
    PinTalkRecorderComponent,
  ],
  templateUrl: './off-grid-editor.html',
  styleUrl: './off-grids.css',
})
export class OffGridEditorComponent {
  readonly copy = offGridCopy;
  readonly service = inject(OffGridService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private destroy = inject(DestroyRef);
  private browser = isPlatformBrowser(inject(PLATFORM_ID));
  readonly id = signal('');
  readonly step = signal(1);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly locating = signal(false);
  readonly error = signal('');
  readonly message = signal('');
  readonly point = signal<OffGridLocation | null>(null);
  readonly confirmed = signal(false);
  readonly showMap = signal(false);
  readonly photo = signal('');
  readonly photoUploading = signal(false);
  readonly photoProcessing = signal(false);
  readonly photoProgress = signal(0);
  readonly original = signal<OffGridSpot | null>(null);
  readonly composer = signal(false);
  readonly clipCount = signal(0);
  readonly clipBusy = signal(false);
  readonly deleteConfirm = signal(false);
  title = '';
  tip = '';
  accessNote = '';
  area = '';
  latitude: string | number | null = '';
  longitude: string | number | null = '';
  paste = '';
  visibility: 'private' | 'public' = 'private';
  allowContributions = true;
  private coverTicketId = '';
  private upload: MediaUpload | null = null;
  private objectUrl = '';
  private disposed = false;
  constructor() {
    if (this.browser) void this.initialize();
    else this.loading.set(false);
    this.destroy.onDestroy(() => {
      this.disposed = true;
      this.upload?.cancel();
      if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    });
  }
  private storageKey(): string {
    return `lw-off-grid-draft:${this.service.auth.uid()}:${this.id()}`;
  }
  private async initialize(): Promise<void> {
    try {
      await this.service.auth.waitForReady();
      let id = this.route.snapshot.paramMap.get('spotId');
      if (id) {
        const spot = await this.service.detail(id);
        if (spot.ownerUid !== this.service.auth.uid())
          throw new Error('Only the gem owner can edit it.');
        this.original.set(spot);
        this.apply(spot);
      } else {
        const recoveryKey = `lw-off-grid-new:${this.service.auth.uid()}`;
        id = localStorage.getItem(recoveryKey) || crypto.randomUUID();
        await this.service.command('draft', id);
        localStorage.setItem(recoveryKey, id);
        try {
          const spot = await this.service.detail(id);
          this.original.set(spot);
          this.apply(spot);
        } catch {
          localStorage.removeItem(recoveryKey);
          id = crypto.randomUUID();
          await this.service.command('draft', id);
          localStorage.setItem(recoveryKey, id);
        }
      }
      this.id.set(id);
      const raw = localStorage.getItem(this.storageKey());
      if (raw) {
        let draft;
        try { draft = JSON.parse(raw); } catch { localStorage.removeItem(this.storageKey()); return; }
        if (!draft || typeof draft !== 'object') { localStorage.removeItem(this.storageKey()); return; }
        this.title = draft.title || this.title;
        this.tip = draft.tip || '';
        this.accessNote = draft.accessNote || '';
        this.area = draft.area || '';
        this.coverTicketId = draft.coverTicketId || '';
        if (this.coverTicketId) {
          try { const preview = await this.service.command<{coverUrl:string}>('stagedCover', id, { ticketId: this.coverTicketId }); this.photo.set(preview.coverUrl); }
          catch { this.coverTicketId = ''; }
        }
        if (draft.location && validPoint(draft.location.lat, draft.location.lng)) {
          this.point.set(draft.location);
          this.latitude = String(draft.location.lat);
          this.longitude = String(draft.location.lng);
          this.confirmed.set(!!draft.location.confirmedAt);
        }
        this.message.set($localize`Recovered your unfinished gem.`);
      }
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Could not open the editor.');
    } finally {
      this.loading.set(false);
    }
  }
  private apply(spot: OffGridSpot): void {
    this.title = spot.title === 'Untitled gem' ? '' : spot.title;
    this.tip = spot.tip;
    this.accessNote = spot.accessNote || '';
    this.photo.set(spot.coverUrl || '');
    this.clipCount.set(spot.clips?.length || 0);
    this.visibility = spot.visibility;
    this.allowContributions = spot.allowContributions !== false;
    if (spot.location) {
      this.point.set(spot.location);
      this.latitude = String(spot.location.lat);
      this.longitude = String(spot.location.lng);
      this.area = spot.location.area || '';
      this.confirmed.set(!!spot.location.confirmedAt);
    }
  }
  persist(): void {
    if (!this.id()) return;
    localStorage.setItem(
      this.storageKey(),
      JSON.stringify({
        title: this.title,
        tip: this.tip,
        accessNote: this.accessNote,
        area: this.area,
        location: this.point(),
        coverTicketId: this.coverTicketId,
      }),
    );
  }
  setPoint(point: OffGridLocation): void {
    this.point.set({ ...point, confirmedAt: '', words: point.words || '' });
    this.latitude = String(point.lat);
    this.longitude = String(point.lng);
    this.confirmed.set(false);
    this.error.set('');
    this.persist();
  }
  coordinatesChanged(): void {
    const lat =
        this.latitude !== null && String(this.latitude).trim() ? Number(this.latitude) : NaN,
      lng = this.longitude !== null && String(this.longitude).trim() ? Number(this.longitude) : NaN;
    this.confirmed.set(false);
    if (validPoint(lat, lng))
      this.setPoint({ lat, lng, source: 'coordinates', confirmedAt: '', words: '' });
    else {
      this.point.set(null);
      this.persist();
    }
  }
  async useLocation(): Promise<void> {
    this.error.set('');
    if (!navigator.geolocation) {
      this.error.set($localize`Location is unavailable. Drop a pin or enter coordinates.`);
      return;
    }
    this.locating.set(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (this.disposed) return;
        this.setPoint({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          source: 'gps',
          confirmedAt: '',
          accuracy: position.coords.accuracy,
        });
        this.showMap.set(true);
        this.locating.set(false);
      },
      () => {
        this.locating.set(false);
        this.error.set(
          'Could not get your location. Check browser permissions, or enter coordinates.',
        );
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  }
  async resolvePaste(): Promise<void> {
    this.error.set('');
    const parsed = parseCoordinates(this.paste);
    if (parsed) {
      this.setPoint({ ...parsed, source: 'coordinates', confirmedAt: '' });
      this.showMap.set(true);
      return;
    }
    const words = normalizeWhat3WordsAddress(this.paste);
    if (!words) {
      this.error.set(
        'Paste latitude, longitude, a Google Maps coordinate link, or a three-word address. Short Maps links need coordinates copied from Maps.',
      );
      return;
    }
    this.locating.set(true);
    try {
      const resolved = await this.service.command<{
        lat: number;
        lng: number;
        words: string;
        nearestPlace: string;
      }>('resolveLocation', this.id(), { words });
      this.setPoint({ ...resolved, source: 'what3words', confirmedAt: '' });
      this.area = resolved.nearestPlace;
      this.showMap.set(true);
    } catch {
      this.error.set(
        'what3words could not resolve this address. You can still drop a pin or enter coordinates.',
      );
    } finally {
      this.locating.set(false);
    }
  }
  confirmPoint(): void {
    const point = this.point();
    if (!point) {
      this.error.set($localize`Choose a valid map point first.`);
      return;
    }
    this.point.set({ ...point, area: this.area, confirmedAt: new Date().toISOString() });
    this.confirmed.set(true);
    this.error.set('');
    this.persist();
  }
  next(): void {
    if (this.clipBusy()) return;
    this.error.set('');
    if (this.step() === 1 && (!this.point() || !this.confirmed())) {
      this.error.set($localize`Confirm the exact point before continuing.`);
      return;
    }
    if (
      this.step() === 2 &&
      (this.title.trim().length < 2 || (!this.photo() && !this.coverTicketId))
    ) {
      this.error.set($localize`Add a photo and a name for this gem.`);
      return;
    }
    if (this.photoUploading()) {
      this.error.set($localize`Wait for the photo to finish uploading.`);
      return;
    }
    this.persist();
    this.step.update((n) => Math.min(3, n + 1));
  }
  async choosePhoto(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement,
      file = input.files?.[0];
    input.value = '';
    if (!file || this.photoUploading()) return;
    this.error.set('');
    if (
      file.size <= 0 ||
      file.size > 10 * 1024 * 1024 ||
      (!file.type.startsWith('image/') && !/\.(heic|heif)$/i.test(file.name))
    ) {
      this.error.set($localize`Choose a JPG, PNG, WebP or HEIC photo under 10 MB.`);
      return;
    }
    this.photoUploading.set(true);
    this.photoProcessing.set(false);
    try {
      let photoBlob: File | Blob = file;
      if (/\.(heic|heif)$/i.test(file.name) || /^image\/hei[cf]/i.test(file.type)) {
        this.photoProcessing.set(true);
        const { default: convertHeic } = await import('heic2any');
        const converted = await convertHeic({ blob: file, toType: 'image/jpeg', quality: 0.85 });
        photoBlob = Array.isArray(converted) ? converted[0] : converted;
        if (!photoBlob || photoBlob.size > 10 * 1024 * 1024)
          throw new Error($localize`Choose a JPG, PNG, WebP or HEIC photo under 10 MB.`);
      }
      if (this.disposed) return;
      this.upload = this.service.upload(this.id(), photoBlob, 'cover', {}, (p, processing) => {
        this.photoProgress.set(p);
        this.photoProcessing.set(processing);
      });
      const result = await this.upload.promise;
      this.coverTicketId = result.ticketId;
      this.persist();
      if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
      const preview = await this.service.command<{coverUrl:string}>('stagedCover', this.id(), {ticketId: result.ticketId});
      this.photo.set(preview.coverUrl);
      this.persist();
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Could not upload the photo.');
    } finally {
      this.photoUploading.set(false);
      this.photoProcessing.set(false);
      this.upload = null;
    }
  }
  cancelPhoto(): void {
    this.upload?.cancel();
  }
  async saved(draft = false): Promise<void> {
    if (this.saving() || this.photoUploading() || this.clipBusy() || !this.id()) return;
    this.error.set('');
    if (!draft && (!this.confirmed() || this.title.trim().length < 2)) {
      this.error.set($localize`Give this gem a name and confirm the point.`);
      return;
    }
    this.saving.set(true);
    try {
      await this.service.command('save', this.id(), {
        title: this.title.trim() || (draft ? 'Untitled gem' : ''),
        tip: this.tip,
        accessNote: this.accessNote,
        location: this.point() ? { ...this.point()!, area: this.area } : null,
        coverTicketId: this.coverTicketId || null,
        visibility: draft ? 'private' : this.visibility,
        status: draft ? 'draft' : 'active',
        allowContributions: this.allowContributions,
      });
      localStorage.removeItem(this.storageKey());
      localStorage.removeItem(`lw-off-grid-new:${this.service.auth.uid()}`);
      this.service.invalidate();
      await this.router.navigate(['/off-grids', this.id()]);
    } catch (error) {
      this.error.set(
        error instanceof Error ? error.message : 'Could not save the gem. Please retry.',
      );
    } finally {
      this.saving.set(false);
    }
  }
  async pinTalkAdded(): Promise<void> {
    const spot = await this.service.detail(this.id());
    this.clipCount.set(spot.clips?.length || 0);
    this.composer.set(false);
    this.message.set($localize`PinTalk ready. It shares this gem’s visibility.`);
  }
  async deleteGem(): Promise<void> {
    this.saving.set(true);
    try {
      await this.service.command('delete', this.id());
      localStorage.removeItem(this.storageKey());
      localStorage.removeItem(`lw-off-grid-new:${this.service.auth.uid()}`);
      this.service.invalidate();
      await this.router.navigate(['/off-grids']);
    } catch {
      this.error.set($localize`Could not delete this gem. Please retry.`);
    } finally {
      this.saving.set(false);
    }
  }
}
