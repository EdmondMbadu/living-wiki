import {
  AfterViewInit,
  Component,
  DestroyRef,
  ElementRef,
  ViewChild,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { GoogleMapsService } from '../google-maps.service';
import { OffGridLocation, OffGridSpot } from './off-grid.models';
interface MapRuntime {
  maps: {
    Map: new (
      element: HTMLElement,
      options: Record<string, unknown>,
    ) => {
      setCenter: (p: unknown) => void;
      setZoom: (n: number) => void;
      fitBounds: (b: unknown, padding: number) => void;
      addListener: (
        event: string,
        fn: (event: { latLng?: { lat: () => number; lng: () => number } }) => void,
      ) => { remove: () => void };
      getBounds: () =>
        | {
            getNorthEast: () => { lat: () => number; lng: () => number };
            getSouthWest: () => { lat: () => number; lng: () => number };
          }
        | undefined;
    };
    LatLngBounds: new () => { extend: (p: unknown) => void };
    marker?: {
      AdvancedMarkerElement: new (options: Record<string, unknown>) => {
        map: unknown | null;
        addListener: (event: string, fn: () => void) => { remove: () => void };
      };
    };
  };
}
@Component({
  selector: 'app-off-grid-map',
  template: `<div class="map-wrap">
    <div #canvas class="map-canvas" aria-label="Location map"></div>
    @if (loading()) {
      <p class="map-status" role="status">Loading map…</p>
    }
    @if (error()) {
      <p class="map-status" role="status">
        {{ error() }} <button type="button" (click)="retry()">Retry</button>
      </p>
    }
    @if (picking()) {
      <span class="map-hint">Tap the map to place your pin</span>
    }
  </div>`,
  styles: [
    `
      :host {
        display: block;
      }
      .map-wrap {
        position: relative;
        border-radius: 14px;
        overflow: hidden;
        background: var(--surface-strong);
        border: 1px solid var(--line);
      }
      .map-canvas {
        min-height: 300px;
        height: 100%;
      }
      .map-status {
        position: absolute;
        inset: 45% 16px auto;
        background: var(--surface);
        padding: 12px;
        border-radius: 12px;
        font-size: 14px;
      }
      .map-hint {
        position: absolute;
        bottom: 16px;
        left: 16px;
        right: 16px;
        pointer-events: none;
        background: var(--surface);
        border-radius: 20px;
        padding: 9px 15px;
        text-align: center;
        font-size: 13px;
      }
      .map-status button {
        padding: 8px;
        border: 0;
        border-radius: 8px;
      }
    `,
  ],
})
export class OffGridMapComponent implements AfterViewInit {
  private maps = inject(GoogleMapsService);
  private destroy = inject(DestroyRef);
  private runtime: MapRuntime | null = null;
  private map: InstanceType<MapRuntime['maps']['Map']> | null = null;
  private markers: Array<{ map: unknown | null }> = [];
  private listeners: Array<{ remove: () => void }> = [];
  private fitted = false;
  private ready = false;
  private disposed = false;
  readonly spots = input<OffGridSpot[]>([]);
  readonly point = input<OffGridLocation | null>(null);
  readonly initialBounds = input<{ north: number; south: number; east: number; west: number } | null>(null);
  readonly picking = input(false);
  readonly selected = output<OffGridSpot>();
  readonly pointChanged = output<OffGridLocation>();
  readonly boundsChanged = output<{ north: number; south: number; east: number; west: number }>();
  readonly loading = signal(true);
  readonly error = signal('');
  @ViewChild('canvas') canvas?: ElementRef<HTMLElement>;
  constructor() {
    effect(() => {
      this.spots();
      this.point();
      if (this.ready) this.render();
    });
    this.destroy.onDestroy(() => {
      this.disposed = true;
      this.listeners.forEach((l) => l.remove());
      this.markers.forEach((m) => (m.map = null));
    });
  }
  ngAfterViewInit(): void {
    this.ready = true;
    void this.initialize();
  }
  retry(): void {
    void this.initialize();
  }
  private async initialize(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      this.runtime = (await this.maps.loadMapLibraries()) as unknown as MapRuntime;
      if (this.disposed || !this.canvas) return;
      this.map = new this.runtime.maps.Map(this.canvas.nativeElement, {
        center: this.point() || this.spots()[0]?.location || { lat: 39.95, lng: -75.16 },
        zoom: this.point() ? 15 : 4,
        mapId: this.maps.mapId(),
        mapTypeControl: false,
        streetViewControl: false,
        clickableIcons: false,
        gestureHandling: 'cooperative',
      });
      this.listeners.push(
        this.map.addListener('click', (event) => {
          if (this.picking() && event.latLng)
            this.pointChanged.emit({
              lat: event.latLng.lat(),
              lng: event.latLng.lng(),
              source: 'map',
              confirmedAt: new Date().toISOString(),
              words: '',
            });
        }),
      );
      this.listeners.push(
        this.map.addListener('idle', () => {
          const b = this.map?.getBounds();
          if (b)
            this.boundsChanged.emit({
              north: b.getNorthEast().lat(),
              east: b.getNorthEast().lng(),
              south: b.getSouthWest().lat(),
              west: b.getSouthWest().lng(),
            });
        }),
      );
      this.render();
    } catch {
      this.error.set(
        'The map is unavailable. You can still enter coordinates and open directions.',
      );
    } finally {
      this.loading.set(false);
    }
  }
  private render(): void {
    if (!this.map || !this.runtime) return;
    this.markers.forEach((m) => (m.map = null));
    this.markers = [];
    const marker = this.runtime.maps.marker?.AdvancedMarkerElement;
    if (!marker) return;
    const points = this.point()
      ? [{ point: this.point()!, spot: null }]
      : this.spots()
          .filter((s) => s.location)
          .map((s) => ({ point: s.location!, spot: s }));
    const bounds = new this.runtime.maps.LatLngBounds();
    for (const item of points) {
      bounds.extend(item.point);
      const pin = document.createElement('button');
      pin.type = 'button';
      pin.textContent = '●';
      pin.style.cssText =
        'background:#dc4a3e;color:white;border:3px solid white;border-radius:50%;height:44px;width:44px;box-shadow:0 2px 9px #0004;cursor:pointer';
      pin.setAttribute('aria-label', item.spot?.title || 'Confirmed location');
      pin.addEventListener('click', () => {
        if (item.spot) this.selected.emit(item.spot);
      });
      this.markers.push(
        new marker({
          map: this.map,
          position: { lat: item.point.lat, lng: item.point.lng },
          content: pin,
          title: item.spot?.title || 'Your gem',
        }),
      );
    }
    if (this.point()) {
      this.map.setCenter(this.point());
      this.map.setZoom(15);
    } else if (!this.fitted && (this.initialBounds() || points.length)) {
      this.map.fitBounds(this.initialBounds() || bounds, 45);
      this.fitted = true;
    }
  }
}
