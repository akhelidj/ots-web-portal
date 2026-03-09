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
import { ChildReportLocalRepo } from './child-report-local.repo';
import {
  LocalInspectionReport,
  LocalSerialNumber,
  LocalChildReport,
} from './types';
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
  private crRepo = inject(ChildReportLocalRepo);

  public async dispatch(item: OutboxItem): Promise<boolean> {
    const operationKey = `${item.entityType}:${item.operation}`;

    try {
      switch (operationKey) {
        case 'USER:CREATE': {
          const createRes = await firstValueFrom(
            this.http.post<LocalUser & { temporaryPassword?: string }>(
              `${environment.apiUrl}/users`,
              item.payload,
            ),
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
            if (
              pending.entityType === 'USER' &&
              pending.entityId === item.entityId
            ) {
              pending.entityId = createRes.id;
              await this.outboxRepo.upsert(pending);
            }
          }

          if (createRes.temporaryPassword) {
            this.adminUsers.notifyTempPassword(createRes.temporaryPassword);
          }

          // Refresh stream just in case
          await this.adminUsers.reloadStreamFromLocal();
          return true;
        }

        case 'USER:SET_ACTIVE': {
          const updateRes = await firstValueFrom(
            this.http.patch<LocalUser>(
              `${environment.apiUrl}/users/${item.entityId}/active`,
              {
                isActive: item.payload['isActive'] as boolean,
              },
            ),
          );

          // Overwrite local UI store with truth and clear syncState
          await this.userRepo.upsert({ ...updateRes, syncState: 'CLEAN' });
          await this.adminUsers.reloadStreamFromLocal();
          return true;
        }

        case 'USER:UPDATE_PROFILE': {
          const updateRes = await firstValueFrom(
            this.http.patch<LocalUser>(
              `${environment.apiUrl}/users/${item.entityId}`,
              {
                name: item.payload['name'],
                password: item.payload['password'], // Will be hashed by server
              },
            ),
          );

          await this.userRepo.upsert({ ...updateRes, syncState: 'CLEAN' });
          await this.adminUsers.reloadStreamFromLocal();
          return true;
        }

        case 'USER:DELETE': {
          await firstValueFrom(
            this.http.delete(`${environment.apiUrl}/users/${item.entityId}`),
          );
          // It's already optimistically deleted locally, but we can call it here just in case outbox runs from fresh sync
          await this.userRepo.delete(item.entityId);
          await this.adminUsers.reloadStreamFromLocal();
          return true;
        }

        case 'CUSTOMER:CREATE': {
          const createRes = await this.adminCustomers.createOnServer(
            item.payload,
          );

          const tempCustomer = await this.customerRepo.getById(item.entityId);
          if (tempCustomer) {
            await this.customerRepo.remapId(item.entityId, createRes);
          }

          const pendingItems = await this.outboxRepo.getPendingItems();
          for (const pending of pendingItems) {
            let changed = false;
            if (
              pending.entityType === 'CUSTOMER' &&
              pending.entityId === item.entityId
            ) {
              pending.entityId = createRes.id;
              changed = true;
            }
            if (
              pending.entityType === 'INSPECTION_REPORT' &&
              pending.payload['customerId'] === item.entityId
            ) {
              pending.payload['customerId'] = createRes.id;
              changed = true;
            }
            if (changed) {
              await this.outboxRepo.upsert(pending);
            }
          }

          await this.adminCustomers.pullAllAndCache();
          return true;
        }

        case 'CUSTOMER:UPDATE': {
          const updateRes = await this.adminCustomers.patchOnServer(
            item.entityId,
            item.payload,
          );
          await this.customerRepo.upsert({ ...updateRes, syncState: 'SYNCED' });
          await this.adminCustomers.pullAllAndCache();
          return true;
        }

        case 'CUSTOMER:SET_ACTIVE': {
          const activeRes = await this.adminCustomers.setActiveOnServer(
            item.entityId,
            item.payload['isActive'] as boolean,
            item.payload['version'] as number,
            item.payload['reason'] as string | undefined,
          );
          await this.customerRepo.upsert({ ...activeRes, syncState: 'SYNCED' });
          await this.adminCustomers.pullAllAndCache();
          return true;
        }

        case 'CUSTOMER:DELETE': {
          await firstValueFrom(
            this.http.delete(
              `${environment.apiUrl}/customers/${item.entityId}`,
            ),
          );
          await this.customerRepo.delete(item.entityId);
          await this.adminCustomers.pullAllAndCache();
          return true;
        }

        case 'INSPECTION_REPORT:CREATE': {
          const createRes = await firstValueFrom(
            this.http.post<LocalInspectionReport>(
              `${environment.apiUrl}/inspection-reports`,
              item.payload,
            ),
          );

          const tempReport = await this.irRepo.getById(item.entityId);
          if (tempReport) {
            await this.irRepo.remapId(item.entityId, {
              ...createRes,
              syncState: 'SYNCED',
            });
          }

          await this.snRepo.remapReportId(item.entityId, createRes.id);

          const pendingItems = await this.outboxRepo.getPendingItems();
          for (const pending of pendingItems) {
            let changed = false;
            if (
              pending.entityType === 'INSPECTION_REPORT' &&
              pending.entityId === item.entityId
            ) {
              pending.entityId = createRes.id;
              changed = true;
            }
            if (
              pending.entityType === 'SERIAL_NUMBER' &&
              pending.payload['inspectionReportId'] === item.entityId
            ) {
              pending.payload['inspectionReportId'] = createRes.id;
              if (pending.entityId === item.entityId) {
                pending.entityId = createRes.id;
              }
              changed = true;
            }
            if (changed) {
              await this.outboxRepo.upsert(pending);
            }
          }
          return true;
        }

        case 'INSPECTION_REPORT:UPDATE': {
          const updateRes = await firstValueFrom(
            this.http.patch<LocalInspectionReport>(
              `${environment.apiUrl}/inspection-reports/${item.entityId}`,
              item.payload,
            ),
          );
          await this.irRepo.upsert({ ...updateRes, syncState: 'SYNCED' });
          return true;
        }

        case 'INSPECTION_REPORT:TRANSITION': {
          const transitionRes = await firstValueFrom(
            this.http.post<LocalInspectionReport>(
              `${environment.apiUrl}/inspection-reports/${item.entityId}/transitions`,
              item.payload,
            ),
          );
          let rep = await this.irRepo.getById(item.entityId);
          if (rep) {
            await this.irRepo.upsert({
              ...rep,
              ...transitionRes,
              syncState: 'SYNCED',
              pendingTransitionToStatus: null,
            });
          }

          try {
            const availableRes = await firstValueFrom(
              this.http.get<{
                fromStatus: string;
                transitions: { toStatus: string; requiresReason: boolean }[];
              }>(
                `${environment.apiUrl}/inspection-reports/${item.entityId}/available-transitions`,
              ),
            );
            rep = await this.irRepo.getById(item.entityId);
            if (rep) {
              await this.irRepo.upsert({
                ...rep,
                availableTransitions: JSON.stringify(availableRes),
              });
            }
          } catch (err) {
            console.error(
              'Failed to update available transitions after sync',
              err,
            );
          }

          return true;
        }

        case 'SERIAL_NUMBER:BULK_CREATE': {
          const reportId = item.payload['inspectionReportId'] as string;
          const itemsPayload = item.payload['items'] as Record<
            string,
            unknown
          >[];

          if (!itemsPayload || itemsPayload.length === 0) return true;

          const createRes = await firstValueFrom(
            this.http.post<{
              items: {
                clientRef: string;
                id: string;
                serialNumber: string;
                version: number;
              }[];
            }>(
              `${environment.apiUrl}/inspection-reports/${reportId}/serial-numbers`,
              { items: itemsPayload },
            ),
          );

          // Remap each returned item by clientRef
          const returnedItems = createRes.items || [];
          for (const mapped of returnedItems) {
            const tempId = mapped.clientRef;
            const tempSn = await this.snRepo.getById(tempId);
            if (tempSn) {
              await this.snRepo.remapId(tempId, {
                ...tempSn,
                ...mapped,
                value: mapped.serialNumber,
                inspectionReportId: reportId,
                syncState: 'SYNCED',
              } as unknown as LocalSerialNumber);
            }

            // Remap any dependent outbox items waiting on this SN
            const pendingItems = await this.outboxRepo.getPendingItems();
            for (const pending of pendingItems) {
              if (
                pending.entityType === 'SERIAL_NUMBER' &&
                pending.entityId === tempId
              ) {
                pending.entityId = mapped.id;
                await this.outboxRepo.upsert(pending);
              }
            }
          }
          return true;
        }

        case 'SERIAL_NUMBER:UPDATE': {
          const backendPayload = {
            serialNumber: item.payload['value'] as string,
            version: item.payload['version'] as number,
          };

          const updateRes = await firstValueFrom(
            this.http.patch<{ serialNumber: string; [key: string]: unknown }>(
              `${environment.apiUrl}/serial-numbers/${item.entityId}`,
              backendPayload,
            ),
          );

          const mappedUpdate = {
            ...updateRes,
            value: updateRes.serialNumber,
          } as Partial<{ serialNumber: unknown }> & {
            value: string;
            [key: string]: unknown;
          };
          delete mappedUpdate.serialNumber;

          const existingSn = await this.snRepo.getById(item.entityId);
          await this.snRepo.upsert({
            ...existingSn,
            ...mappedUpdate,
            syncState: 'SYNCED',
          } as unknown as LocalSerialNumber);
          return true;
        }

        case 'SERIAL_NUMBER:SN_UPDATE_INSPECTION': {
          const backendPayload = {
            inspectionData: item.payload['inspectionData'],
            version: item.payload['version'] as number,
          };

          const updateRes = await firstValueFrom(
            this.http.patch<{ serialNumber: string; [key: string]: unknown }>(
              `${environment.apiUrl}/serial-numbers/${item.entityId}`,
              backendPayload,
            ),
          );

          const mappedUpdate = {
            ...updateRes,
            value: updateRes.serialNumber,
          } as Partial<{ serialNumber: unknown }> & {
            value: string;
            [key: string]: unknown;
          };
          delete mappedUpdate.serialNumber;

          const existingSn = await this.snRepo.getById(item.entityId);
          await this.snRepo.upsert({
            ...existingSn,
            ...mappedUpdate,
            syncState: 'SYNCED',
          } as unknown as LocalSerialNumber);
          return true;
        }

        case 'SERIAL_NUMBER:SN_DELETE': {
          await firstValueFrom(
            this.http.delete(
              `${environment.apiUrl}/serial-numbers/${item.entityId}`,
            ),
          );
          // Already deleted locally, so just return true
          return true;
        }

        case 'CHILD_REPORT:CREATE': {
          const createRes = await firstValueFrom(
            this.http.post<LocalChildReport>(
              `${environment.apiUrl}/child-reports`,
              item.payload,
            ),
          );

          const tempCr = await this.crRepo.getById(item.entityId);
          if (tempCr) {
            await this.crRepo.delete(item.entityId);
            await this.crRepo.upsert({ ...createRes, syncState: 'SYNCED' });
          }

          // Re-map pending downstream outbox events relying on the old temporary ID
          const pendingItems = await this.outboxRepo.getPendingItems();
          for (const pending of pendingItems) {
            if (
              pending.entityType === 'CHILD_REPORT' &&
              pending.entityId === item.entityId
            ) {
              pending.entityId = createRes.id;
              await this.outboxRepo.upsert(pending);
            }
          }
          return true;
        }

        case 'CHILD_REPORT:SYNC_REWORK': {
          const syncRes = await firstValueFrom(
            this.http.post<LocalChildReport | null>(
              `${environment.apiUrl}/inspection-reports/${item.entityId}/child-reports/sync-rework`,
              {}
            ),
          );
          if (syncRes) {
            await this.crRepo.upsert({ ...syncRes, syncState: 'SYNCED' });
          } else {
            const allLocal = await this.crRepo.listByReportId(item.entityId);
            const reworkCr = allLocal.find(cr => cr.type === 'REWORK');
            if (reworkCr) {
              await this.crRepo.delete(reworkCr.id);
            }
          }
          return true;
        }

        case 'CHILD_REPORT:SN_UPDATE_INSPECTION': {
          const updateRes = await firstValueFrom(
            this.http.patch<LocalChildReport>(
              `${environment.apiUrl}/child-reports/${item.entityId}/serial-numbers/${item.payload['serialNumberId']}`,
              {
                inspectionData: item.payload['inspectionData'],
                disposition: item.payload['disposition']
              }
            )
          );
          await this.crRepo.upsert({ ...updateRes, syncState: 'SYNCED' });
          return true;
        }

        case 'CHILD_REPORT:UPDATE': {
          const updateRes = await firstValueFrom(
            this.http.patch<LocalChildReport>(
              `${environment.apiUrl}/child-reports/${item.entityId}`,
              item.payload,
            ),
          );
          await this.crRepo.upsert({ ...updateRes, syncState: 'SYNCED' });
          return true;
        }

        case 'CHILD_REPORT:TRANSITION': {
          const transitionRes = await firstValueFrom(
            this.http.post<LocalChildReport>(
              `${environment.apiUrl}/child-reports/${item.entityId}/transition`,
              item.payload,
            ),
          );
          const rep = await this.crRepo.getById(item.entityId);
          if (rep) {
            await this.crRepo.upsert({
              ...rep,
              ...transitionRes,
              syncState: 'SYNCED',
            });
          }
          return true;
        }

        case 'System:ping':
          console.log(
            `[SyncDispatcher] Simulated success for ping idempotencyKey: ${item.idempotencyKey}`,
          );
          return true;

        default:
          console.error(
            `[SyncDispatcher] No dispatcher implemented yet for operation pattern: ${operationKey}`,
          );
          return false;
      }
    } catch (error) {
      if (error instanceof HttpErrorResponse) {
        if (error.status === 409) {
          if (item.entityType === 'INSPECTION_REPORT') {
            const rep = await this.irRepo.getById(item.entityId);
            if (rep)
              await this.irRepo.upsert({ ...rep, syncState: 'CONFLICT' });
          } else if (item.entityType === 'SERIAL_NUMBER') {
            const sn = await this.snRepo.getById(item.entityId);
            if (sn) await this.snRepo.upsert({ ...sn, syncState: 'CONFLICT' });
          } else if (item.entityType === 'CUSTOMER') {
            const cust = await this.customerRepo.getById(item.entityId);
            if (cust)
              await this.customerRepo.upsert({
                ...cust,
                syncState: 'CONFLICT',
              });
          } else if (item.entityType === 'CHILD_REPORT') {
            const cr = await this.crRepo.getById(item.entityId);
            if (cr) await this.crRepo.upsert({ ...cr, syncState: 'CONFLICT' });
          }

          const conflictErr = new Error(
            error.error?.message || 'Conflict processing entity',
          ) as Error & { status?: number };
          conflictErr.status = 409;
          throw conflictErr;
        } else if (error.status === 400 || error.status === 403) {
          if (item.entityType === 'INSPECTION_REPORT') {
            const rep = await this.irRepo.getById(item.entityId);
            if (rep) {
              // Do NOT delete from outbox. We leave it locally but mark it as ERROR
              // The outbox service will observe the Error being thrown
              await this.irRepo.upsert({
                ...rep,
                syncState: 'ERROR',
                pendingTransitionToStatus: null,
              });
            }
          } else if (item.entityType === 'SERIAL_NUMBER') {
            const sn = await this.snRepo.getById(item.entityId);
            if (sn) {
              // Clear pending local state on terminal failure
              await this.snRepo.upsert({ ...sn, syncState: 'ERROR' });
            }
          } else if (item.entityType === 'CHILD_REPORT') {
            const cr = await this.crRepo.getById(item.entityId);
            if (cr) {
              await this.crRepo.upsert({ ...cr, syncState: 'ERROR' });
            }
          }
          const appErr = new Error(
            error.error?.message || `Application logic error: ${error.status}`,
          ) as Error & { status?: number };
          appErr.status = error.status;
          // Throw it so Outbox marking logic catches it and saves error details mapping natively
          throw appErr;
        }
      }
      throw error;
    }
  }
}
