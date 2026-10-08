import {
  Component,
  ElementRef,
  HostListener,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import {
  NavigationEnd,
  RouterOutlet,
  RouterLink,
  RouterLinkActive,
} from '@angular/router';
import { ConnectivityService } from '@portal/core/offline/services/connectivity.service';
import { OutboxService } from '@portal/core/offline/services/outbox.service';
import { SessionService } from '@portal/core/auth/services/session.service';
import { SyncOrchestratorService } from '@portal/core/offline/services/sync-orchestrator.service';
import { NavigationService } from '@portal/core/navigation/services/navigation.service';
import { AppRoutes } from '@portal/core/navigation/constants/routes.constants';
import { environment } from '@app-env/environment';
import { AuthRequiredComponent } from '@portal/shared/components/auth-required/auth-required.component';
import { APP_ROLES } from '@portal/core/constants/app.constants';
import { SignatureService } from '@portal/core/auth/services/signature.service';
import { SignatureDialogComponent } from '@portal/shared/components/signature-dialog/signature-dialog.component';
import { ThemeToggleComponent } from '@portal/shared/components/theme-toggle/theme-toggle.component';
import { ThemeService } from '@portal/core/theme/theme.service';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    AuthRequiredComponent,
    SignatureDialogComponent,
    ThemeToggleComponent,
  ],
  templateUrl: './shell.component.html',
})
export class ShellComponent {
  private connectivity = inject(ConnectivityService);
  private outbox = inject(OutboxService);
  private session = inject(SessionService);
  private router = inject(Router);
  private orchestrator = inject(SyncOrchestratorService);
  private signatures = inject(SignatureService);
  /** Instantiated here so the customer theme is applied for the whole session. */
  public readonly theme = inject(ThemeService);
  public navigation = inject(NavigationService);

  /** Inspector with no account signature: the content is blurred and inert until one
   *  is registered (re-shown on every login/reload, like the forced password change). */
  public signatureRequired = this.session.signatureRequired;
  public signatureDialogOpen = signal(false);

  public isOnline = this.connectivity.isOnline;
  public pendingCount = this.outbox.pendingCount;
  public hasConflict = this.outbox.hasConflict;
  public isAuthenticated = this.session.isAuthenticated;
  public profile = this.session.profile;

  /** Customers are read-only and hold no local writes, so the header shows them
   *  neither the sync/connectivity status nor their role. */
  public isCustomer = computed(
    () => this.profile()?.role === APP_ROLES.CUSTOMER,
  );

  /** The organisation under the user's name: a customer sees their own company,
   *  staff see the tenant (the service company). */
  public organizationName = computed(() => {
    const p = this.profile();
    if (!p) return '';
    if (this.isCustomer()) {
      return (
        this.theme.branding()?.name || p.customer?.name || p.tenant?.name || ''
      );
    }
    return p.tenant?.name || p.customer?.name || 'Internal';
  });

  /** The signed-in customer has a logo: the header shows their brand, not OTS's. */
  public customerBrandLogo = computed(
    () => this.isCustomer() && !!this.theme.branding()?.logoId,
  );

  public syncStatus = this.orchestrator.syncStatus;
  public syncState = this.orchestrator.syncState;
  public lastSyncedAt = this.orchestrator.lastSyncedAt;
  public lastSyncError = this.orchestrator.lastSyncError;

  public canSyncNow = computed(
    () =>
      this.isAuthenticated() &&
      this.isOnline() &&
      this.syncState() !== 'syncing',
  );

  /** Hover text for the sync pill: the error, else when it last synced. */
  public syncTooltip = computed(() => {
    if (this.syncState() === 'sync-error') {
      return this.lastSyncError() || 'Local changes could not be synchronized';
    }
    if (!this.isOnline()) return 'Offline — changes are saved on this device';
    const last = this.lastSyncedAt();
    return last
      ? `Last synced ${this.formatLastSynced(last)} — click to sync now`
      : 'Click to sync now';
  });

  public initials = computed(() => {
    const p = this.profile();
    if (!p) return '';
    const words = (p.name?.trim() || p.email)
      .split(/[\s@._-]+/)
      .filter(Boolean);
    const [first = '', second = ''] = words;
    return (
      second ? `${first.charAt(0)}${second.charAt(0)}` : first.slice(0, 2)
    ).toUpperCase();
  });

  public isDevMode = !environment.production;
  public mobileMenuOpen = signal(false);
  public accountMenuOpen = signal(false);
  @ViewChild('accountMenu') private accountMenuRef?: ElementRef<HTMLElement>;
  @ViewChild('accountButton')
  private accountButtonRef?: ElementRef<HTMLButtonElement>;
  public readonly APP_ROUTES = AppRoutes;

