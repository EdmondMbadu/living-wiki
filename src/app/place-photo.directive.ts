import { isPlatformBrowser } from '@angular/common';
import { Directive, ElementRef, HostListener, inject, Input, OnChanges, OnDestroy, PLATFORM_ID, SecurityContext } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { placePhotoUrl } from './place-photo';

export const PLACE_PHOTO_FALLBACK = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="650" viewBox="0 0 1000 650">'
  + '<rect width="1000" height="650" fill="#e5eeec"/><path d="M440 340l45-55 35 38 25-27 45 54z" fill="#708a84"/>'
  + '<circle cx="548" cy="265" r="15" fill="#708a84"/><text x="500" y="400" text-anchor="middle" font-family="sans-serif" font-size="24" fill="#435d57">Photo unavailable</text></svg>',
);

/** Intercepts only our Places proxy. Uploads and other remote images retain native loading. */
@Directive({ selector: 'img[src]', standalone: true })
export class PlacePhotoDirective implements OnChanges, OnDestroy {
  @Input() src: string | null | undefined = '';
  private readonly img = inject<ElementRef<HTMLImageElement>>(ElementRef).nativeElement;
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly sanitizer = inject(DomSanitizer);
  private request?: AbortController;
  private observer?: IntersectionObserver;
  private objectUrl = '';
  private credit?: HTMLElement;
  private revision = 0;

  ngOnChanges(): void {
    this.cleanup();
    const source = this.src || '';
    const revision = ++this.revision;
    if (!this.browser || !placePhotoUrl(source)) {
      if (source) this.img.src = this.sanitizer.sanitize(SecurityContext.URL, source) || '';
      else this.img.removeAttribute('src');
      return;
    }
    this.img.removeAttribute('src');
    this.img.removeAttribute('srcset');
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      this.observer?.disconnect();
      void this.load(source, revision);
    };
    if (this.img.loading === 'lazy' && typeof IntersectionObserver !== 'undefined') {
      this.observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) start();
      }, { rootMargin: '300px' });
      this.observer.observe(this.img);
    } else start();
  }

  private async load(source: string, revision: number): Promise<void> {
    const controller = new AbortController();
    this.request = controller;
    const timeout = setTimeout(() => controller.abort(), 28_000);
    try {
      const response = await fetch(source, { signal: controller.signal, cache: 'no-store' });
      if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) throw new Error('Photo unavailable');
      const blob = await response.blob();
      if (revision !== this.revision) return;
      this.objectUrl = URL.createObjectURL(blob);
      this.img.src = this.objectUrl;
      let credits: string[] = [];
      try {
        const parsed: unknown = JSON.parse(decodeURIComponent(response.headers.get('X-Place-Attributions') || '[]'));
        if (Array.isArray(parsed)) credits = parsed.filter((value): value is string => typeof value === 'string');
      } catch { /* A malformed optional header must not hide a valid photo. */ }
      this.showCredits(credits);
    } catch {
      if (revision === this.revision) this.img.src = PLACE_PHOTO_FALLBACK;
    } finally { clearTimeout(timeout); }
  }

  private showCredits(credits: string[]): void {
    // Blurred decorative duplicates share the foreground image's credit.
    if (this.img.getAttribute('aria-hidden') === 'true') return;
    const names = credits.map((html) => new DOMParser().parseFromString(html, 'text/html').body.textContent?.trim()).filter(Boolean);
    const parent = this.img.parentElement?.tagName === 'PICTURE' ? this.img.parentElement.parentElement : this.img.parentElement;
    if (!parent) return;
    if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
    const credit = document.createElement('span');
    credit.textContent = ['Google Maps', ...names].join(' · ');
    credit.title = credit.textContent;
    credit.setAttribute('data-place-photo-credit', '');
    Object.assign(credit.style, {
      position: 'absolute', bottom: '0', right: '0', maxWidth: '100%', boxSizing: 'border-box',
      padding: '3px 6px', background: 'rgba(0,0,0,.72)', color: '#fff',
      font: '11px/1.35 Arial, sans-serif', zIndex: '2', pointerEvents: 'none', whiteSpace: 'normal',
    });
    parent.appendChild(credit);
    this.credit = credit;
  }

  private cleanup(): void {
    this.request?.abort();
    this.observer?.disconnect();
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = '';
    this.credit?.remove();
    this.credit = undefined;
  }

  @HostListener('error') onImageError(): void {
    if (placePhotoUrl(this.src) && this.img.src !== PLACE_PHOTO_FALLBACK) {
      this.credit?.remove();
      this.img.src = PLACE_PHOTO_FALLBACK;
    }
  }

  ngOnDestroy(): void { ++this.revision; this.cleanup(); }
}
