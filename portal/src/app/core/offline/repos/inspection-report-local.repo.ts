import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { DbService } from '@portal/core/offline/services/db.service';
import { LocalInspectionReport } from '@portal/core/offline/models/types';

@Injectable({
  providedIn: 'root',
})
export class InspectionReportLocalRepo {
  private dbService = inject(DbService);
  private changesSubject = new BehaviorSubject<void>(undefined);

  public readonly changes$: Observable<void> = this.changesSubject.asObservable();
  private readonly STORE_NAME = 'inspection_reports';

  async getById(id: string): Promise<LocalInspectionReport | undefined> {
    const db = await this.dbService.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readonly');
      const store = tx.objectStore(this.STORE_NAME);
      const req = store.get(id);

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async list(): Promise<LocalInspectionReport[]> {
    const db = await this.dbService.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readonly');
      const store = tx.objectStore(this.STORE_NAME);
      const req = store.getAll();

      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async upsert(report: LocalInspectionReport): Promise<void> {
    const db = await this.dbService.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readwrite');
      const store = tx.objectStore(this.STORE_NAME);
      const req = store.put(report);

      req.onsuccess = () => {
        this.changesSubject.next();
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
  }

  async bulkUpsert(reports: LocalInspectionReport[]): Promise<void> {
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

      for (const report of reports) {
        store.put(report);
      }
    });
  }

  async remapId(oldId: string, newReport: LocalInspectionReport): Promise<void> {
    const db = await this.dbService.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readwrite');
      const store = tx.objectStore(this.STORE_NAME);

      const delReq = store.delete(oldId);
      delReq.onsuccess = () => {
        store.put(newReport);
      };

      tx.oncomplete = () => {
        this.changesSubject.next();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  }
}
