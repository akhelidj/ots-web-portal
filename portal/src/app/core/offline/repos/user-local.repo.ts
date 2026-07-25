import { Injectable, inject } from '@angular/core';
import { DbService } from '@portal/core/offline/services/db.service';
import { LocalUser } from '@portal/core/offline/models/types';

@Injectable({
  providedIn: 'root',
})
export class UserLocalRepo {
  private dbService = inject(DbService);
  private readonly STORE_NAME = 'users';

  public async getById(id: string): Promise<LocalUser | undefined> {
    const db = await this.dbService.getDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.STORE_NAME, 'readonly');
      const store = transaction.objectStore(this.STORE_NAME);
      const request = store.get(id);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  public async list(): Promise<LocalUser[]> {
    const db = await this.dbService.getDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.STORE_NAME, 'readonly');
      const store = transaction.objectStore(this.STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  public async upsert(user: LocalUser): Promise<void> {
    const db = await this.dbService.getDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.STORE_NAME, 'readwrite');
      const store = transaction.objectStore(this.STORE_NAME);
      const request = store.put(user);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  public async bulkUpsert(users: LocalUser[]): Promise<void> {
    if (!users.length) return;

    const db = await this.dbService.getDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.STORE_NAME, 'readwrite');
      const store = transaction.objectStore(this.STORE_NAME);

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);

      users.forEach((user) => {
        // If it's coming from server, missing syncState means CLEAN.
        if (!user.syncState) {
          user.syncState = 'CLEAN';
        }
        store.put(user);
      });
    });
  }

  public async delete(id: string): Promise<void> {
    const db = await this.dbService.getDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.STORE_NAME, 'readwrite');
      const store = transaction.objectStore(this.STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
}
