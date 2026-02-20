import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminUsersService } from './admin-users.service';
import { UserLocalRepo } from '../core/offline/user-local.repo';
import { OutboxService } from '../core/offline/outbox.service';
import { LocalUser } from '../core/offline/types';
import { AdminCustomersComponent } from './admin-customers.component';

@Component({
  selector: 'app-admin-users',
  standalone: true,
  imports: [CommonModule, FormsModule, AdminCustomersComponent],
  templateUrl: './admin-users.component.html',
})
export class AdminUsersComponent {
  private usersService = inject(AdminUsersService);
  private repo = inject(UserLocalRepo);
  private outbox = inject(OutboxService);

  public users$ = this.usersService.users$;

  // Form state
  public formEmail = '';
  public formName = '';
  public formRole = 'RECEIVER';
  public formError = '';

  public tempPasswordDisplay: string | null = null;

  constructor() {
    this.usersService.tempPasswordNotified$.subscribe((pwd) => {
      if (pwd) {
        this.tempPasswordDisplay = pwd;
      }
    });
  }

  public async onSubmitCreate(): Promise<void> {
    this.formError = '';
    this.tempPasswordDisplay = null;

    if (!this.formEmail) {
      this.formError = 'Email is required.';
      return;
    }

    const tempId = 'local-' + crypto.randomUUID();
    const newUser: LocalUser = {
      id: tempId,
      tenantId: 'local-temp', // UI doesn't strictly need accurate tenantId for local creation display
      email: this.formEmail,
      name: this.formName || null,
      role: this.formRole,
      isActive: true,
      mustChangePassword: true,
      updatedAt: new Date().toISOString(),
      syncState: 'PENDING_CREATE',
    };

    try {
      // 1. Write exclusively to Local Repo
      await this.repo.upsert(newUser);

      // 2. Enqueue Outbox mutation
      await this.outbox.enqueue({
        id: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        entityType: 'USER',
        entityId: tempId,
        operation: 'CREATE',
        payload: {
          email: newUser.email,
          name: newUser.name,
          role: newUser.role,
          isActive: true,
        },
        status: 'PENDING',
        attemptCount: 0,
        lastError: null,
      });

      // 3. Immediately refresh Local Stream
      await this.usersService.reloadStreamFromLocal();

      // Reset form
      this.formEmail = '';
      this.formName = '';
      this.formRole = 'RECEIVER';
    } catch (e) {
      console.error(e);
      this.formError = 'Failed to enqueue creating user.';
    }
  }

  public async onToggleActive(user: LocalUser): Promise<void> {
    try {
      const toggledState = !user.isActive;

      // 1. Optimistic apply to Local Repo
      const updatedUser: LocalUser = {
        ...user,
        isActive: toggledState,
        syncState: 'PENDING_UPDATE',
      };
      await this.repo.upsert(updatedUser);

      // 2. Enqueue Outbox mutation
      await this.outbox.enqueue({
        id: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        entityType: 'USER',
        entityId: user.id,
        operation: 'SET_ACTIVE',
        payload: { isActive: toggledState },
        status: 'PENDING',
        attemptCount: 0,
        lastError: null,
      });

      // 3. Eager UI refresh
      await this.usersService.reloadStreamFromLocal();
    } catch (e) {
      console.error(e);
      this.formError = 'Failed to toggle active state.';
    }
  }

  // Expose hook so app shell can pass temp passwords generated during dispatch
  // This listens for sync dispatch temp passwords if we had a mediator,
  // but since HTTP dispatch is background, we can't easily bubble up tempPassword.
  // Wait, if we generate temp password on server, how do we show it to the admin?
  // Ah, the requirements specifically ask: "Return it in the POST response. Display it once in UI as 'Temporary password'."
  // However, because we are using an Offline Write-Through queue (Outbox), the server response doesn't come back immediately.
  // If we are offline, we can't show it. If we are online, it syncs in background.
  // This is a known caveat of Write-Through outbox pattern. 
  // Let's implement an event stream or poll if we want to catch the exact result, 
  // but for MVP, I will just display a message when a SYNC provides a password to be safe.
}
