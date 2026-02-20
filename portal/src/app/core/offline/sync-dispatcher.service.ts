import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { OutboxItem, LocalUser } from './types';
import { UserLocalRepo } from './user-local.repo';
import { OutboxLocalRepo } from './outbox-local.repo';
import { AdminUsersService } from '../../admin/admin-users.service';
import { AdminCustomersService } from '../../admin/admin-customers.service';
import { CustomerLocalRepo } from './customer-local.repo';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class SyncDispatcherService {
  private http = inject(HttpClient);
  private userRepo = inject(UserLocalRepo);
  private outboxRepo = inject(OutboxLocalRepo);
  private adminUsers = inject(AdminUsersService);
  private customerRepo = inject(CustomerLocalRepo);
  private adminCustomers = inject(AdminCustomersService);

  public async dispatch(item: OutboxItem): Promise<boolean> {
    const operationKey = `${item.entityType}:${item.operation}`;

    try {
      switch (operationKey) {
        case 'USER:CREATE': {
          const createRes = await firstValueFrom(
            this.http.post<LocalUser & { tempPassword?: string }>(`${environment.apiUrl}/users`, item.payload)
          );

          // Atomic temporal ID remap
          const tempUser = await this.userRepo.getById(item.entityId);
          if (tempUser) {
            await this.userRepo.upsert({ ...createRes, syncState: 'CLEAN' });
            await this.userRepo.delete(item.entityId);
          }

          // Remap any pending outbox dependencies to the new server UUID
          const pendingItems = await this.outboxRepo.getPendingItems();
          for (const pending of pendingItems) {
            if (pending.entityType === 'USER' && pending.entityId === item.entityId) {
              pending.entityId = createRes.id;
              await this.outboxRepo.upsert(pending);
            }
          }

          if (createRes.tempPassword) {
            this.adminUsers.notifyTempPassword(createRes.tempPassword);
          }

          // Refresh stream just in case
          await this.adminUsers.reloadStreamFromLocal();
          return true;
        }

        case 'USER:SET_ACTIVE': {
          const updateRes = await firstValueFrom(
            this.http.patch<LocalUser>(`${environment.apiUrl}/users/${item.entityId}/active`, {
              isActive: item.payload.isActive,
            })
          );

          // Overwrite local UI store with truth and clear syncState
          await this.userRepo.upsert({ ...updateRes, syncState: 'CLEAN' });
          await this.adminUsers.reloadStreamFromLocal();
          return true;
        }

        case 'CUSTOMER_CREATE': {
          const createRes = await this.adminCustomers.createOnServer(item.payload);

          const tempCustomer = await this.customerRepo.getById(item.entityId);
          if (tempCustomer) {
            await this.customerRepo.remapId(item.entityId, createRes);
          }

          const pendingItems = await this.outboxRepo.getPendingItems();
          for (const pending of pendingItems) {
            if (pending.entityType === 'CUSTOMER' && pending.entityId === item.entityId) {
              pending.entityId = createRes.id;
              await this.outboxRepo.upsert(pending);
            }
          }

          await this.adminCustomers.pullAllAndCache();
          return true;
        }

        case 'CUSTOMER_UPDATE': {
          const updateRes = await this.adminCustomers.patchOnServer(item.entityId, item.payload);
          await this.customerRepo.upsert({ ...updateRes, syncState: 'SYNCED' });
          await this.adminCustomers.pullAllAndCache();
          return true;
        }

        case 'CUSTOMER_SET_ACTIVE': {
          const activeRes = await this.adminCustomers.setActiveOnServer(
            item.entityId, 
            item.payload.isActive, 
            item.payload.version, 
            item.payload.reason
          );
          await this.customerRepo.upsert({ ...activeRes, syncState: 'SYNCED' });
          await this.adminCustomers.pullAllAndCache();
          return true;
        }

        case 'System:ping':
          console.log(`[SyncDispatcher] Simulated success for ping idempotencyKey: ${item.idempotencyKey}`);
          return true;

        default:
          console.error(`[SyncDispatcher] No dispatcher implemented yet for operation pattern: ${operationKey}`);
          return false;
      }
    } catch (error) {
       if (error instanceof HttpErrorResponse) {
         if (error.status === 409) {
            const conflictErr = new Error(error.error?.message || 'Conflict processing entity');
            (conflictErr as any).status = 409;
            throw conflictErr;
         }
       }
       throw error;
    }
  }
}
