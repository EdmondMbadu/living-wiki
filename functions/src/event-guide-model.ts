import { contentLanguageDetails, type ContentLanguage } from './content-language';

export const EVENT_VOICE_HISTORY_VERSION = 1;

export interface EventGuideSettings {
  datasetId: string;
  name: string;
  startDate: string;
  endDate: string;
  timeZone: string;
  informationUrl: string;
  privacyUrl: string;
  travelMinutes: number;
  emailDesign?: EventEmailDesign;
}

export interface EventEmailDesign {
  theme: 'spotlight';
  bannerUrl?: string;
}

export interface EventSession {
  id: string;
  date: string;
  start: number;
  end: number;
  title: string;
  venue: string;
  room: string;
  topics: string;
  note: string;
  url: string;
  kind: 'Keynote' | 'Session' | 'Workshop';
  access: string;
  endEstimated?: boolean;
}

export interface EventExhibitor {
  id: string;
  name: string;
  status: 'booth' | 'area' | 'pending' | 'absent';
  location: string;
  venue: string;
  note: string;
  url: string;
}

export interface EventFloorHours {
  date: string;
  start: number;
  end: number;
}

export interface EventDataset {
  sessions: EventSession[];
  exhibitors: EventExhibitor[];
  floorHours: EventFloorHours[];
}

export interface EventImportResult extends EventDataset {
  warnings: string[];
  sheets: string[];
  sheet: string;
  columns: string[];
}

export interface EventPreferences {
  days: string[];
  interests: string;
  mustSee: string;
  constraints: string;
  pace: 'curated' | 'marathon';
  firstTimer: boolean;
}

export interface EventPlanItem {
  start: number;
  end: number;
  kind: EventSession['kind'] | 'Booth' | 'Area' | 'Break';
  title: string;
  location: string;
  note: string;
  url: string;
  time?: string;
  endEstimated?: boolean;
}

export interface EventPlanDay {
  date: string;
  attending: boolean;
  items: EventPlanItem[];
  alternatives: EventPlanItem[];
}

export interface EventPlan {
  id: string;
  key: string;
  days: EventPlanDay[];
  warnings: string[];
}

export interface EventItineraryDraft {
  settings: EventGuideSettings;
  language: ContentLanguage;
  preferences: EventPreferences;
  plan: EventPlan;
  revision: number;
}

export type EventSourceKind = 'schedule' | 'exhibitors';

export const EVENT_FILE_EXTENSIONS = '.pdf,.md,.docx,.txt,.csv,.xlsx,.json';
export const EVENT_MAX_FILE_BYTES = 6 * 1024 * 1024;
export const EVENT_MAX_DAYS = 31;
const DAY_MS = 86_400_000;

export function eventRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function eventText(value: unknown, max = 300): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

export function eventHttpsUrl(value: unknown): string {
  const text = eventText(value, 1200);
  try {
    const url = new URL(text);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch {
    return '';
  }
}

export function eventEmailDesign(value: unknown): EventEmailDesign | undefined {
  const data = eventRecord(value);
  if (data['theme'] !== 'spotlight') return undefined;
  const bannerUrl = eventHttpsUrl(data['bannerUrl']);
  return { theme: 'spotlight', ...(bannerUrl ? { bannerUrl } : {}) };
}

export function eventDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : '';
}

export function eventDates(start: string, end: string): string[] {
  if (!eventDate(start) || !eventDate(end)) return [];
  const first = Date.parse(start);
  const count = 1 + (Date.parse(end) - first) / DAY_MS;
  if (count < 1 || count > EVENT_MAX_DAYS) return [];
  return Array.from({ length: count }, (_, index) => new Date(first + index * DAY_MS).toISOString().slice(0, 10));
}

export function eventSettings(value: unknown): EventGuideSettings | null {
  const data = eventRecord(value);
  const datasetId = eventText(data['datasetId'], 64);
  const name = eventText(data['name'], 120);
  const startDate = eventDate(data['startDate']);
  const endDate = eventDate(data['endDate']);
  const timeZone = eventText(data['timeZone'], 80);
  if (!/^[a-f0-9]{64}$/.test(datasetId) || !name || !eventDates(startDate, endDate).length || !timeZone) return null;
  try { new Intl.DateTimeFormat('en', { timeZone }); } catch { return null; }
  const informationUrl = eventHttpsUrl(data['informationUrl']);
  const privacyUrl = eventHttpsUrl(data['privacyUrl']);
  if ((data['informationUrl'] && !informationUrl) || (data['privacyUrl'] && !privacyUrl)) return null;
  const travelMinutes = Number(data['travelMinutes'] ?? 30);
  if (!Number.isInteger(travelMinutes) || travelMinutes < 5 || travelMinutes > 120) return null;
  const emailDesign = eventEmailDesign(data['emailDesign']);
  return { datasetId, name, startDate, endDate, timeZone, informationUrl, privacyUrl, travelMinutes, ...(emailDesign ? { emailDesign } : {}) };
}

export function eventDisplayDate(date: string, language: ContentLanguage): string {
  return new Intl.DateTimeFormat(contentLanguageDetails(language).locale, {
    timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric',
  }).format(new Date(`${date}T00:00:00Z`));
}

export function eventDisplayTime(minutes: number, language: ContentLanguage): string {
  return new Intl.DateTimeFormat(contentLanguageDetails(language).locale, {
    timeZone: 'UTC', hour: 'numeric', minute: '2-digit',
  }).format(new Date(Date.UTC(2027, 0, minutes === 1440 ? 2 : 1, 0, minutes % 1440)));
}
