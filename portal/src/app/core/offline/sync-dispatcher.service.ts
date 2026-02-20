import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { OutboxItem, LocalUser } from './types';
import { UserLocalRepo } from './user-local.repo';
import { OutboxLocalRepo } from './outbox-local.repo';
import { AdminUsersService } from '../../admin/admin-users.service';
import { AdminCustomersService } from '../../admin/admin-customers.service';
import { CustomerLocalRepo } from './customer-local.repo';
import { InspectionReportLocalRepo } from './inspection-report-local.repo';
import { SerialNumberLocalRepo } from './serial-number-local.repo';
import { LocalInspectionReport, LocalSerialNumber } from './types';
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
  private irRepo = inject(InspectionReportLocalRepo);
  private snRepo = inject(SerialNumberLocalRepo);

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

        case 'IR_CREATE': {
          const createRes = await firstValueFrom(
            this.http.post<LocalInspectionReport>(`${environment.apiUrl}/inspection-reports`, item.payload)
          );

          const tempReport = await this.irRepo.getById(item.entityId);
          if (tempReport) {
            await this.irRepo.remapId(item.entityId, { ...createRes, syncState: 'SYNCED' });
          }

          await this.snRepo.remapReportId(item.entityId, createRes.id);

          const pendingItems = await this.outboxRepo.getPendingItems();
          for (const pending of pendingItems) {
            let changed = false;
            if (pending.entityType === 'INSPECTION_REPORT' && pending.entityId === item.entityId) {
              pending.entityId = createRes.id;
              changed = true;
            }
            if (pending.entityType === 'SERIAL_NUMBER' && pending.payload.inspectionReportId === item.entityId) {
              pending.payload.inspectionReportId = createRes.id;
              changed = true;
            }
            if (changed) {
              await this.outboxRepo.upsert(pending);
            }
          }
          return true;
        }

        case 'IR_UPDATE': {
          const updateRes = await firstValueFrom(
            this.http.patch<LocalInspectionReport>(`${environment.apiUrl}/inspection-reports/${item.entityId}`, item.payload)
          );
          await this.irRepo.upsert({ ...updateRes, syncState: 'SYNCED' });
          return true;
        }

        case 'IR_TRANSITION': {
          const transitionRes = await firstValueFrom(
            this.http.post<LocalInspectionReport>(`${environment.apiUrl}/inspection-reports/${item.entityId}/transition`, item.payload)
          );
          await this.irRepo.upsert({ ...transitionRes, syncState: 'SYNCED' });
          return true;
        }

        case 'SN_ADD': {
          const reportId = item.payload.inspectionReportId;
          const { value, ...restPayload } = item.payload;
          const createRes: any = await firstValueFrom(
            this.http.post<any>(`${environment.apiUrl}/inspection-reports/${reportId}/serial-numbers`, {
              ...restPayload,
              serial: value
            })
          );
          createRes.value = createRes.serial;
          delete createRes.serial;

          const tempSn = await this.snRepo.getById(item.entityId);
          if (tempSn) {
            await this.snRepo.remapId(item.entityId, { ...createRes, syncState: 'SYNCED', inspectionReportId: reportId });
          }

          const pendingItems = await this.outboxRepo.getPendingItems();
          for (const pending of pendingItems) {
            if (pending.entityType === 'SERIAL_NUMBER' && pending.entityId === item.entityId) {
              pending.entityId = createRes.id;
              await this.outboxRepo.upsert(pending);
            }
          }
          return true;
        }

        case 'SN_UPDATE': {
          const { value, ...backendPayload } = item.payload;
          if (value !== undefined) {
            backendPayload.serial = value;
          }
          const updateRes: any = await firstValueFrom(
            this.http.patch<any>(`${environment.apiUrl}/serial-numbers/${item.entityId}`, backendPayload)
          );
          updateRes.value = updateRes.serial;
          delete updateRes.serial;
          
          await this.snRepo.upsert({ ...updateRes, syncState: 'SYNCED' });
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
       if (error instanceof HttpErrorResponse && error.status === 409) {
          if (item.entityType === 'INSPECTION_REPORT') {
            const rep = await this.irRepo.getById(item.entityId);
            if (rep) await this.irRepo.upsert({ ...rep, syncState: 'CONFLICT' });
          } else if (item.entityType === 'SERIAL_NUMBER') {
            const sn = await this.snRepo.getById(item.entityId);
            if (sn) await this.snRepo.upsert({ ...sn, syncState: 'CONFLICT' });
          } else if (item.entityType === 'CUSTOMER') {
            const cust = await this.customerRepo.getById(item.entityId);
            if (cust) await this.customerRepo.upsert({ ...cust, syncState: 'CONFLICT' });
          }

          const conflictErr = new Error(error.error?.message || 'Conflict processing entity');
          (conflictErr as any).status = 409;
          throw conflictErr;
       }
       throw error;
    }
  }
}
