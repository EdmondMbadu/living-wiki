import { isPlatformBrowser } from '@angular/common';
import { inject, Injectable, PLATFORM_ID } from '@angular/core';
import { httpsCallable } from 'firebase/functions';
import { AuthService } from './auth.service';
import { getFirebaseFunctions } from './firebase.client';

export type PicamoTracking = { sessionId: string; requestId: string };
type Slot = { sessionId: string; lastAt: number };
@Injectable({ providedIn: 'root' })
export class PicamoTrackingService {
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly auth = inject(AuthService);
  private readonly slots = new Map<string, Slot>();
  private storageKey(key: string) {
    return `picamo-activity:${this.auth.uid() || 'guest'}:${key}`;
  }
  private read(key: string): Slot | null {
    if (this.slots.has(this.storageKey(key))) return this.slots.get(this.storageKey(key))!;
    try {
      const value = JSON.parse(sessionStorage.getItem(this.storageKey(key)) || 'null');
      return typeof value?.sessionId === 'string' &&
        /^[A-Za-z0-9_-]{16,180}$/.test(value.sessionId) &&
        typeof value.lastAt === 'number'
        ? value
        : null;
    } catch {
      return null;
    }
  }
  private write(key: string, slot: Slot) {
    this.slots.set(this.storageKey(key), slot);
    try {
      sessionStorage.setItem(this.storageKey(key), JSON.stringify(slot));
    } catch {
      /* Storage is optional. */
    }
  }
  next(key: string, startNew = false): PicamoTracking | undefined {
    if (!this.browser) return undefined;
    const now = Date.now(),
      previous = !startNew ? this.read(key) : null;
    const slot = {
      sessionId:
        previous && now - previous.lastAt < 30 * 60000 ? previous.sessionId : crypto.randomUUID(),
      lastAt: now,
    };
    this.write(key, slot);
    return { sessionId: slot.sessionId, requestId: crypto.randomUUID() };
  }
  city(atlasId: string | null, threadId?: string | null, startNew = false) {
    return atlasId
      ? this.next(`city:${atlasId}:${startNew ? 'current' : threadId || 'current'}`, startNew)
      : undefined;
  }
  bindCity(atlasId: string | null, threadId: string | null | undefined, meta?: PicamoTracking) {
    if (atlasId && threadId && meta)
      this.write(`city:${atlasId}:${threadId}`, { sessionId: meta.sessionId, lastAt: Date.now() });
  }
  async assistant(
    meta: PicamoTracking | undefined,
    phase: 'begin' | 'finish',
    interrupted = false,
  ): Promise<void> {
    if (!this.browser || !meta) return;
    try {
      await httpsCallable(
        getFirebaseFunctions(),
        'recordPicamoAssistantInteraction',
      )({ picamoTracking: meta, phase, interrupted });
    } catch {
      /* Analytics must not prevent chatting, saving, or navigation. */
    }
  }
  async voice(
    sessionId: string | null | undefined,
    conversationId: string | null | undefined,
    anonymousVisitorId?: string | null,
  ): Promise<void> {
    if (!this.browser || !sessionId?.startsWith('pca_') || !conversationId) return;
    try {
      await httpsCallable(
        getFirebaseFunctions(),
        'syncPicamoVoiceAnalytics',
      )({ sessionId, conversationId, anonymousVisitorId: anonymousVisitorId || null });
    } catch {
      /* The server recovery job also discovers and verifies calls after browser exits. */
    }
  }
}
