import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, effect, ElementRef, inject, input, model, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  EVENT_FILE_EXTENSIONS, eventDate, eventDates, eventDisplayTime, eventHttpsUrl, type EventDataset, type EventExhibitor,
  type EventFloorHours, type EventGuideSettings, type EventImportResult, type EventSession, type EventSourceKind,
} from '../../../functions/src/event-guide-model';
import { EventGuideService } from './event-guide.service';

interface SourcePreview {
  file: File;
  preview: EventImportResult;
  mapping: Record<string, string>;
}

type SessionDraft = Omit<EventSession, 'start' | 'end'> & { start: string; end: string };
type ManualEntry = { kind: 'schedule'; row: SessionDraft } | { kind: 'exhibitors'; row: EventExhibitor };

const scheduleFields = [
  ['title', $localize`Title`], ['date', $localize`Date`], ['time', $localize`Time range`], ['start', $localize`Start`], ['end', $localize`End`],
  ['location', $localize`Room or location`], ['venue', $localize`Venue or hall`], ['topics', $localize`Topics`], ['note', $localize`Notes`],
];
const exhibitorFields = [
  ['name', $localize`Exhibitor name`], ['status', $localize`Location status`], ['location', $localize`Location`],
  ['booth', $localize`Booth number`], ['venue', $localize`Venue or hall`], ['note', $localize`Notes`],
];

