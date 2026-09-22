import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TalkThruInterestsAdminComponent } from './talkthru-interests-admin';

describe('TalkThruInterestsAdminComponent', () => {
  it('keeps completed requests in the active record and hides archived requests until selected', async () => {
    await TestBed.configureTestingModule({
      imports: [TalkThruInterestsAdminComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
    const fixture = TestBed.createComponent(TalkThruInterestsAdminComponent);
    spyOn(fixture.componentInstance, 'ngOnInit').and.stub();
    fixture.componentInstance.loading.set(false);
    fixture.componentInstance.interests.set([
      {
        id: 'active-interest-1', role: 'agent', name: 'Active Agent', email: 'active@example.com',
        agency: 'Active Realty', listing: '', status: 'done', adminNotes: '', archivedAt: null,
        doneAt: '2026-09-21T12:00:00.000Z', createdAt: '2026-09-20T12:00:00.000Z', updatedAt: null,
        emailDelivery: { applicant: 'sent', jim: 'sent', edmond: 'sent' },
      },
      {
        id: 'archived-interest-1', role: 'agency', name: 'Archived Agency', email: 'archived@example.com',
        agency: 'Archived Realty', listing: '', status: 'new', adminNotes: '',
        archivedAt: '2026-09-21T12:00:00.000Z', doneAt: null,
        createdAt: '2026-09-19T12:00:00.000Z', updatedAt: null,
        emailDelivery: { applicant: 'failed', jim: 'sent', edmond: 'pending' },
      },
    ]);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Active Agent');
    expect(fixture.nativeElement.textContent).not.toContain('Archived Agency');

    fixture.componentInstance.scope.set('archived');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Archived Agency');
    expect(fixture.nativeElement.textContent).not.toContain('Active Agent');
    expect(fixture.nativeElement.textContent).toContain('Send / retry emails');
  });
});
