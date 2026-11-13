import { isPlatformBrowser } from '@angular/common';
import { inject, Injectable, PLATFORM_ID } from '@angular/core';
import { httpsCallable } from 'firebase/functions';
import { getAuth } from 'firebase/auth';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import {
  EVENT_MAX_FILE_BYTES, type EventDataset, type EventGuideSettings, type EventImportResult,
  type EventItineraryDraft, type EventPlan, type EventPreferences, type EventSourceKind,
} from '../../../functions/src/event-guide-model';
import type { EventLookup } from '../../../functions/src/event-guide-planner';
import type { ContentLanguage } from '../../../functions/src/content-language';
import { getFirebaseApp, getFirebaseFunctions, getFirebaseStorage } from '../firebase.client';

export interface EventCardTarget { boardId: string; cardId: string }
export interface EventRecapSessions {
  voiceSessions: readonly string[];
  textSessions: readonly string[];
  anonymousVisitorId: string | null;
}
export interface EventTextSession {
  analyticsSessionId: string;
  analyticsRequestId: string;
  analyticsVisitorId: string;
  anonymousVisitorId: string | null;
}

@Injectable({ providedIn: 'root' })
export class EventGuideService {
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));

  async preview(boardId: string, kind: EventSourceKind, file: File, startDate: string, sheet = '', mapping = {}) {
    if (!file.size || file.size > EVENT_MAX_FILE_BYTES) throw new Error($localize`Choose a file up to 6 MB.`);
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
      reader.onerror = () => reject(new Error($localize`The file could not be read.`));
      reader.readAsDataURL(file);
    });
    return this.call<EventImportResult>('previewEventGuideImport', { boardId, kind, filename: file.name, base64, startDate, sheet, mapping });
  }

  demo(boardId: string) {
    return this.call<EventDataset>('loadCesEventGuideDemo', { boardId });
  }

  save(boardId: string, settings: EventGuideSettings, dataset: Partial<EventDataset>) {
    return this.call<EventGuideSettings>('saveEventGuideDataset', { boardId, settings, dataset });
  }

  async uploadEmailBanner(file: File): Promise<string> {
    const ownerId = getAuth(getFirebaseApp()).currentUser?.uid;
    if (!ownerId) throw new Error($localize`Sign in to upload an email image.`);
    const asset = ref(getFirebaseStorage(), `users/${ownerId}/boards/event-email/${crypto.randomUUID()}.jpg`);
    await uploadBytes(asset, file, { contentType: 'image/jpeg', cacheControl: 'public,max-age=31536000,immutable' });
    return getDownloadURL(asset);
  }

  readOrganizerRecords(target: EventCardTarget) {
    return this.call<EventDataset>('readEventGuide', { ...target, includeRecords: true });
  }

  ask(target: EventCardTarget, question: string, language: ContentLanguage, session?: EventTextSession) {
    return this.call<EventLookup & { answer?: string; openItinerary?: boolean; historySaved?: boolean }>(
      'askEventGuide', { ...target, question, language, ...session },
    );
  }

  plan(target: EventCardTarget, preferences: EventPreferences, language: ContentLanguage) {
    return this.call<EventPlan>('createEventGuideItinerary', { ...target, preferences, language });
  }

  itinerary(id: string, key: string) {
    return this.call<EventItineraryDraft>('readEventGuideItinerary', { id, key });
  }

  updateItinerary(plan: Pick<EventPlan, 'id' | 'key'>, revision: number, change: { preferences: EventPreferences } | { remove: { date: string; index: number } }) {
    return this.call<EventItineraryDraft>('updateEventGuideItinerary', { id: plan.id, key: plan.key, revision, ...change });
  }

  send(target: EventCardTarget, plan: Pick<EventPlan, 'id' | 'key'> | null, email: string, language: ContentLanguage,
    recap?: EventRecapSessions & { requestId: string }) {
    return this.call<{ sent: boolean }>('sendEventGuideItinerary', {
      ...target, ...(plan ? { id: plan.id, key: plan.key } : {}),
      ...(recap ? { ...recap, recap: true, shareRecapEmailWithAnalytics: true } : {}), email, language, consent: true, editableItinerary: !!plan,
    });
  }

  private async call<T>(name: string, request: Record<string, unknown>): Promise<T> {
    if (!this.browser) throw new Error($localize`The event guide is unavailable.`);
    const result = await httpsCallable<Record<string, unknown>, T>(getFirebaseFunctions(), name, { timeout: 125_000 })(request);
    return result.data;
  }
}
