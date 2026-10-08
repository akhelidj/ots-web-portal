import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { CustomerLocalRepo } from '@portal/core/offline/repos/customer-local.repo';
import { LocalCustomer } from '@portal/core/offline/models/types';
import { environment } from '@app-env/environment';
import { ConnectivityService } from '@portal/core/offline/services/connectivity.service';
import { staleSyncedIds } from '@portal/core/offline/services/stale-synced';
import { OutboxService } from '@portal/core/offline/services/outbox.service';
import { APP_ROLES, ENTITY_TYPES } from '@portal/core/constants/app.constants';
import {
  DataHydrationContext,
  DataHydrationSource,
} from '@portal/core/offline/services/data-hydration.token';

@Injectable({
  providedIn: 'root',
})
export class AdminCustomersService implements DataHydrationSource {
  private http = inject(HttpClient);
  private localRepo = inject(CustomerLocalRepo);
  private connectivity = inject(ConnectivityService);
  private outbox = inject(OutboxService);
  public readonly resourceKey = 'admin-customers';

  public canHydrate(context: DataHydrationContext): boolean {
    // SUPERVISOR, INSPECTOR and RECEIVER only read the list (customer picker / names).
    return (
      context.profile?.role === APP_ROLES.ADMIN ||
      context.profile?.role === APP_ROLES.SUPERVISOR ||
      context.profile?.role === APP_ROLES.INSPECTOR ||
      context.profile?.role === APP_ROLES.RECEIVER
    );
  }

  async pullAllAndCache(): Promise<void> {
    if (!this.connectivity.isOnline()) {
      return;
    }

    try {
      const customers = await firstValueFrom(
        this.http.get<LocalCustomer[]>(`${environment.apiUrl}/customers`),
      );
      this.connectivity.markApiReachable();
      const localList = await this.localRepo.list();
      const localMap = new Map(localList.map((c) => [c.id, c]));

      const toUpsert: LocalCustomer[] = [];
      for (const c of customers) {
        const local = localMap.get(c.id);
        if (!local || local.syncState === 'SYNCED') {
          toUpsert.push({ ...c, syncState: 'SYNCED' });
        }
      }

      if (toUpsert.length > 0) {
        await this.localRepo.bulkUpsert(toUpsert);
      }

      // The server's list is the truth: drop synced customers it no longer has.
      for (const id of staleSyncedIds(
        localList,
        customers.map((c) => c.id),
      )) {
        await this.localRepo.delete(id);
      }
    } catch (error) {
      if (this.isOfflineError(error)) {
        this.connectivity.markApiUnreachable();
        return;
      }

      throw error;
    }
  }

  async createOnServer(dto: Partial<LocalCustomer>): Promise<LocalCustomer> {
    return firstValueFrom(
      this.http.post<LocalCustomer>(`${environment.apiUrl}/customers`, dto),
    );
  }

  async patchOnServer(
    id: string,
    dto: Partial<LocalCustomer>,
  ): Promise<LocalCustomer> {
    return firstValueFrom(
      this.http.patch<LocalCustomer>(
        `${environment.apiUrl}/customers/${id}`,
        dto,
      ),
    );
  }

  async setActiveOnServer(
    id: string,
    isActive: boolean,
    version: number,
    reason?: string,
  ): Promise<LocalCustomer> {
    return firstValueFrom(
      this.http.patch<LocalCustomer>(
        `${environment.apiUrl}/customers/${id}/active`,
        { isActive, version, reason },
      ),
    );
  }

  async createCustomer(input: {
    name: string;
    code: string | null;
    email: string | null;
    phone: string | null;
  }): Promise<void> {
    if (this.connectivity.isOnline()) {
      try {
        const createdCustomer = await this.createOnServer({
          name: input.name,
          code: input.code,
          email: input.email,
          phone: input.phone,
          isActive: true,
        });

        this.connectivity.markApiReachable();
        await this.localRepo.upsert({
          ...createdCustomer,
          syncState: 'SYNCED',
        });
        return;
      } catch (error) {
        if (!this.isOfflineError(error)) {
          throw error;
        }

        this.connectivity.markApiUnreachable();
      }
    }

    const newCustomer: LocalCustomer = {
      id: 'local-' + crypto.randomUUID(),
      name: input.name,
      code: input.code,
      email: input.email,
      phone: input.phone,
      isActive: true,
      version: 1,
      syncState: 'PENDING',
    };

    await this.localRepo.upsert(newCustomer);
    await this.outbox.enqueue({
      id: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      entityType: ENTITY_TYPES.CUSTOMER,
      entityId: newCustomer.id,
      operation: 'CREATE',
      payload: {
        name: newCustomer.name,
        code: newCustomer.code,
        email: newCustomer.email,
        phone: newCustomer.phone,
        isActive: true,
      },
      status: 'PENDING',
      attemptCount: 0,
      lastError: null,
    });
  }

