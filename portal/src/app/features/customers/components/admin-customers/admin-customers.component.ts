import {
  Component,
  OnInit,
  OnDestroy,
  inject,
  signal,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { CustomerLocalRepo } from '@portal/core/offline/repos/customer-local.repo';
import { LocalCustomer } from '@portal/core/offline/models/types';
import { AdminCustomersService } from '@portal/features/customers/services/admin-customers.service';
import { UserPreferencesService } from '@portal/core/services/user-preferences.service';

@Component({
  selector: 'app-admin-customers',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-customers.component.html',
})
export class AdminCustomersComponent implements OnInit, OnDestroy {
  private customerRepo = inject(CustomerLocalRepo);
  private adminCustomers = inject(AdminCustomersService);

  public customers = signal<LocalCustomer[]>([]);
  public prefs = inject(UserPreferencesService);
  public isCompactMode = computed(() => this.prefs.preferences().compactMode);
  private changesSub?: Subscription;

  public deletingIds = new Set<string>();

  // Create Form
  public formName = '';
  public formCode = '';
  public formEmail = '';
  public formPhone = '';
  public formError = '';

  // Edit Form
  public editingCustomer: LocalCustomer | null = null;
  public editName = '';
  public editCode = '';
  public editEmail = '';
  public editPhone = '';
  public editError = '';

  // Deactivate Form
  public selectedCustomer: LocalCustomer | null = null;
  public deactivationReason = '';
  public deactivationError = '';

  ngOnInit() {
    this.reloadStream();
    this.changesSub = this.customerRepo.changes$.subscribe(() => {
      this.reloadStream();
    });
  }

  ngOnDestroy() {
    this.changesSub?.unsubscribe();
  }

  private async reloadStream() {
    const data = await this.customerRepo.list();
    this.customers.set(data);
  }

  public async onSubmitCreate() {
    this.formError = '';

    if (!this.formName.trim()) {
      this.formError = 'Name is required';
      return;
    }

    try {
      await this.adminCustomers.createCustomer({
        name: this.formName,
        code: this.formCode || null,
        email: this.formEmail || null,
        phone: this.formPhone || null,
      });

      this.formName = '';
      this.formCode = '';
      this.formEmail = '';
      this.formPhone = '';
    } catch (error) {
      const e = error as Error;
      this.formError = 'Failed to create customer locally: ' + e.message;
    }
  }

  public promptEdit(customer: LocalCustomer) {
    if (customer.syncState === 'CONFLICT') {
      alert(
        'Cannot edit customer in CONFLICT state. Refresh from server to resolve.',
      );
      return;
    }
    this.editingCustomer = customer;
    this.editName = customer.name;
    this.editCode = customer.code || '';
    this.editEmail = customer.email || '';
    this.editPhone = customer.phone || '';
    this.editError = '';
  }

  public cancelEdit() {
    this.editingCustomer = null;
  }

  public async confirmEdit() {
    if (!this.editingCustomer) return;

    if (!this.editName.trim()) {
      this.editError = 'Name is required';
      return;
    }

    const updated: LocalCustomer = {
      ...this.editingCustomer,
      name: this.editName,
      code: this.editCode || null,
      email: this.editEmail || null,
      phone: this.editPhone || null,
      syncState: 'PENDING',
    };

    try {
      await this.adminCustomers.updateCustomer(this.editingCustomer, {
        name: updated.name,
        code: updated.code || null,
        email: updated.email || null,
        phone: updated.phone || null,
      });

      this.editingCustomer = null;
    } catch (error) {
      const e = error as Error;
      this.editError = 'Failed to update customer: ' + e.message;
    }
  }

  public promptDeactivate(customer: LocalCustomer) {
    if (customer.syncState === 'CONFLICT') {
      alert(
        'Cannot deactivate customer in CONFLICT state. Refresh from server to resolve.',
      );
      return;
    }
    this.selectedCustomer = customer;
    this.deactivationReason = '';
    this.deactivationError = '';
  }

  public cancelDeactivate() {
    this.selectedCustomer = null;
  }

  public async confirmDeactivate() {
    if (!this.selectedCustomer) return;

    if (!this.deactivationReason.trim()) {
      this.deactivationError = 'Reason is mandatory for deactivation';
      return;
    }

    await this.performToggle(
      this.selectedCustomer,
      false,
      this.deactivationReason,
    );
    this.selectedCustomer = null;
  }

  public async onToggleActive(customer: LocalCustomer) {
    if (customer.syncState === 'CONFLICT') {
      alert(
        'Cannot modify customer in CONFLICT state. Refresh from server to resolve.',
      );
      return;
    }

    if (customer.isActive) {
      this.promptDeactivate(customer);
    } else {
      await this.performToggle(customer, true);
    }
  }

  private async performToggle(
    customer: LocalCustomer,
    isActive: boolean,
    reason?: string,
  ) {
    try {
      await this.adminCustomers.setCustomerActive(customer, isActive, reason);
    } catch (error) {
      console.error(error);
    }
  }

  public async onDelete(customer: LocalCustomer) {
    if (this.deletingIds.has(customer.id)) return;

    this.deletingIds.add(customer.id);

    try {
      await this.adminCustomers.deleteCustomer(customer);
      await this.reloadStream();
    } catch (error) {
      console.error(error);
      this.formError = 'Failed to delete customer.';
    } finally {
      this.deletingIds.delete(customer.id);
    }
  }
}