@Component({
  selector: 'app-event-guide-setup',
  imports: [FormsModule, NgTemplateOutlet],
  templateUrl: './event-guide-setup.html',
  styleUrl: './event-guide-setup.css',
})
export class EventGuideSetup implements OnInit {
  private readonly events = inject(EventGuideService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly uploadScheduleLabel = $localize`Upload schedule`;
  readonly uploadExhibitorsLabel = $localize`Upload exhibitors`;
  readonly boardId = input.required<string>();
  readonly cardId = input('');
  readonly disabled = input(false);
  readonly invalidField = input('');
  readonly validationMessage = input('');
  readonly settings = model.required<EventGuideSettings>();
  readonly dataset = model.required<Partial<EventDataset>>();
  readonly importing = model(false);
  readonly reviewing = model(false);
  readonly loadingSource = signal<EventSourceKind | null>(null);
  readonly dragging = signal<EventSourceKind | null>(null);
  readonly manual = signal<ManualEntry | null>(null);
  readonly manualError = signal('');
  readonly sourceLimit = 1000;
  readonly previews = signal<Partial<Record<EventSourceKind, SourcePreview>>>({});
  readonly error = signal('');
  readonly accepted = EVENT_FILE_EXTENSIONS;
  readonly sources = [
    { kind: 'schedule' as const, label: $localize`Schedule`, fields: scheduleFields },
    { kind: 'exhibitors' as const, label: $localize`Exhibitors`, fields: exhibitorFields },
  ];
  readonly dates = computed(() => eventDates(this.settings().startDate, this.settings().endDate));
  readonly published = signal<EventDataset | null>(null);
  readonly loadingPublished = signal(false);
  readonly publishedError = signal(false);
  readonly sessions = computed(() => this.dataset().sessions ?? this.published()?.sessions ?? []);
  readonly exhibitors = computed(() => this.dataset().exhibitors ?? this.published()?.exhibitors ?? []);

  constructor() {
    effect(() => this.reviewing.set(!!this.manual() || Object.values(this.previews()).some(Boolean)));
  }

  ngOnInit(): void {
    if (this.cardId()) void this.loadPublished();
  }

  async loadPublished(): Promise<void> {
    if (!this.cardId() || this.loadingPublished()) return;
    this.loadingPublished.set(true);
    this.publishedError.set(false);
    try {
      this.published.set(await this.events.readOrganizerRecords({ boardId: this.boardId(), cardId: this.cardId() }));
    } catch {
      this.publishedError.set(true);
    } finally {
      this.loadingPublished.set(false);
    }
  }

  readonly pending = computed(() => this.importing() || this.disabled());

  setField<K extends keyof EventGuideSettings>(key: K, value: EventGuideSettings[K]): void {
    const normalized = key === 'informationUrl' || key === 'privacyUrl' ? String(value ?? '').trim() : value;
    this.settings.update((settings) => ({ ...settings, [key]: normalized }));
  }

  chooseFile(kind: EventSourceKind, event: Event): void {
    const element = event.target as HTMLInputElement;
    const file = element.files?.[0];
    element.value = '';
    if (file) void this.preview(kind, file);
  }

  dragOver(kind: EventSourceKind, event: DragEvent): void {
    event.preventDefault();
    if (!this.pending()) this.dragging.set(kind);
  }

  dropFile(kind: EventSourceKind, event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(null);
    const file = event.dataTransfer?.files[0];
    if (file) void this.preview(kind, file);
  }

  discardPreview(kind: EventSourceKind): void {
    this.previews.update((previews) => ({ ...previews, [kind]: undefined }));
  }

  canEnter(kind: EventSourceKind): boolean {
    if (this.pending() || this.manual() || this.previews()[kind]) return false;
    if (!this.cardId() || this.published()) return true;
    return kind === 'schedule' ? this.dataset().sessions !== undefined : this.dataset().exhibitors !== undefined;
  }

  openSession(session?: EventSession): void {
    if (!this.canEnter('schedule') || (!session && this.sessions().length >= this.sourceLimit)) return;
    const row: SessionDraft = session
      ? { ...session, start: this.inputTime(session.start), end: this.inputTime(session.end) }
      : {
          id: '', title: '', date: this.settings().startDate, start: '', end: '', kind: 'Session',
          room: '', venue: '', topics: '', note: '', url: '', access: '',
        };
    this.manualError.set('');
    this.manual.set({ kind: 'schedule', row });
    this.focusManual();
  }

  openExhibitor(exhibitor?: EventExhibitor): void {
    if (!this.canEnter('exhibitors') || (!exhibitor && this.exhibitors().length >= this.sourceLimit)) return;
    const row: EventExhibitor = exhibitor ? { ...exhibitor } : {
      id: '', name: '', location: '', venue: '', status: 'pending', note: '', url: '',
    };
    this.manualError.set('');
    this.manual.set({ kind: 'exhibitors', row });
    this.focusManual();
  }

  private focusManual(): void {
    requestAnimationFrame(() => this.host.nativeElement.querySelector<HTMLInputElement>('.event-setup__manual input')?.focus());
  }

  updateSession<K extends keyof SessionDraft>(field: K, value: SessionDraft[K]): void {
    this.manual.update((entry) => entry?.kind === 'schedule' ? { ...entry, row: { ...entry.row, [field]: value, ...(field === 'end' ? { endEstimated: false } : {}) } } : entry);
    this.manualError.set('');
  }

  updateExhibitor<K extends keyof EventExhibitor>(field: K, value: EventExhibitor[K]): void {
    this.manual.update((entry) => entry?.kind === 'exhibitors' ? { ...entry, row: { ...entry.row, [field]: value } } : entry);
    this.manualError.set('');
  }

  saveManual(): void {
    const entry = this.manual();
    if (!entry || this.pending()) return;
    if (entry.row.url.trim() && !eventHttpsUrl(entry.row.url)) {
      this.manualError.set($localize`Enter a secure HTTPS link or leave it blank.`);
      return;
    }
    const id = entry.row.id || crypto.randomUUID();
    if (entry.kind === 'schedule') {
      const { row } = entry;
      const start = this.readTime(row.start);
      const finish = this.readTime(row.end);
      const end = finish === 0 && start > 0 ? 1440 : finish;
      if (!row.title.trim() || !eventDate(row.date) || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        this.manualError.set($localize`Enter a session title, date, and an end time after the start.`);
        return;
      }
      const session = { ...row, id, title: row.title.trim(), start, end };
      this.setSessions(this.upsert(this.sessions(), session));
    } else {
      const { row } = entry;
      const confirmed = row.status === 'area' || row.status === 'booth';
      if (!row.name.trim() || (confirmed && !row.location.trim())) {
        this.manualError.set($localize`Enter the exhibitor’s name and any confirmed location.`);
        return;
      }
      const exhibitor = { ...row, id, name: row.name.trim(), location: confirmed ? row.location.trim() : '', venue: confirmed ? row.venue.trim() : '' };
      this.dataset.update((dataset) => ({ ...dataset, exhibitors: this.upsert(this.exhibitors(), exhibitor) }));
    }
    this.manual.set(null);
  }

  removeManual(): void {
    const entry = this.manual();
    if (!entry?.row.id || this.pending()) return;
    if (entry.kind === 'schedule') {
      this.dataset.update((data) => ({ ...data, sessions: this.sessions().filter((row) => row.id !== entry.row.id) }));
    } else {
      this.dataset.update((data) => ({ ...data, exhibitors: this.exhibitors().filter((row) => row.id !== entry.row.id) }));
    }
    this.manual.set(null);
  }

  private upsert<T extends { id: string }>(rows: T[], item: T): T[] {
    return rows.some((row) => row.id === item.id) ? rows.map((row) => row.id === item.id ? item : row) : [...rows, item];
  }

  private setSessions(sessions: EventSession[], floorHours?: EventFloorHours[]): void {
    const dates = sessions.map((session) => session.date).sort();
    const { startDate, endDate } = this.settings();
    this.settings.update((settings) => ({
      ...settings,
      startDate: startDate && startDate < dates[0] ? startDate : dates[0],
      endDate: endDate && endDate > dates[dates.length - 1] ? endDate : dates[dates.length - 1],
    }));
    this.dataset.update((data) => ({ ...data, sessions, ...(floorHours?.length ? { floorHours } : {}) }));
  }

  private readTime(value: string): number {
    if (!/^\d{2}:\d{2}$/.test(value)) return NaN;
    const [hours, minutes] = value.split(':').map(Number);
    return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : NaN;
  }

  changeSheet(kind: EventSourceKind, sheet: string): void {
    const source = this.previews()[kind];
    if (source) void this.preview(kind, source.file, sheet);
  }

  setMapping(kind: EventSourceKind, field: string, column: string): void {
    this.previews.update((previews) => {
      const source = previews[kind];
      return source ? { ...previews, [kind]: { ...source, mapping: { ...source.mapping, [field]: column } } } : previews;
    });
  }

  applyMapping(kind: EventSourceKind): void {
    const source = this.previews()[kind];
    if (source) void this.preview(kind, source.file, source.preview.sheet, source.mapping);
  }

  accept(kind: EventSourceKind): void {
    const source = this.previews()[kind]?.preview;
    if (!source) return;
    if (kind === 'schedule' && source.sessions.length) this.setSessions(source.sessions, source.floorHours);
    if (kind === 'exhibitors' && source.exhibitors.length) {
      this.dataset.update((data) => ({ ...data, exhibitors: source.exhibitors }));
    }
    this.discardPreview(kind);
  }

  floorHours(date: string): EventFloorHours | undefined {
    return (this.dataset().floorHours ?? this.published()?.floorHours ?? []).find((item) => item.date === date);
  }

  changeFloorHours(date: string, field: 'start' | 'end' | 'status', value: string): void {
    const prior = this.dataset().floorHours ?? this.published()?.floorHours ?? [];
    const remaining = prior.filter((item) => item.date !== date);
    if (field === 'status' && value === 'unknown') {
      this.dataset.update((data) => ({ ...data, floorHours: remaining }));
      return;
    }
    const time = this.readTime(value);
    const existing = this.floorHours(date);
    const row = field === 'status'
      ? { date, start: value === 'closed' ? 0 : 540, end: value === 'closed' ? 0 : 1080 }
      : { date, start: existing?.start ?? 540, end: existing?.end ?? 1080, [field]: field === 'end' && time === 0 ? 1440 : time };
    if (Number.isFinite(row.start) && Number.isFinite(row.end)) {
      this.dataset.update((data) => ({ ...data, floorHours: [...remaining, row] }));
    }
  }

  inputTime(minutes: number): string {
    return `${String(Math.floor((minutes % 1440) / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }

  formatTime(minutes: number): string {
    return eventDisplayTime(minutes, 'en');
  }

  private async preview(kind: EventSourceKind, file: File, sheet = '', mapping: Record<string, string> = {}): Promise<void> {
    if (this.pending() || this.manual()) return;
    this.importing.set(true);
    this.loadingSource.set(kind);
    this.error.set('');
    this.previews.update((previews) => ({ ...previews, [kind]: undefined }));
    try {
      const preview = await this.events.preview(this.boardId(), kind, file, this.settings().startDate, sheet, mapping);
      this.previews.update((previews) => ({ ...previews, [kind]: { file, preview, mapping } }));
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : $localize`The file could not be imported.`);
    } finally {
      this.loadingSource.set(null);
      this.importing.set(false);
    }
  }
}
