import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService } from '../auth.service';
import { TeamsService } from '../teams/teams.service';
import { teamError, teamInitials, type TeamNotification } from '../teams/team.models';
import { AccountMenuComponent } from '../account-menu/account-menu';
import { WorkspaceSidebarComponent } from '../workspace-sidebar/workspace-sidebar';
import { MobileMenuComponent } from '../mobile-menu/mobile-menu';
import { ThemeToggleComponent } from '../theme-toggle/theme-toggle';

@Component({
  selector: 'app-notifications',
  imports: [
    RouterLink,
    DatePipe,
    AccountMenuComponent,
    WorkspaceSidebarComponent,
    MobileMenuComponent,
    ThemeToggleComponent,
  ],
  templateUrl: './notifications.html',
  styleUrl: './notifications.css',
})
export class NotificationsComponent {
  readonly teams = inject(TeamsService);
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly filter = signal('all');
  readonly error = signal('');
  readonly busy = signal(false);
  readonly initials = teamInitials;
  readonly updates = computed(() =>
    this.teams.notifications().filter((item) => item.type !== 'team_invitation'),
  );
  constructor() {
    this.route.queryParamMap
      .pipe(takeUntilDestroyed())
      .subscribe((params) =>
        this.filter.set(
          ['invitations', 'updates'].includes(params.get('filter') || '')
            ? params.get('filter')!
            : 'all',
        ),
      );
    void this.teams.refreshAccount();
  }
  async markAllRead(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.teams.markAllNotificationsRead();
    } catch (error) {
      this.error.set(teamError(error));
    } finally {
      this.busy.set(false);
    }
  }
  async openUpdate(item: TeamNotification): Promise<void> {
    this.error.set('');
    try {
      await this.teams.markNotificationRead(item.id);
      if (!this.teams.hasAccess(item.teamId)) {
        this.error.set('This update is saved, but you no longer have access to that team.');
        return;
      }
      await this.router.navigate(['/teams', item.teamId], {
        queryParams: item.target ? { listing: item.target } : {},
      });
    } catch (error) {
      this.error.set(teamError(error));
    }
  }
}
