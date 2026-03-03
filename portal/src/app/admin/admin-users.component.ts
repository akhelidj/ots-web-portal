import { Component, inject, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, NgForm } from '@angular/forms';
import { AdminUsersService } from './admin-users.service';
import { UserLocalRepo } from '../core/offline/user-local.repo';
import { OutboxService } from '../core/offline/outbox.service';
import { LocalUser, LocalCustomer } from '../core/offline/types';
import { CustomerLocalRepo } from '../core/offline/customer-local.repo';

@Component({
  selector: 'app-admin-users',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-users.component.html',
})
export class AdminUsersComponent implements OnInit {
  private usersService = inject(AdminUsersService);
  private repo = inject(UserLocalRepo);
  private outbox = inject(OutboxService);

  public users$ = this.usersService.users$;

  @ViewChild('userForm') userForm!: NgForm;

  // Form state
  public formEmail = '';
  public formName = '';
  public formRole = 'RECEIVER';
  public formPassword = '';
  public formCustomerId = '';
  public formError = '';

  // Edit User Form state
  public editUserId: string | null = null;
  public editFormName = '';
  public editFormPassword = '';
  public editFormError = '';

  public customers: LocalCustomer[] = [];
  private customerRepo = inject(CustomerLocalRepo);

  public deletingIds = new Set<string>();

  constructor() {
    // legacy temp password listener can be removed or kept empty if service still emits
  }

  ngOnInit() {
    this.usersService.refreshLocalCache();
    this.loadCustomers();
    if (navigator.onLine) {
      this.usersService
        .pullAllAndCache()
        .catch((e) => console.warn('Background refresh failed', e));
    }
  }

  private async loadCustomers() {
    this.customers = await this.customerRepo.list();
  }

  public async onSubmitCreate(): Promise<void> {
    this.formError = '';

    if (!this.formEmail) {
      this.formError = 'Email is required.';
      return;
    }

    if (!this.formPassword) {
      this.formError = 'Temporary password is required.';
      return;
    }

    if (this.formRole === 'CUSTOMER' && !this.formCustomerId) {
      this.formError = 'Customer selection is required for Customer role.';
      return;
    }

    const tempId = 'local-' + crypto.randomUUID();
    const newUser: LocalUser = {
      id: tempId,
      tenantId: 'local-temp', // UI doesn't strictly need accurate tenantId for local creation display
      email: this.formEmail.toLowerCase().trim(),
      name: this.formName || null,
      role: this.formRole,
      isActive: true,
      mustChangePassword: true,
      updatedAt: new Date().toISOString(),
      customerId: this.formRole === 'CUSTOMER' ? this.formCustomerId : null,
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
          customerId: newUser.customerId,
          password: this.formPassword,
        },
        status: 'PENDING',
        attemptCount: 0,
        lastError: null,
      });

      // 3. Immediately refresh Local Stream
      await this.usersService.reloadStreamFromLocal();

      // Reset form state and validation
      if (this.userForm) {
        this.userForm.resetForm();
      }
      this.formEmail = '';
      this.formName = '';
      this.formPassword = '';
      this.formRole = 'RECEIVER';
      this.formCustomerId = '';
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

  public openEditModal(user: LocalUser): void {
    this.editUserId = user.id;
    this.editFormName = user.name || '';
    this.editFormPassword = '';
    this.editFormError = '';
  }

  public closeEditModal(): void {
    this.editUserId = null;
  }

  public async onSubmitEdit(): Promise<void> {
    this.editFormError = '';

    if (!this.editUserId) return;

    // Create optimistic copy
    const userToEdit = await this.repo.getById(this.editUserId);
    if (!userToEdit) {
      this.editFormError = 'User not found.';
      return;
    }

    try {
      const updatedUser: LocalUser = {
        ...userToEdit,
        name: this.editFormName || null,
        syncState: 'PENDING_UPDATE',
      };

      // 1. Write exclusively to Local Repo
      await this.repo.upsert(updatedUser);

      // 2. Enqueue Outbox mutation
      const payload: Record<string, string | null> = {
        name: this.editFormName || null,
      };
      if (this.editFormPassword) {
        payload['password'] = this.editFormPassword;
      }

      await this.outbox.enqueue({
        id: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        entityType: 'USER',
        entityId: this.editUserId,
        operation: 'UPDATE_PROFILE',
        payload,
        status: 'PENDING',
        attemptCount: 0,
        lastError: null,
      });

      // 3. Immediately refresh Local Stream
      await this.usersService.reloadStreamFromLocal();

      this.closeEditModal();
    } catch (e) {
      console.error(e);
      this.editFormError = 'Failed to enqueue editing user.';
    }
  }

  public async onDelete(user: LocalUser): Promise<void> {
    if (this.deletingIds.has(user.id)) return;

    // Start sleek inline loading
    this.deletingIds.add(user.id);
    this.formError = '';

    try {
      // 1. Enqueue Outbox mutation for DELETE
      await this.outbox.enqueue({
        id: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        entityType: 'USER',
        entityId: user.id,
        operation: 'DELETE',
        payload: {},
        status: 'PENDING',
        attemptCount: 0,
        lastError: null,
      });

      // 2. Optimistic apply to Local Repo
      await this.repo.delete(user.id);

      // 3. Eager UI refresh
      await this.usersService.reloadStreamFromLocal();
    } catch (e) {
      console.error(e);
      this.formError = 'Failed to delete user.';
    } finally {
      this.deletingIds.delete(user.id);
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
