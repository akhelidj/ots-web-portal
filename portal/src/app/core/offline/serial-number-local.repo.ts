import { Injectable, inject } from '@angular/core';
import { DbService } from './db.service';
import { LocalSerialNumber } from './types';

@Injectable({
  providedIn: 'root',
})
export class SerialNumberLocalRepo {
  private dbService = inject(DbService);
  private readonly STORE_NAME = 'serial_numbers';

  public async getById(id: string): Promise<LocalSerialNumber | null> {
    const db = await this.dbService.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readonly');
      const request = tx.objectStore(this.STORE_NAME).get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  public async listByReportId(reportId: string): Promise<LocalSerialNumber[]> {
    const db = await this.dbService.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readonly');
      const index = tx.objectStore(this.STORE_NAME).index('inspectionReportId');
      const request = index.getAll(reportId);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  public async upsert(serialNumber: LocalSerialNumber): Promise<void> {
    const db = await this.dbService.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readwrite');
      const request = tx.objectStore(this.STORE_NAME).put(serialNumber);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  public async bulkUpsert(serialNumbers: LocalSerialNumber[]): Promise<void> {
    if (serialNumbers.length === 0) return;
    const db = await this.dbService.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readwrite');
      const store = tx.objectStore(this.STORE_NAME);
      for (const item of serialNumbers) {
        store.put(item);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}
