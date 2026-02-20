import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { ConnectivityService } from '../../core/offline/connectivity.service';
import { OutboxService } from '../../core/offline/outbox.service';
import { SessionService } from '../../core/auth/session.service';
import { environment } from '../../../environments/environment';
import { AuthRequiredPlaceholderComponent } from '../placeholders/auth-required-placeholder.component';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive, AuthRequiredPlaceholderComponent],
  templateUrl: './shell.component.html',
})
export class ShellComponent {
  private connectivity = inject(ConnectivityService);
  private outbox = inject(OutboxService);
  private session = inject(SessionService);

  public isOnline$ = this.connectivity.isOnline$;
  public pendingCount$ = this.outbox.pendingCount$;
  public hasConflict$ = this.outbox.hasConflict$;
  public isAuthenticated$ = this.session.isAuthenticated$;

  public isDevMode = !environment.production;

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
      await this.outbox.processQueue();
    }
  }
}