  async updateCustomer(
    customer: LocalCustomer,
    changes: {
      name: string;
      code: string | null;
      email: string | null;
      phone: string | null;
    },
  ): Promise<void> {
    if (this.connectivity.isOnline() && !customer.id.startsWith('local-')) {
      try {
        const updatedCustomer = await this.patchOnServer(customer.id, {
          name: changes.name,
          code: changes.code,
          email: changes.email,
          phone: changes.phone,
          version: customer.version,
        });

        this.connectivity.markApiReachable();
        await this.localRepo.upsert({
          ...updatedCustomer,
          syncState: 'SYNCED',
        });
        return;
      } catch (error) {
        if (!this.isOfflineError(error)) {
          throw error;
        }

        this.connectivity.markApiUnreachable();
      }
    }

    await this.localRepo.upsert({
      ...customer,
      name: changes.name,
      code: changes.code,
      email: changes.email,
      phone: changes.phone,
      syncState: 'PENDING',
    });

    await this.outbox.enqueue({
      id: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      entityType: ENTITY_TYPES.CUSTOMER,
      entityId: customer.id,
      operation: 'UPDATE',
      payload: {
        name: changes.name,
        code: changes.code,
        email: changes.email,
        phone: changes.phone,
        version: customer.version,
      },
      status: 'PENDING',
      attemptCount: 0,
      lastError: null,
    });
  }

  async setCustomerActive(
    customer: LocalCustomer,
    isActive: boolean,
    reason?: string,
  ): Promise<void> {
    if (this.connectivity.isOnline() && !customer.id.startsWith('local-')) {
      try {
        const updatedCustomer = await this.setActiveOnServer(
          customer.id,
          isActive,
          customer.version,
          reason,
        );

        this.connectivity.markApiReachable();
        await this.localRepo.upsert({
          ...updatedCustomer,
          syncState: 'SYNCED',
        });
        return;
      } catch (error) {
        if (!this.isOfflineError(error)) {
          throw error;
        }

        this.connectivity.markApiUnreachable();
      }
    }

    await this.localRepo.setActive(customer.id, isActive, reason);
    await this.outbox.enqueue({
      id: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      entityType: ENTITY_TYPES.CUSTOMER,
      entityId: customer.id,
      operation: 'SET_ACTIVE',
      payload: {
        isActive,
        reason,
        version: customer.version,
      },
      status: 'PENDING',
      attemptCount: 0,
      lastError: null,
    });
  }

  async deleteCustomer(customer: LocalCustomer): Promise<void> {
    if (this.connectivity.isOnline() && !customer.id.startsWith('local-')) {
      try {
        await firstValueFrom(
          this.http.delete(`${environment.apiUrl}/customers/${customer.id}`),
        );
        this.connectivity.markApiReachable();
        await this.localRepo.delete(customer.id);
        return;
      } catch (error) {
        if (!this.isOfflineError(error)) {
          throw error;
        }

        this.connectivity.markApiUnreachable();
      }
    }

    await this.outbox.enqueue({
      id: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      entityType: ENTITY_TYPES.CUSTOMER,
      entityId: customer.id,
      operation: 'DELETE',
      payload: {},
      status: 'PENDING',
      attemptCount: 0,
      lastError: null,
    });

    await this.localRepo.delete(customer.id);
  }

  // ---- Branding (online-only, like signatures: no outbox) ----

  /** Set (`#rrggbb`) or clear (null) the brand colour. */
  async setBrandColor(customer: LocalCustomer, brandColor: string | null): Promise<LocalCustomer> {
    const updated = await this.patchOnServer(customer.id, {
      brandColor,
      version: customer.version,
    });
    await this.localRepo.upsert({ ...updated, syncState: 'SYNCED' });
    return updated;
  }

  async uploadLogo(customer: LocalCustomer, file: File): Promise<LocalCustomer> {
    const body = new FormData();
    body.append('file', file);
    body.append('version', String(customer.version));
    const updated = await firstValueFrom(
      this.http.put<LocalCustomer>(`${environment.apiUrl}/customers/${customer.id}/logo`, body),
    );
    await this.localRepo.upsert({ ...updated, syncState: 'SYNCED' });
    return updated;
  }

  async removeLogo(customer: LocalCustomer): Promise<LocalCustomer> {
    const updated = await firstValueFrom(
      this.http.delete<LocalCustomer>(`${environment.apiUrl}/customers/${customer.id}/logo`, {
        params: { version: customer.version },
      }),
    );
    await this.localRepo.upsert({ ...updated, syncState: 'SYNCED' });
    return updated;
  }

  /** Object URL of the customer's current logo (caller revokes it). */
  async fetchLogoUrl(customer: LocalCustomer): Promise<string> {
    const blob = await firstValueFrom(
      this.http.get(`${environment.apiUrl}/customers/${customer.id}/logo`, {
        responseType: 'blob',
      }),
    );
    return URL.createObjectURL(blob);
  }

  private isOfflineError(error: unknown): boolean {
    return error instanceof HttpErrorResponse && error.status === 0;
  }
}
