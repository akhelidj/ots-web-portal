import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { DbService } from './db.service';
import { LocalSerialNumber } from './types';

@Injectable({
  providedIn: 'root',
})
export class SerialNumberLocalRepo {
  private dbService = inject(DbService);
  private changesSubject = new BehaviorSubject<void>(undefined);

  public readonly changes$: Observable<void> = this.changesSubject.asObservable();
  private readonly STORE_NAME = 'serial_numbers';

  async getById(id: string): Promise<LocalSerialNumber | undefined> {
    const db = await this.dbService.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readonly');
      const store = tx.objectStore(this.STORE_NAME);
      const req = store.get(id);

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async list(): Promise<LocalSerialNumber[]> {
    const db = await this.dbService.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readonly');
      const store = tx.objectStore(this.STORE_NAME);
      const req = store.getAll();

      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async listByReportId(reportId: string): Promise<LocalSerialNumber[]> {
    const db = await this.dbService.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readonly');
      const index = tx.objectStore(this.STORE_NAME).index('inspectionReportId');
      const req = index.getAll(reportId);

      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async upsert(serialNumber: LocalSerialNumber): Promise<void> {
    const db = await this.dbService.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readwrite');
      const store = tx.objectStore(this.STORE_NAME);
      const req = store.put(serialNumber);

      req.onsuccess = () => {
        this.changesSubject.next();
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
  }

  async bulkUpsert(serialNumbers: LocalSerialNumber[]): Promise<void> {
    if (serialNumbers.length === 0) return;
    const db = await this.dbService.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readwrite');
      const store = tx.objectStore(this.STORE_NAME);

      tx.oncomplete = () => {
        this.changesSubject.next();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);

      for (const item of serialNumbers) {
        store.put(item);
      }
    });
  }

  public async remapId(oldId: string, newSerialNumber: LocalSerialNumber): Promise<void> {
    const db = await this.dbService.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readwrite');
      const store = tx.objectStore(this.STORE_NAME);

      const delReq = store.delete(oldId);
      delReq.onsuccess = () => {
        store.put(newSerialNumber);
      };

      tx.oncomplete = () => {
        this.changesSubject.next();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  async remapReportId(oldReportId: string, newReportId: string): Promise<void> {
    const db = await this.dbService.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readwrite');
      const store = tx.objectStore(this.STORE_NAME);
      const index = store.index('inspectionReportId');
      
      const getReq = index.getAll(oldReportId);
      getReq.onsuccess = () => {
        const items = getReq.result || [];
        for (const item of items) {
          item.inspectionReportId = newReportId;
          store.put(item);
        }
      };

      tx.oncomplete = () => {
        this.changesSubject.next();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  }
}
