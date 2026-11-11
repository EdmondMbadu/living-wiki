import { isPlatformBrowser } from '@angular/common';
import { inject, Injectable, PLATFORM_ID } from '@angular/core';
import { httpsCallable } from 'firebase/functions';
import {
  EVENT_MAX_FILE_BYTES, type EventDataset, type EventGuideSettings, type EventImportResult,
  type EventPlan, type EventPreferences, type EventSourceKind,
} from '../../../functions/src/event-guide-model';
import type { EventLookup } from '../../../functions/src/event-guide-planner';
import type { ContentLanguage } from '../../../functions/src/content-language';
import { getFirebaseFunctions } from '../firebase.client';

export interface EventCardTarget { boardId: string; cardId: string }

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

  readOrganizerRecords(target: EventCardTarget) {
    return this.call<EventDataset>('readEventGuide', { ...target, includeRecords: true });
  }

  ask(target: EventCardTarget, question: string, language: ContentLanguage) {
    return this.call<EventLookup>('askEventGuide', { ...target, question, language });
  }

  plan(target: EventCardTarget, preferences: EventPreferences, language: ContentLanguage) {
    return this.call<EventPlan>('createEventGuideItinerary', { ...target, preferences, language });
  }

  send(target: EventCardTarget, plan: Pick<EventPlan, 'id' | 'key'>, email: string, language: ContentLanguage) {
    return this.call<{ sent: boolean }>('sendEventGuideItinerary', { ...target, id: plan.id, key: plan.key, email, language, consent: true });
  }

  private async call<T>(name: string, request: Record<string, unknown>): Promise<T> {
    if (!this.browser) throw new Error($localize`The event guide is unavailable.`);
    const result = await httpsCallable<Record<string, unknown>, T>(getFirebaseFunctions(), name, { timeout: 125_000 })(request);
    return result.data;
  }
}
