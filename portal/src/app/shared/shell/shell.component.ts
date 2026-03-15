import { Component, inject, signal } from '@angular/core';
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

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    AuthRequiredComponent,
  ],
  templateUrl: './shell.component.html',
})
export class ShellComponent {
  private connectivity = inject(ConnectivityService);
  private outbox = inject(OutboxService);
  private session = inject(SessionService);
  private router = inject(Router);
  private orchestrator = inject(SyncOrchestratorService);
  public navigation = inject(NavigationService);

  public isOnline = this.connectivity.isOnline;
  public pendingCount = this.outbox.pendingCount;
  public hasConflict = this.outbox.hasConflict;
  public isAuthenticated = this.session.isAuthenticated;
  public profile = this.session.profile;

  public syncStatus = this.orchestrator.syncStatus;
  public syncState = this.orchestrator.syncState;
  public lastSyncedAt = this.orchestrator.lastSyncedAt;
  public lastSyncError = this.orchestrator.lastSyncError;

  public isDevMode = !environment.production;
  public mobileMenuOpen = signal(false);
  public readonly APP_ROUTES = AppRoutes;

  constructor() {
    this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) {
        this.closeMobileMenu();
      }
    });
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
