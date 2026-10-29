import { isPlatformBrowser } from '@angular/common';
import { inject, Injectable, PLATFORM_ID } from '@angular/core';
import { httpsCallable } from 'firebase/functions';
import { getFirebaseFunctions } from './firebase.client';
export type PlatformInventory = { boards: number; cards: number; talkingCards: number };
export type PlatformTotals = {
  conversations: number;
  voice: number;
  text: number;
  seconds: number;
  questions: number;
  failedAnswers: number;
  unknownDurations: number;
  activeCards: number;
};
export type PlatformRow = {
  key: string;
  title: string;
  owner: string;
  ownerKey?: string;
  boardTitle: string;
  boardId?: string;
  cardId?: string;
  kind?: string;
  boards: number;
  cards: number;
  talkingCards: number;
  conversations: number;
  voice: number;
  text: number;
  seconds: number;
  unknownDurations?: number;
  analyticsAvailable?: boolean;
  deleted?: boolean;
};
export type PlatformReport = {
  preparing: boolean;
  inventory: PlatformInventory | null;
  error?: string | null;
  trackingSince?: string;
  updatedAt?: string;
  progress?: { status: string; stage: string; processed: number } | null;
  totals?: PlatformTotals;
  series?: Array<{
    period: string;
    seconds: number;
    conversations: number;
    voice: number;
    unknownDurations: number;
    recorded: boolean;
    partial: boolean;
  }>;
  coverage?: { partial: boolean; unrecorded: boolean };
  pending?: number;
  unverified?: number;
  range?: { from: string; to: string; group: string; includeInternal: boolean };
  breakdown?: { view: string; total: number; page: number; pageSize: number; rows: PlatformRow[] };
};
export type PlatformFilters = {
  from: string;
  to: string;
  group: string;
  includeInternal: boolean;
  view: string;
  search: string;
  page: number;
};
@Injectable({ providedIn: 'root' })
export class PlatformAnalyticsService {
  private readonly functions = isPlatformBrowser(inject(PLATFORM_ID))
    ? getFirebaseFunctions()
    : null;
  private async call<T>(name: string, data: object): Promise<T> {
    if (!this.functions) throw new Error('Analytics require a browser.');
    return (await httpsCallable<object, T>(this.functions, name)(data)).data;
  }
  inventory(): Promise<{
    preparing: boolean;
    inventory: PlatformInventory | null;
    updatedAt?: string;
  }> {
    return this.call('getPlatformInventory', {});
  }
  report(filters: PlatformFilters, refresh = false, exportAll = false): Promise<PlatformReport> {
    return this.call('getPlatformAnalytics', { ...filters, refresh, export: exportAll });
  }
  sync(): Promise<{ jobId: string }> {
    return this.call('startPlatformAnalyticsSync', {});
  }
}
