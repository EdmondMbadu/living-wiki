import { computed, signal } from '@angular/core';
import type { TeamMembership, TeamNotification, TeamInvitation } from './team.models';
import type { TeamAccountLoadState } from './teams.service';

/** Isolated navigation fixture: no Firebase app, subscriptions, or network calls. */
export function teamsServiceStub() {
  const memberships = signal<TeamMembership[]>([]);
  const activeMemberships = computed(() =>
    memberships().filter((team) => team.status === 'active'),
  );
  return {
    memberships,
    activeMemberships,
    notifications: signal<TeamNotification[]>([]),
    invitations: signal<TeamInvitation[]>([]),
    canCreate: signal<boolean | null>(true),
    allowanceState: signal<TeamAccountLoadState>('ready'),
    invitationsState: signal<TeamAccountLoadState>('ready'),
    loaded: signal(true),
    connectionError: signal(false),
    sidebarRoute: computed(() =>
      activeMemberships().length === 1 ? `/teams/${activeMemberships()[0].teamId}` : '/teams',
    ),
    refreshAccount: async () => {},
    hasAccess: (teamId: string) => activeMemberships().some((team) => team.teamId === teamId),
    isAdmin: (teamId: string) =>
      activeMemberships().some((team) => team.teamId === teamId && team.role === 'admin'),
  };
}
