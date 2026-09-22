import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AtlasService } from '../atlas.service';
import { AuthService } from '../auth.service';
import { TeamsService } from '../teams/teams.service';
import { teamsServiceStub } from '../teams/teams.testing';
import { WorkspaceNavigationOverlayService } from '../workspace-navigation/workspace-navigation';
import { MobileMenuComponent } from './mobile-menu';

describe('MobileMenuComponent', () => {
  let fixture: ComponentFixture<MobileMenuComponent>;

  beforeEach(async () => {
    window.localStorage.removeItem('lw-board-actions:mobile-menu-test-user');
    window.localStorage.removeItem('livingwiki-board-actions-v1:mobile-menu-test-user');

    await TestBed.configureTestingModule({
      imports: [MobileMenuComponent],
      providers: [
        { provide: TeamsService, useFactory: teamsServiceStub },
        provideZonelessChangeDetection(),
        provideRouter([]),
        {
          provide: AuthService,
          useValue: {
            uid: signal('mobile-menu-test-user'),
            profile: signal({ preferredCitySlug: 'my-living-wiki-las-vegas' }),
            isAuthenticated: signal(true),
          },
        },
        {
          provide: AtlasService,
          useValue: {
            activeAtlasWikiLink: signal('/wiki/philly'),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MobileMenuComponent);
    fixture.detectChanges();
  });

  it('uses the canonical navigation in the authenticated mobile drawer', () => {
    const host = fixture.nativeElement as HTMLElement;
    host.querySelector<HTMLButtonElement>('.workspace-menu-trigger')?.click();
    fixture.detectChanges();

    const labels = Array.from(
      host.querySelectorAll<HTMLElement>('.workspace-mobile-item > span:nth-child(2)'),
    ).map((element) => element.textContent?.trim());

    expect(labels).toEqual([
      'Home',
      'Discover',
      'Off Grids',
      'My City Las Vegas',
      'My Boards',
      'My Songs',
      'My Videos',
      'My Friends',
      'My Trips',
      'My Trove · Starfold City',
      'Business',
      'About',
      'More',
    ]);
  });

  it('opens the drawer in the browser top layer and closes it again', () => {
    const host = fixture.nativeElement as HTMLElement;
    const trigger = host.querySelector<HTMLButtonElement>('.workspace-menu-trigger');
    trigger?.click();
    fixture.detectChanges();

    const dialog = host.querySelector<HTMLDialogElement>('.workspace-mobile-drawer');
    expect(dialog?.matches(':modal')).toBeTrue();
    expect(trigger?.getAttribute('aria-expanded')).toBe('true');

    host.querySelector<HTMLButtonElement>('.workspace-mobile-drawer__close')?.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.menuOpen()).toBeFalse();
    expect(host.querySelector('.workspace-mobile-drawer')).toBeNull();
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
  });

  it('releases the modal when the desktop sidebar takes over', () => {
    const host = fixture.nativeElement as HTMLElement;
    host.querySelector<HTMLButtonElement>('.workspace-menu-trigger')?.click();
    fixture.detectChanges();
    expect(host.querySelector<HTMLDialogElement>('.workspace-mobile-drawer')?.matches(':modal')).toBeTrue();

    spyOnProperty(window, 'innerWidth', 'get').and.returnValue(1280);
    fixture.componentInstance.onResize();
    fixture.detectChanges();

    expect(fixture.componentInstance.menuOpen()).toBeFalse();
    expect(host.querySelector('.workspace-mobile-drawer')).toBeNull();
  });

  it('closes the drawer and opens the shared More dialog', () => {
    const overlay = TestBed.inject(WorkspaceNavigationOverlayService);
    const host = fixture.nativeElement as HTMLElement;
    host.querySelector<HTMLButtonElement>('.workspace-menu-trigger')?.click();
    fixture.detectChanges();

    host.querySelector<HTMLButtonElement>('.workspace-mobile-item--more')?.click();

    expect(fixture.componentInstance.menuOpen()).toBeFalse();
    expect(overlay.moreOpen()).toBeTrue();
  });
});
