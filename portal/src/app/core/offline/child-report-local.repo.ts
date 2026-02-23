import { Injectable, inject } from '@angular/core';
import { DbService } from './db.service';
import { LocalChildReport } from './types';
import { BehaviorSubject, Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ChildReportLocalRepo {
  private db = inject(DbService);
  private STORE_NAME = 'child_reports';

  private changesSubj = new BehaviorSubject<void>(undefined);
  public readonly changes$ = this.changesSubj.asObservable();

  public async getById(id: string): Promise<LocalChildReport | undefined> {
    const db = await this.db.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readonly');
      const store = tx.objectStore(this.STORE_NAME);
      const req = store.get(id);

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  public async list(): Promise<LocalChildReport[]> {
    const db = await this.db.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readonly');
      const store = tx.objectStore(this.STORE_NAME);
      const req = store.getAll();

      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  public async listByReportId(reportId: string): Promise<LocalChildReport[]> {
    const logs = await this.list();
    return logs.filter(l => l.inspectionReportId === reportId).sort((a, b) => {
      const timeA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const timeB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return timeB - timeA;
    });
  }

  public async upsert(log: LocalChildReport): Promise<void> {
    const db = await this.db.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readwrite');
      const store = tx.objectStore(this.STORE_NAME);
      const req = store.put(log);

      req.onsuccess = () => {
        this.changesSubj.next();
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
  }

  public async bulkUpsert(logs: LocalChildReport[]): Promise<void> {
    if (logs.length === 0) return;
    const db = await this.db.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readwrite');
      const store = tx.objectStore(this.STORE_NAME);

      tx.oncomplete = () => {
        this.changesSubj.next();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);

      for (const log of logs) {
        store.put(log);
      }
    });
  }

  public async delete(id: string): Promise<void> {
    const db = await this.db.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readwrite');
      const store = tx.objectStore(this.STORE_NAME);
      const req = store.delete(id);

      req.onsuccess = () => {
        this.changesSubj.next();
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
  }
}
