import { Injectable, inject } from '@angular/core';
import { httpsCallable } from 'firebase/functions';
import { collection, deleteDoc, doc, getDocs, setDoc } from 'firebase/firestore';
import { AuthService } from '../auth.service';
import { getFirebaseFirestore, getFirebaseFunctions } from '../firebase.client';
import { getFirebaseConfig } from '../firebase.config';
import { OffGridScope, OffGridSpot, SpotPage } from './off-grid.models';
export interface MediaUpload {
  cancel: () => void;
  promise: Promise<{ ticketId: string }>;
}
@Injectable({ providedIn: 'root' })
export class OffGridService {
  readonly auth = inject(AuthService);
  private cache = new Map<string, { at: number; page: SpotPage }>();
  private pending = new Map<string, Promise<SpotPage>>();
  private cacheVersion = 0;
  async command<T = Record<string, unknown>>(
    action: string,
    spotId: string,
    values: Record<string, unknown> = {},
  ): Promise<T> {
    return (
      await httpsCallable<Record<string, unknown>, T>(getFirebaseFunctions(), 'offGridCommand', {
        timeout: 300000,
      })({ action, spotId, ...values })
    ).data;
  }
  async list(
    scope: OffGridScope,
    cursor: SpotPage['cursor'] = null,
    search = '',
  ): Promise<SpotPage> {
    if (scope !== 'explore') await this.auth.waitForReady();
    const key = [scope === 'explore' ? 'public' : this.auth.uid() || 'guest', scope, search, JSON.stringify(cursor)].join(':');
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < 15000) return cached.page;
    const existing = this.pending.get(key);
    if (existing) return existing;
    const version = this.cacheVersion;
    const request = (async () => {
      const page = scope === 'explore'
        ? await this.publicList(cursor, search)
        : await this.command<SpotPage>('list', 'directory', { scope, cursor, search });
      if (version === this.cacheVersion) this.cache.set(key, { at: Date.now(), page });
      return page;
    })();
    this.pending.set(key, request);
    try { return await request; }
    finally { if (this.pending.get(key) === request) this.pending.delete(key); }
  }
  async publicList(cursor: SpotPage['cursor'], search: string): Promise<SpotPage> {
    const project = getFirebaseConfig().projectId;
    const url = new URL(`https://us-central1-${project}.cloudfunctions.net/offGridDirectory`);
    if (search) url.searchParams.set('search', search);
    if (cursor) {
      url.searchParams.set('id', cursor.id);
      url.searchParams.set('createdAt', cursor.createdAt);
    }
    const response = await fetch(url, { credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error('Unable to load gems. Please retry.');
    return response.json();
  }
  detail(id: string): Promise<OffGridSpot> {
    return this.command<OffGridSpot>('detail', id);
  }
  invalidate(): void {
    this.cacheVersion++;
    this.cache.clear();
    this.pending.clear();
  }
  async savedIds(): Promise<Set<string>> {
    await this.auth.waitForReady();
    const uid = this.auth.uid();
    if (!uid) return new Set();
    return new Set(
      (
        await getDocs(collection(getFirebaseFirestore(), `users/${uid}/saved_off_grid_spots`))
      ).docs.map((d) => d.id),
    );
  }
  async savePin(id: string, saved: boolean): Promise<void> {
    await this.auth.waitForReady();
    const uid = this.auth.uid();
    if (!uid) throw new Error('Sign in to save this gem.');
    const ref = doc(getFirebaseFirestore(), `users/${uid}/saved_off_grid_spots/${id}`);
    saved ? await setDoc(ref, { createdAt: new Date().toISOString() }) : await deleteDoc(ref);
    this.invalidate();
  }
  upload(
    id: string,
    file: File | Blob,
    kind: 'cover' | 'video',
    options: Record<string, unknown>,
    progress: (value: number, processing: boolean) => void,
  ): MediaUpload {
    let cancelled = false,
      completed = false,
      xhr: XMLHttpRequest | null = null,
      ticketId = '';
    const promise = (async () => {
      const ticket = await this.command<{ ticketId: string; uploadUrl: string }>(
        'beginUpload',
        id,
        {
          ...options,
          kind,
          bytes: file.size,
          contentType: file.type || (kind === 'cover' ? 'image/jpeg' : 'video/mp4'),
        },
      );
      ticketId = ticket.ticketId;
      if (cancelled) {
        await this.command('cancelUpload', id, { ticketId }).catch(() => undefined);
        throw new Error('Upload cancelled.');
      }
      // Chunked Cloud Storage sessions keep private originals free of Firebase download tokens.
      const chunkSize = 8 * 1024 * 1024;
      let offset = 0;
      while (offset < file.size) {
        if (cancelled) throw new Error('Upload cancelled.');
        const end = Math.min(file.size, offset + chunkSize),
          blob = file.slice(offset, end);
        await new Promise<void>((resolve, reject) => {
          xhr = new XMLHttpRequest();
          xhr.open('PUT', ticket.uploadUrl);
          xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
          xhr.setRequestHeader('Content-Range', `bytes ${offset}-${end - 1}/${file.size}`);
          xhr.upload.onprogress = (e) =>
            progress(Math.min(99, Math.round(((offset + e.loaded) / file.size) * 100)), false);
          xhr.onload = () =>
            xhr!.status === 308 || (xhr!.status >= 200 && xhr!.status < 300)
              ? resolve()
              : reject(new Error('Upload interrupted. Please retry.'));
          xhr.onerror = () =>
            reject(new Error('Upload interrupted. Check your connection and retry.'));
          xhr.onabort = () => reject(new Error('Upload cancelled.'));
          xhr.send(blob);
        });
        offset = end;
      }
      progress(100, true);
      await this.command('finishUpload', id, { ticketId });
      if (cancelled) {
        await this.command('cancelUpload', id, { ticketId }).catch(() => undefined);
        throw new Error('Upload cancelled.');
      }
      completed = true;
      this.invalidate();
      return { ticketId };
    })();
    return {
      promise,
      cancel: () => {
        if (completed) return;
        cancelled = true;
        xhr?.abort();
        if (ticketId) void this.command('cancelUpload', id, { ticketId }).catch(() => undefined);
      },
    };
  }
}
