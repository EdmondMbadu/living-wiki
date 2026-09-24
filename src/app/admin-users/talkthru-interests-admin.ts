import { DatePipe, isPlatformBrowser } from '@angular/common';
import { Component, OnInit, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { httpsCallable } from 'firebase/functions';
import { getFirebaseFunctions } from '../firebase.client';

type InterestStatus = 'new' | 'in_progress' | 'done';
type DeliveryStatus = 'pending' | 'sent' | 'failed';
type ScopeFilter = 'active' | 'archived';
type StatusFilter = 'all' | InterestStatus;

interface TalkThruInterestRecord {
  id: string;
  role: 'agent' | 'agency';
  name: string;
  email: string;
  agency: string;
  listing: string;
  status: InterestStatus;
  adminNotes: string;
  archivedAt: string | null;
  doneAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  emailDelivery: {
    applicant: DeliveryStatus;
    jim: DeliveryStatus;
    edmond: DeliveryStatus;
  };
}

interface InterestPage {
  interests: TalkThruInterestRecord[];
  nextCursor: string | null;
}

interface InterestResponse {
  interest: TalkThruInterestRecord | null;
}

interface InterestDraft {
  role: 'agent' | 'agency';
  name: string;
  email: string;
  agency: string;
  listing: string;
  adminNotes: string;
}

@Component({
  selector: 'app-talkthru-interests-admin',
  imports: [DatePipe, FormsModule],
  templateUrl: './talkthru-interests-admin.html',
})
export class TalkThruInterestsAdminComponent implements OnInit {
  readonly templateText = {
    message1: $localize`All statuses`,
    message2: $localize`Agency / team`,
    message3: $localize`Agent`,
    message4: $localize`Restore`,
    message5: $localize`Archive`,
    message6: $localize`Loading...`,
    message7: $localize`Load more signups`,
    message8: $localize`recently`,
  };
  private readonly platformId = inject(PLATFORM_ID);
  readonly interests = signal<TalkThruInterestRecord[]>([]);
  readonly loading = signal(true);
  readonly loadingMore = signal(false);
  readonly busyId = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly nextCursor = signal<string | null>(null);
  readonly open = signal(false);
  readonly search = signal('');
  readonly scope = signal<ScopeFilter>('active');
  readonly statusFilter = signal<StatusFilter>('all');
  readonly editingId = signal<string | null>(null);
  readonly statuses: InterestStatus[] = ['new', 'in_progress', 'done'];
  readonly statusFilters: StatusFilter[] = ['all', 'new', 'in_progress', 'done'];
  draft: InterestDraft = { role: 'agent', name: '', email: '', agency: '', listing: '', adminNotes: '' };

  readonly activeCount = computed(() => this.interests().filter(item => !item.archivedAt).length);
  readonly archivedCount = computed(() => this.interests().filter(item => !!item.archivedAt).length);
  readonly newCount = computed(() => this.interests().filter(item => !item.archivedAt && item.status === 'new').length);
  readonly filtered = computed(() => {
    const query = this.search().trim().toLowerCase();
    return this.interests().filter(item => {
      if (this.scope() === 'active' && item.archivedAt) return false;
      if (this.scope() === 'archived' && !item.archivedAt) return false;
      if (this.statusFilter() !== 'all' && item.status !== this.statusFilter()) return false;
      if (!query) return true;
      return [item.name, item.email, item.agency, item.listing, item.role, item.adminNotes]
        .join(' ').toLowerCase().includes(query);
    });
  });

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) void this.load();
    else this.loading.set(false);
  }

  statusLabel(status: InterestStatus): string {
    return status === 'in_progress' ? 'In progress' : status === 'done' ? 'Done' : 'New';
  }

  deliveryLabel(status: DeliveryStatus): string {
    return status === 'sent' ? 'Sent' : status === 'failed' ? 'Failed' : 'Pending';
  }

  hasUndeliveredEmail(item: TalkThruInterestRecord): boolean {
    return Object.values(item.emailDelivery).some(status => status !== 'sent');
  }

  onSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  toggleOpen(): void {
    this.open.update(value => !value);
  }

  expand(): void {
    this.open.set(true);
  }

  private friendlyError(error: unknown): string {
    return error instanceof Error ? error.message : 'The TalkThru request could not be updated.';
  }

  async load(more = false): Promise<void> {
    if (more && !this.nextCursor()) return;
    if (more) this.loadingMore.set(true);
    else this.loading.set(true);
    this.error.set(null);
    try {
      const list = httpsCallable<{ cursor?: string }, InterestPage>(getFirebaseFunctions(), 'listTalkThruInterests');
      const { data } = await list(more ? { cursor: this.nextCursor() || undefined } : {});
      this.interests.update(items => more ? [...items, ...data.interests] : data.interests);
      this.nextCursor.set(data.nextCursor);
    } catch (error) {
      this.error.set(this.friendlyError(error));
    } finally {
      this.loading.set(false);
      this.loadingMore.set(false);
    }
  }

  private replaceInterest(updated: TalkThruInterestRecord): void {
    this.interests.update(items => items.map(item => item.id === updated.id ? updated : item));
  }

  private async update(id: string, patch: Record<string, unknown>): Promise<boolean> {
    if (this.busyId()) return false;
    this.busyId.set(id);
    this.error.set(null);
    try {
      const update = httpsCallable<{ id: string; patch: Record<string, unknown> }, InterestResponse>(
        getFirebaseFunctions(), 'updateTalkThruInterest');
      const { data } = await update({ id, patch });
      if (data.interest) this.replaceInterest(data.interest);
      return true;
    } catch (error) {
      this.error.set(this.friendlyError(error));
      return false;
    } finally {
      this.busyId.set(null);
    }
  }

  edit(item: TalkThruInterestRecord): void {
    this.draft = {
      role: item.role,
      name: item.name,
      email: item.email,
      agency: item.agency,
      listing: item.listing,
      adminNotes: item.adminNotes,
    };
    this.editingId.set(item.id);
  }

  async saveEdit(item: TalkThruInterestRecord): Promise<void> {
    if (await this.update(item.id, { ...this.draft })) this.editingId.set(null);
  }

  async setStatus(item: TalkThruInterestRecord, status: InterestStatus): Promise<void> {
    if (item.status !== status) await this.update(item.id, { status });
  }

  async setArchived(item: TalkThruInterestRecord, archived: boolean): Promise<void> {
    if (!!item.archivedAt !== archived) await this.update(item.id, { archived });
  }

  async retryEmails(item: TalkThruInterestRecord): Promise<void> {
    if (this.busyId()) return;
    this.busyId.set(item.id);
    this.error.set(null);
    try {
      const retry = httpsCallable<{ id: string }, InterestResponse>(
        getFirebaseFunctions(), 'retryTalkThruInterestEmails');
      const { data } = await retry({ id: item.id });
      if (data.interest) this.replaceInterest(data.interest);
    } catch (error) {
      this.error.set(this.friendlyError(error));
    } finally {
      this.busyId.set(null);
    }
  }

  async delete(item: TalkThruInterestRecord): Promise<void> {
    if (this.busyId()) return;
    if (!window.confirm(`Permanently delete ${item.name}'s TalkThru request? This cannot be undone.`)) return;
    this.busyId.set(item.id);
    this.error.set(null);
    try {
      const remove = httpsCallable<{ id: string }, { deleted: boolean }>(
        getFirebaseFunctions(), 'deleteTalkThruInterest');
      await remove({ id: item.id });
      this.interests.update(items => items.filter(current => current.id !== item.id));
      if (this.editingId() === item.id) this.editingId.set(null);
    } catch (error) {
      this.error.set(this.friendlyError(error));
    } finally {
      this.busyId.set(null);
    }
  }
}
