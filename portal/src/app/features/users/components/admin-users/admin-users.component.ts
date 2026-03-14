import { Component, inject, OnInit, ViewChild, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, NgForm } from '@angular/forms';
import { AdminUsersService } from '@portal/features/users/services/admin-users.service';
import { LocalUser, LocalCustomer } from '@portal/core/offline/models/types';
import { CustomerLocalRepo } from '@portal/core/offline/repos/customer-local.repo';
import { APP_ROLES, AppRole } from '@portal/core/constants/app.constants';
import { UserPreferencesService } from '@portal/core/services/user-preferences.service';

@Component({
  selector: 'app-admin-users',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-users.component.html',
})
export class AdminUsersComponent implements OnInit {
  private usersService = inject(AdminUsersService);

  public users = this.usersService.users;
  public prefs = inject(UserPreferencesService);
  public isCompactMode = computed(() => this.prefs.preferences().compactMode);

  @ViewChild('userForm') userForm!: NgForm;

  // Form state
  public formEmail = '';
  public formName = '';
  public formRole: AppRole = APP_ROLES.RECEIVER;
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
    this.usersService
      .pullAllAndCache()
      .catch((e) => console.warn('Background refresh failed', e));
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

    if (this.formRole === APP_ROLES.CUSTOMER && !this.formCustomerId) {
      this.formError = 'Customer selection is required for Customer role.';
      return;
    }

    try {
      await this.usersService.createUser({
        email: this.formEmail.toLowerCase().trim(),
        name: this.formName || null,
        role: this.formRole,
        customerId:
          this.formRole === APP_ROLES.CUSTOMER ? this.formCustomerId : null,
        password: this.formPassword,
      });

      // Reset form state and validation
      if (this.userForm) {
        this.userForm.resetForm();
      }
      this.formEmail = '';
      this.formName = '';
      this.formPassword = '';
      this.formRole = APP_ROLES.RECEIVER;
      this.formCustomerId = '';
    } catch (e) {
      console.error(e);
      this.formError = 'Failed to save user.';
    }
  }

  public async onToggleActive(user: LocalUser): Promise<void> {
    try {
      await this.usersService.toggleActive(user);
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
    const userToEdit = this.users().find((user) => user.id === this.editUserId);
    if (!userToEdit) {
      this.editFormError = 'User not found.';
      return;
    }

    try {
      await this.usersService.updateProfile(this.editUserId, {
        name: this.editFormName || null,
        password: this.editFormPassword || undefined,
      });

      this.closeEditModal();
    } catch (e) {
      console.error(e);
      this.editFormError = 'Failed to update user.';
    }
  }

  public async onDelete(user: LocalUser): Promise<void> {
    if (this.deletingIds.has(user.id)) return;

    // Start sleek inline loading
    this.deletingIds.add(user.id);
    this.formError = '';

    try {
      await this.usersService.deleteUser(user);
    } catch (e) {
      console.error(e);
      this.formError = 'Failed to delete user.';
    } finally {
      this.deletingIds.delete(user.id);
    }
  }
}
