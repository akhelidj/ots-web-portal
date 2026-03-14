import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { signal } from '@angular/core';
import { UserLocalRepo } from '@portal/core/offline/repos/user-local.repo';
import { ConnectivityService } from '@portal/core/offline/services/connectivity.service';
import { LocalUser } from '@portal/core/offline/models/types';
import { environment } from '@app-env/environment';
import { OutboxService } from '@portal/core/offline/services/outbox.service';
import { APP_ROLES, ENTITY_TYPES } from '@portal/core/constants/app.constants';
import {
  DataHydrationContext,
  DataHydrationSource,
} from '@portal/core/offline/services/data-hydration.token';

@Injectable({
  providedIn: 'root',
})
export class AdminUsersService implements DataHydrationSource {
  private repo = inject(UserLocalRepo);
  private http = inject(HttpClient);
  private connectivity = inject(ConnectivityService);
  private outbox = inject(OutboxService);

  public readonly users = signal<LocalUser[]>([]);
  public readonly tempPasswordNotified = signal<string | null>(null);
  public readonly resourceKey = 'admin-users';

  public notifyTempPassword(password: string): void {
    this.tempPasswordNotified.set(password);
  }

  public canHydrate(context: DataHydrationContext): boolean {
    return context.profile?.role === APP_ROLES.ADMIN;
  }

  constructor() {
    this.refreshLocalCache();
  }

  public async refreshLocalCache(): Promise<void> {
    const localData = await this.repo.list();
    this.users.set(localData);
  }

  public async pullAllAndCache(): Promise<void> {
    if (!this.connectivity.isOnline()) {
      await this.reloadStreamFromLocal();
      return;
    }

    try {
      const serverUsers = await firstValueFrom(
        this.http.get<LocalUser[]>(`${environment.apiUrl}/users`),
      );
      this.connectivity.markApiReachable();
      await this.repo.bulkUpsert(serverUsers);
      const refreshedData = await this.repo.list();
      this.users.set(refreshedData);
    } catch (err) {
      if (this.isOfflineError(err)) {
        this.connectivity.markApiUnreachable();
        await this.reloadStreamFromLocal();
        return;
      }

      console.error('Failed to pull users for cache', err);
      throw err;
    }
  }

  public async reloadStreamFromLocal(): Promise<void> {
    const data = await this.repo.list();
    this.users.set(data);
  }

  public async createUser(input: {
    email: string;
    name: string | null;
    role: LocalUser['role'];
    customerId: string | null;
    password: string;
  }): Promise<void> {
    if (this.connectivity.isOnline()) {
      try {
        const createdUser = await firstValueFrom(
          this.http.post<LocalUser & { temporaryPassword?: string }>(
            `${environment.apiUrl}/users`,
            {
              email: input.email,
              name: input.name,
              role: input.role,
              isActive: true,
              customerId:
                input.role === APP_ROLES.CUSTOMER ? input.customerId : null,
              password: input.password,
            },
          ),
        );

        this.connectivity.markApiReachable();
        await this.repo.upsert({ ...createdUser, syncState: 'CLEAN' });
        if (createdUser.temporaryPassword) {
          this.notifyTempPassword(createdUser.temporaryPassword);
        }
        await this.reloadStreamFromLocal();
        return;
      } catch (error) {
        if (!this.isOfflineError(error)) {
          throw error;
        }

        this.connectivity.markApiUnreachable();
      }
    }

    const tempId = 'local-' + crypto.randomUUID();
    const offlineUser: LocalUser = {
      id: tempId,
      tenantId: 'local-temp',
      email: input.email,
      name: input.name,
      role: input.role,
      isActive: true,
      mustChangePassword: true,
      updatedAt: new Date().toISOString(),
      customerId: input.role === APP_ROLES.CUSTOMER ? input.customerId : null,
      syncState: 'PENDING_CREATE',
    };

    await this.repo.upsert(offlineUser);
    await this.outbox.enqueue({
      id: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      entityType: ENTITY_TYPES.USER,
      entityId: tempId,
      operation: 'CREATE',
      payload: {
        email: offlineUser.email,
        name: offlineUser.name,
        role: offlineUser.role,
        isActive: true,
        customerId: offlineUser.customerId,
        password: input.password,
      },
      status: 'PENDING',
      attemptCount: 0,
      lastError: null,
    });

    await this.reloadStreamFromLocal();
  }

  public async toggleActive(user: LocalUser): Promise<void> {
    const isActive = !user.isActive;

    if (this.connectivity.isOnline()) {
      try {
        const updatedUser = await firstValueFrom(
          this.http.patch<LocalUser>(
            `${environment.apiUrl}/users/${user.id}/active`,
            {
              isActive,
            },
          ),
        );

        this.connectivity.markApiReachable();
        await this.repo.upsert({ ...updatedUser, syncState: 'CLEAN' });
        await this.reloadStreamFromLocal();
        return;
      } catch (error) {
        if (!this.isOfflineError(error)) {
          throw error;
        }

        this.connectivity.markApiUnreachable();
      }
    }

    await this.repo.upsert({
      ...user,
      isActive,
      syncState: 'PENDING_UPDATE',
    });

    await this.outbox.enqueue({
      id: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      entityType: ENTITY_TYPES.USER,
      entityId: user.id,
      operation: 'SET_ACTIVE',
      payload: { isActive },
      status: 'PENDING',
      attemptCount: 0,
      lastError: null,
    });

    await this.reloadStreamFromLocal();
  }

  public async updateProfile(
    userId: string,
    changes: { name: string | null; password?: string },
  ): Promise<void> {
    const user = await this.repo.getById(userId);
    if (!user) {
      throw new Error('User not found.');
    }

    const payload: Record<string, string | null> = {
      name: changes.name,
    };
    if (changes.password) {
      payload['password'] = changes.password;
    }

    if (this.connectivity.isOnline()) {
      try {
        const updatedUser = await firstValueFrom(
          this.http.patch<LocalUser>(
            `${environment.apiUrl}/users/${userId}`,
            payload,
          ),
        );

        this.connectivity.markApiReachable();
        await this.repo.upsert({ ...updatedUser, syncState: 'CLEAN' });
        await this.reloadStreamFromLocal();
        return;
      } catch (error) {
        if (!this.isOfflineError(error)) {
          throw error;
        }

        this.connectivity.markApiUnreachable();
      }
    }

    await this.repo.upsert({
      ...user,
      name: changes.name,
      syncState: 'PENDING_UPDATE',
    });

    await this.outbox.enqueue({
      id: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      entityType: ENTITY_TYPES.USER,
      entityId: userId,
      operation: 'UPDATE_PROFILE',
      payload,
      status: 'PENDING',
      attemptCount: 0,
      lastError: null,
    });

    await this.reloadStreamFromLocal();
  }

  public async deleteUser(user: LocalUser): Promise<void> {
    if (this.connectivity.isOnline() && !user.id.startsWith('local-')) {
      try {
        await firstValueFrom(
          this.http.delete(`${environment.apiUrl}/users/${user.id}`),
        );
        this.connectivity.markApiReachable();
        await this.repo.delete(user.id);
        await this.reloadStreamFromLocal();
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
      entityType: ENTITY_TYPES.USER,
      entityId: user.id,
      operation: 'DELETE',
      payload: {},
      status: 'PENDING',
      attemptCount: 0,
      lastError: null,
    });

    await this.repo.delete(user.id);
    await this.reloadStreamFromLocal();
  }

  private isOfflineError(error: unknown): boolean {
    return error instanceof HttpErrorResponse && error.status === 0;
  }
}
