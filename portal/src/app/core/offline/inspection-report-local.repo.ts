import { Injectable, inject } from '@angular/core';
import { DbService } from './db.service';
import { LocalInspectionReport } from './types';

@Injectable({
  providedIn: 'root',
})
export class InspectionReportLocalRepo {
  private dbService = inject(DbService);
  private readonly STORE_NAME = 'inspection_reports';

  public async getById(id: string): Promise<LocalInspectionReport | null> {
    const db = await this.dbService.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readonly');
      const request = tx.objectStore(this.STORE_NAME).get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  public async list(): Promise<LocalInspectionReport[]> {
    const db = await this.dbService.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readonly');
      const request = tx.objectStore(this.STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  public async upsert(report: LocalInspectionReport): Promise<void> {
    const db = await this.dbService.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readwrite');
      const request = tx.objectStore(this.STORE_NAME).put(report);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
}
