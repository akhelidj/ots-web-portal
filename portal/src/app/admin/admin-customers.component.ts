import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription, BehaviorSubject } from 'rxjs';
import { CustomerLocalRepo } from '../core/offline/customer-local.repo';
import { OutboxService } from '../core/offline/outbox.service';
import { LocalCustomer } from '../core/offline/types';
import { AdminCustomersService } from './admin-customers.service';

@Component({
  selector: 'app-admin-customers',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-customers.component.html',
})
export class AdminCustomersComponent implements OnInit, OnDestroy {
  private customerRepo = inject(CustomerLocalRepo);
  private outbox = inject(OutboxService);
  private adminCustomers = inject(AdminCustomersService);

  public customers$ = new BehaviorSubject<LocalCustomer[]>([]);
  private changesSub?: Subscription;

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
    
    // Initial fetch if online
    if (navigator.onLine) {
      this.refreshFromServer();
    }
  }

  ngOnDestroy() {
    this.changesSub?.unsubscribe();
  }

  private async reloadStream() {
    const data = await this.customerRepo.list();
    this.customers$.next(data);
  }
  
  public async refreshFromServer() {
    try {
      await this.adminCustomers.pullAllAndCache();
    } catch (e) {
      console.warn('Silent failure on background refresh', e);
    }
  }

  public async onSubmitCreate() {
    this.formError = '';
    
    if (!this.formName.trim()) {
      this.formError = 'Name is required';
      return;
    }

    const newCustomer: LocalCustomer = {
      id: 'local-' + crypto.randomUUID(),
      name: this.formName,
      code: this.formCode || null,
      email: this.formEmail || null,
      phone: this.formPhone || null,
      isActive: true,
      version: 1,
      syncState: 'PENDING',
    };

    try {
      await this.customerRepo.upsert(newCustomer);

      await this.outbox.enqueue({
        id: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        entityType: 'CUSTOMER',
        entityId: newCustomer.id,
        operation: 'CREATE',
        payload: {
          name: newCustomer.name,
          code: newCustomer.code,
          email: newCustomer.email,
          phone: newCustomer.phone,
          isActive: true
        },
        status: 'PENDING',
        attemptCount: 0,
        lastError: null,
      });

      this.formName = '';
      this.formCode = '';
      this.formEmail = '';
      this.formPhone = '';

      if (navigator.onLine) {
        await this.outbox.processQueue();
      }
    } catch (error) {
      const e = error as Error;
      this.formError = 'Failed to create customer locally: ' + e.message;
    }
  }

  public promptEdit(customer: LocalCustomer) {
    if (customer.syncState === 'CONFLICT') {
      alert('Cannot edit customer in CONFLICT state. Refresh from server to resolve.');
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
      syncState: 'PENDING'
    };

    try {
      await this.customerRepo.upsert(updated);

      await this.outbox.enqueue({
        id: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        entityType: 'CUSTOMER',
        entityId: updated.id,
        operation: 'UPDATE',
        payload: {
          name: updated.name,
          code: updated.code,
          email: updated.email,
          phone: updated.phone,
          version: updated.version
        },
        status: 'PENDING',
        attemptCount: 0,
        lastError: null,
      });

      this.editingCustomer = null;

      if (navigator.onLine) {
        await this.outbox.processQueue();
      }
    } catch (error) {
      const e = error as Error;
      this.editError = 'Failed to update customer: ' + e.message;
    }
  }

  public promptDeactivate(customer: LocalCustomer) {
    if (customer.syncState === 'CONFLICT') {
      alert('Cannot deactivate customer in CONFLICT state. Refresh from server to resolve.');
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

    await this.performToggle(this.selectedCustomer, false, this.deactivationReason);
    this.selectedCustomer = null;
  }

  public async onToggleActive(customer: LocalCustomer) {
    if (customer.syncState === 'CONFLICT') {
      alert('Cannot modify customer in CONFLICT state. Refresh from server to resolve.');
      return;
    }
    
    if (customer.isActive) {
      this.promptDeactivate(customer);
    } else {
      await this.performToggle(customer, true);
    }
  }

  private async performToggle(customer: LocalCustomer, isActive: boolean, reason?: string) {
    try {
      await this.customerRepo.setActive(customer.id, isActive, reason);

      await this.outbox.enqueue({
        id: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        entityType: 'CUSTOMER',
        entityId: customer.id,
        operation: 'SET_ACTIVE',
        payload: {
          isActive,
          reason,
          version: customer.version
        },
        status: 'PENDING',
        attemptCount: 0,
        lastError: null,
      });

      if (navigator.onLine) {
        await this.outbox.processQueue();
      }
    } catch (error) {
      console.error(error);
    }
  }
}
