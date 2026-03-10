import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, firstValueFrom } from 'rxjs';
import { UserLocalRepo } from '@portal/core/offline/user-local.repo';
import { ConnectivityService } from '@portal/core/offline/connectivity.service';
import { LocalUser } from '@portal/core/offline/types';
import { environment } from '@app-env/environment';

@Injectable({
  providedIn: 'root',
})
export class AdminUsersService {
  private repo = inject(UserLocalRepo);
  private http = inject(HttpClient);
  private connectivity = inject(ConnectivityService);

  private usersSubject = new BehaviorSubject<LocalUser[]>([]);
  public readonly users$: Observable<LocalUser[]> = this.usersSubject.asObservable();

  private tempPasswordSubject = new BehaviorSubject<string | null>(null);
  public readonly tempPasswordNotified$: Observable<string | null> = this.tempPasswordSubject.asObservable();

  public notifyTempPassword(password: string): void {
    this.tempPasswordSubject.next(password);
  }

  constructor() {
    this.refreshLocalCache();
  }

  // Legacy direct access for components that need quick refresh
  public async refreshLocalCache(): Promise<void> {
    const localData = await this.repo.list();
    this.usersSubject.next(localData);
  }

  // Centralized pull from server logic
  public async pullAllAndCache(): Promise<void> {
    if (!this.connectivity.isOnline()) return;
    
    try {
      const serverUsers = await firstValueFrom(this.http.get<LocalUser[]>(`${environment.apiUrl}/users`));
      await this.repo.bulkUpsert(serverUsers);
      const refreshedData = await this.repo.list();
      this.usersSubject.next(refreshedData);
    } catch (err) {
      console.error('Failed to pull users for cache', err);
      throw err;
    }
  }

  // Used by components to eagerly refresh the stream without hitting the backend (e.g., after an outbox write)
  public async reloadStreamFromLocal(): Promise<void> {
    const data = await this.repo.list();
    this.usersSubject.next(data);
  }
}
