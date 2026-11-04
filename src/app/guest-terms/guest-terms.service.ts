import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { computed, effect, inject, Injectable, InjectionToken, PLATFORM_ID, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationStart, Router } from '@angular/router';
import { AuthService } from '../auth.service';
import { TERMS_EFFECTIVE_DATE, TERMS_VERSION } from '../legal/terms-policy';

export const GUEST_TERMS_STORAGE_KEY = 'livingwiki.guest-terms-acceptance';
export const GUEST_TERMS_STORAGE = new InjectionToken<Storage | null>('Guest terms storage', {
  providedIn: 'root',
  factory: () => {
    const document = inject(DOCUMENT);
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return null;
    try {
      return document.defaultView?.localStorage ?? null;
    } catch {
      return null;
    }
  },
});

export interface GuestTermsAcceptance {
  version: string;
  effectiveDate: string;
  acceptedAt: string;
}

@Injectable({ providedIn: 'root' })
export class GuestTermsService {
  private readonly auth = inject(AuthService);
  private readonly storage = inject(GUEST_TERMS_STORAGE);
  private readonly acceptance = signal(this.readAcceptance());

  readonly hasAccepted = computed(() => this.acceptance() !== null);
  readonly hasConversationAccess = computed(() => this.auth.initialized()
    && (this.auth.isAuthenticated() || this.hasAccepted()));

  readonly promptOpen = signal(false);
  private pending: Promise<boolean> | null = null;
  private resolvePending: ((allowed: boolean) => void) | null = null;
  private readonly router = inject(Router, { optional: true });

  constructor() {
    effect(() => {
      if (this.promptOpen() && this.hasConversationAccess()) this.finishConversationConsent(true);
    });
    // A cancelled or navigated-away request must never start a stale call.
    this.router?.events.pipe(takeUntilDestroyed()).subscribe(event => {
      if (event instanceof NavigationStart) this.finishConversationConsent(false);
    });
  }

  async requestConversation(): Promise<boolean> {
    const requestedUrl = this.router?.url;
    const allowed = await this.waitForAccess();
    if (this.router && this.router.url !== requestedUrl) return false;
    if (allowed) return true;
    if (!this.pending) {
      this.pending = new Promise(resolve => { this.resolvePending = resolve; });
      this.promptOpen.set(true);
    }
    return this.pending;
  }

  finishConversationConsent(allowed: boolean): void {
    const resolve = this.resolvePending;
    this.resolvePending = null;
    this.pending = null;
    this.promptOpen.set(false);
    resolve?.(allowed && this.hasConversationAccess());
  }

  async waitForAccess(): Promise<boolean> {
    await this.auth.waitForReady();
    // Re-read for navigation in tabs opened before another tab accepted/cleared it.
    this.acceptance.set(this.readAcceptance());
    return this.hasConversationAccess();
  }

  accept(agreed: boolean): boolean {
    if (agreed !== true || !this.storage) return false;
    const record: GuestTermsAcceptance = {
      version: TERMS_VERSION,
      effectiveDate: TERMS_EFFECTIVE_DATE,
      acceptedAt: new Date().toISOString(),
    };
    try {
      this.storage.setItem(GUEST_TERMS_STORAGE_KEY, JSON.stringify(record));
      const saved = this.readAcceptance();
      if (!saved) return false;
      this.acceptance.set(saved);
      return true;
    } catch {
      // Never continue on a failed write or silently mark a guest as agreeing.
      return false;
    }
  }

  private readAcceptance(): GuestTermsAcceptance | null {
    try {
      const raw = this.storage?.getItem(GUEST_TERMS_STORAGE_KEY);
      if (!raw) return null;
      const record: unknown = JSON.parse(raw);
      if (!record || typeof record !== 'object') return null;
      const value = record as Partial<GuestTermsAcceptance>;
      if (value.version !== TERMS_VERSION || value.effectiveDate !== TERMS_EFFECTIVE_DATE
        || typeof value.acceptedAt !== 'string') return null;
      const acceptedAt = Date.parse(value.acceptedAt);
      if (!Number.isFinite(acceptedAt) || acceptedAt <= 0 || acceptedAt > Date.now()) return null;
      return value as GuestTermsAcceptance;
    } catch {
      return null;
    }
  }
}
