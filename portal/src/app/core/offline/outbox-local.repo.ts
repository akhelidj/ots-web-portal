import { Injectable, inject } from '@angular/core';
import { DbService } from './db.service';
import { OutboxItem } from './types';

@Injectable({
  providedIn: 'root',
})
export class OutboxLocalRepo {
  private dbService = inject(DbService);
  private readonly STORE_NAME = 'outbox';

  public async getPendingItems(): Promise<OutboxItem[]> {
    const db = await this.dbService.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readonly');
      const index = tx.objectStore(this.STORE_NAME).index('status');
      const request = index.getAll('PENDING');
      
      request.onsuccess = () => {
        const items = request.result as OutboxItem[];
        // Sort sequentially by createdAt
        items.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        resolve(items);
      };
      request.onerror = () => reject(request.error);
    });
  }

  public async countPendingItems(): Promise<number> {
    const db = await this.dbService.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readonly');
      const index = tx.objectStore(this.STORE_NAME).index('status');
      const request = index.count('PENDING');
      request.onsuccess = () => resolve(request.result || 0);
      request.onerror = () => reject(request.error);
    });
  }

  public async upsert(item: OutboxItem): Promise<void> {
    const db = await this.dbService.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readwrite');
      const request = tx.objectStore(this.STORE_NAME).put(item);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  public async hasConflictItems(): Promise<boolean> {
    const db = await this.dbService.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readonly');
      const index = tx.objectStore(this.STORE_NAME).index('status');
      const request = index.count('CONFLICT');
      request.onsuccess = () => resolve((request.result || 0) > 0);
      request.onerror = () => reject(request.error);
    });
  }
}
