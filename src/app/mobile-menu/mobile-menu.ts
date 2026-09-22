import {
  AfterViewChecked,
  Component,
  ElementRef,
  HostListener,
  ViewChild,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { AtlasService } from '../atlas.service';
import { AuthService } from '../auth.service';
import {
  WorkspaceNavigationOverlayService,
  WorkspaceNavigationService,
} from '../workspace-navigation/workspace-navigation';

@Component({
  selector: 'app-mobile-menu',
  imports: [RouterLink],
  templateUrl: './mobile-menu.html',
  styleUrl: './mobile-menu.css',
  host: { class: 'lg:hidden' },
})
export class MobileMenuComponent implements AfterViewChecked {
  @ViewChild('menuTrigger') private menuTrigger?: ElementRef<HTMLButtonElement>;
  @ViewChild('menuDialog') private menuDialog?: ElementRef<HTMLDialogElement>;
  readonly activePage = input<string>('home');
  readonly publicSlug = input<string | null>(null);
  readonly hidePublicKnowledgeSurfaces = input<boolean>(false);
  readonly adminNavigation = input<boolean>(true);
  readonly showJoinAction = input<boolean>(false);
  readonly joinLabel = input<string>($localize`Join for Free`);
  readonly showSignInAction = input<boolean>(false);
  readonly signInQueryParams = input<{ redirectTo: string } | null>(null);
  readonly join = output<void>();

  readonly menuOpen = signal(false);
  readonly moreOpen = signal(false);

  private readonly atlasService = inject(AtlasService);
  private readonly authService = inject(AuthService);
  readonly navigation = inject(WorkspaceNavigationService);
  readonly overlay = inject(WorkspaceNavigationOverlayService);
  readonly canonicalWorkspace = computed(() =>
    this.authService.isAuthenticated() && this.adminNavigation() && !this.publicSlug()?.trim(),
  );
  readonly atlasWikiLink = this.atlasService.activeAtlasWikiLink;

  readonly publicPrimaryItems = [
    { route: '/chat', icon: 'chat', label: $localize`Chat`, key: 'chat' },
    { route: '/upload', icon: 'neurology', label: $localize`Upload`, key: 'upload' },
    { route: '/library', icon: 'library_books', label: $localize`Source Files`, key: 'library' },
    { route: '/wiki', icon: 'menu_book', label: $localize`Wiki`, key: 'wiki' },
  ];

  toggleMenu(): void {
    if (this.menuOpen()) {
      this.closeMenu();
    } else {
      this.menuOpen.set(true);
    }
  }

  closeMenu(): void {
    const dialog = this.menuDialog?.nativeElement;
    if (dialog?.open) dialog.close();
    this.menuOpen.set(false);
    this.moreOpen.set(false);
  }

  ngAfterViewChecked(): void {
    const dialog = this.menuDialog?.nativeElement;
    if (this.menuOpen() && dialog && !dialog.open) dialog.showModal();
  }

  onDialogBackdropClick(event: MouseEvent): void {
    const dialog = this.menuDialog?.nativeElement;
    if (!dialog || event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    ) {
      this.closeMenu();
    }
  }

  openMore(): void {
    if (!this.canonicalWorkspace()) {
      this.moreOpen.update((open) => !open);
      return;
    }
    this.closeMenu();
    this.overlay.openMore(this.menuTrigger?.nativeElement);
  }

  openAbout(): void {
    this.closeMenu();
    this.overlay.openAbout(this.menuTrigger?.nativeElement);
  }

  openJoin(): void {
    this.closeMenu();
    this.join.emit();
  }

  shouldShowPublicItem(key: string): boolean {
    if (!this.adminNavigation()) return key === 'chat';
    if (this.hidePublicKnowledgeSurfaces() && key === 'library') return false;
    return true;
  }

  publicRouteFor(key: string, fallbackRoute: string): string {
    const slug = this.publicSlug()?.trim();
    if (slug) {
      if (key === 'wiki') return `/wiki/${slug}`;
      return `/${key}/${slug}`;
    }
    return key === 'wiki' ? this.atlasWikiLink() : fallbackRoute;
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closeMenu();
  }

  @HostListener('window:resize')
  onResize(): void {
    if (window.innerWidth >= 1024) this.closeMenu();
  }
}
