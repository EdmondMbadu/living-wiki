import { isPlatformBrowser } from '@angular/common';
import { inject, Injectable, PLATFORM_ID } from '@angular/core';
import { httpsCallable } from 'firebase/functions';
import { getFirebaseFunctions } from './firebase.client';
export type PicamoMetrics = {
  conversations: number;
  text: number;
  voice: number;
  messages: number;
  seconds: number;
  unknownDurations: number;
  successes: number;
  failures: number;
  responses: number;
  responseMs: number;
};
export type PicamoRow = {
  id: string;
  source: string;
  label: string;
  atlasId: string;
  mode: string;
  startedAt: string;
  messages: number;
  seconds: number | null;
  status: string;
  failures: number;
  internal: boolean;
};
export type PicamoCursor = { id: string; startedAt: number };
export type PicamoFilters = {
  from: string;
  to: string;
  group: string;
  source: string;
  atlasId?: string;
  includeInternal: boolean;
  mode: string;
  recentFrom?: string;
  recentTo?: string;
  cursor?: PicamoCursor | null;
};
export type PicamoReport = {
  trackingSince: string | null;
  updatedAt: string;
  range: { from: string; to: string; group: string; source: string; includeInternal: boolean };
  coverage: { unrecorded: boolean; partial: boolean };
  totals: PicamoMetrics & { accounts: number; guests: number };
  cities?: Array<{ atlasId: string; label: string }>;
  sources: Array<PicamoMetrics & { source: string }>;
  series: Array<PicamoMetrics & { period: string; recorded: boolean; partial: boolean }>;
  rows: PicamoRow[];
  nextCursor: PicamoCursor | null;
};
@Injectable({ providedIn: 'root' })
export class PicamoAnalyticsService {
  private readonly functions = isPlatformBrowser(inject(PLATFORM_ID))
    ? getFirebaseFunctions()
    : null;
  async report(filters: PicamoFilters, refresh = false, exportAll = false): Promise<PicamoReport> {
    if (!this.functions) throw new Error('Analytics require a browser.');
    return (
      await httpsCallable<object, PicamoReport>(
        this.functions,
        'getPicamoAnalytics',
      )({ ...filters, refresh, export: exportAll })
    ).data;
  }
}
