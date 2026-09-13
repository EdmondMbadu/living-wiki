import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '../auth.service';
import { TeamsService } from '../teams/teams.service';
import { teamsServiceStub } from '../teams/teams.testing';
import { AccountMenuComponent } from './account-menu';

describe('AccountMenuComponent team creation', () => {
  for (const allowance of [null, false, true]) {
    it(`keeps Create team discoverable when the allowance is ${allowance}`, async () => {
      const teams = teamsServiceStub();
      teams.canCreate.set(allowance);
      const refresh = spyOn(teams, 'refreshAccount').and.resolveTo();
      await TestBed.configureTestingModule({
        imports: [AccountMenuComponent],
        providers: [
          provideZonelessChangeDetection(),
          provideRouter([]),
          { provide: TeamsService, useValue: teams },
          {
            provide: AuthService,
            useValue: {
              uid: signal('owner'),
              isAuthenticated: signal(true),
              isAdmin: signal(false),
              profile: signal(null),
              displayName: signal('Team Owner'),
              email: signal('owner@example.com'),
            },
          },
        ],
      }).compileComponents();
      const fixture = TestBed.createComponent(AccountMenuComponent);
      fixture.componentInstance.toggleMenu();
      fixture.detectChanges();
      const create = fixture.nativeElement.querySelector('a[href="/teams/new"]');
      expect(create?.textContent).toContain('Create team');
      expect(create?.getAttribute('role')).toBe('menuitem');
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(fixture.nativeElement.querySelector('a[href="/notifications"]')).not.toBeNull();
    });
  }
});
