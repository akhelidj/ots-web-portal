import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { UserLocalRepo } from '../core/offline/user-local.repo';
import { ConnectivityService } from '../core/offline/connectivity.service';
import { LocalUser } from '../core/offline/types';

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

  /**
   * Reads from the local DB to drive the UI.
   * If online, it fetches from the API to warm the cache, then pushes again.
   */
  public async refreshLocalCache(): Promise<void> {
    // 1. Immediately read local store for fast offline-first UI render
    const localData = await this.repo.list();
    this.usersSubject.next(localData);

    // 2. Warmed cache check: if online, fetch latest from server
    if (this.connectivity.isOnline()) {
       this.http.get<LocalUser[]>('/api/users').subscribe({
         next: async (serverUsers) => {
           await this.repo.bulkUpsert(serverUsers);
           // 3. Re-read from local store so UI is strictly driven by the local persistence layer
           const refreshedData = await this.repo.list();
           this.usersSubject.next(refreshedData);
         },
         error: (err) => console.error('Failed to sync users for cache', err),
       });
    }
  }

  // Used by components to eagerly refresh the stream without hitting the backend (e.g., after an outbox write)
  public async reloadStreamFromLocal(): Promise<void> {
    const data = await this.repo.list();
    this.usersSubject.next(data);
  }
}