  /** The active route asked for the full-height app frame (`data: { appFrame: true }`):
   *  `main` drops its page padding and scroll so the routed screen owns the viewport. */
  public appFrame = signal(false);

  constructor() {
    this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) {
        this.closeMobileMenu();
        this.accountMenuOpen.set(false);
        this.appFrame.set(this.deepestRouteFlag('appFrame'));
      }
    });

    // A registered signature is never removed, so only an unknown/missing flag needs
    // confirming (profiles cached before the feature carry no flag).
    if (this.session.profile()?.hasSignature !== true) {
      void this.signatures.refreshStatus();
    }
  }

  public openSignatureDialog(): void {
    this.signatureDialogOpen.set(true);
  }

  public closeSignatureDialog(): void {
    this.signatureDialogOpen.set(false);
  }

  private deepestRouteFlag(key: string): boolean {
    let route = this.router.routerState.snapshot.root;
    while (route.firstChild) route = route.firstChild;
    return route.data[key] === true;
  }

  public toggleMobileMenu(): void {
    this.mobileMenuOpen.update((v) => !v);
  }

  public closeMobileMenu(): void {
    const active = document.activeElement;
    if (active instanceof HTMLElement) {
      active.blur();
    }

    this.mobileMenuOpen.set(false);
  }

  // ---- Account menu (desktop header) ----

  public toggleAccountMenu(): void {
    if (this.accountMenuOpen()) this.closeAccountMenu();
    else this.openAccountMenu();
  }

  /** Opens the menu and moves focus to its first item, like a native menu. */
  public openAccountMenu(): void {
    this.accountMenuOpen.set(true);
    setTimeout(() => this.menuItems()[0]?.focus());
  }

  public closeAccountMenu(restoreFocus = false): void {
    if (!this.accountMenuOpen()) return;
    this.accountMenuOpen.set(false);
    if (restoreFocus) this.accountButtonRef?.nativeElement.focus();
  }

  private menuItems(): HTMLElement[] {
    const root = this.accountMenuRef?.nativeElement;
    return root
      ? Array.from(root.querySelectorAll<HTMLElement>('[role="menuitem"]'))
      : [];
  }

  /** ↑/↓/Home/End move between items; Esc closes back onto the button; Tab leaves. */
  public onAccountMenuKeydown(event: KeyboardEvent): void {
    const items = this.menuItems();
    const index = items.indexOf(document.activeElement as HTMLElement);
    let next: HTMLElement | undefined;
    switch (event.key) {
      case 'ArrowDown':
        next = items[(index + 1) % items.length];
        break;
      case 'ArrowUp':
        next = items[(index - 1 + items.length) % items.length];
        break;
      case 'Home':
        next = items[0];
        break;
      case 'End':
        next = items[items.length - 1];
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        this.closeAccountMenu(true);
        return;
      case 'Tab':
        this.closeAccountMenu();
        return;
      default:
        return;
    }
    event.preventDefault();
    next?.focus();
  }

  @HostListener('document:click', ['$event'])
  public onDocumentClick(event: MouseEvent): void {
    if (!this.accountMenuOpen()) return;
    const root = this.accountMenuRef?.nativeElement;
    if (root && event.target instanceof Node && !root.contains(event.target)) {
      this.closeAccountMenu();
    }
  }

  @HostListener('document:keydown.escape')
  public onDocumentEscape(): void {
    this.closeAccountMenu(true);
  }

  public getProfileLabel(): string {
    const p = this.profile();
    if (!p) return 'Menu';
    return p.name?.trim() || p.email;
  }

  public onSignOut() {
    this.session.logout();
    this.router.navigate(['/login']);
  }

  public async clearSyncErrors() {
    await this.outbox.clearConflicts();
    await this.orchestrator.syncNow();
  }

  public async onSyncNow() {
    if (!this.canSyncNow()) return;
    await this.orchestrator.syncNow();
  }

  public async simulateOfflineMutation() {
    if (!this.isDevMode) return;

    await this.outbox.enqueue({
      id: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      entityType: 'System',
      entityId: 'dev-ping',
      operation: 'ping',
      payload: {},
      status: 'PENDING',
      attemptCount: 0,
      lastError: null,
    });

    // Auto-trigger sync orchestrator if online so we see it resolve
    if (this.connectivity.isOnline()) {
      await this.orchestrator.syncNow();
    }
  }

  public formatLastSynced(isoStr: string | null): string {
    if (!isoStr) return '';
    const date = new Date(isoStr);
    const today = new Date();

    // Check if it's today
    if (
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear()
    ) {
      return `Today, ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    }

    // Otherwise
    return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  }
}
