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

  public readonly changes$: Observable<void> =
    this.changesSubject.asObservable();
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
      const getReq = store.get(report.id);

      getReq.onsuccess = () => {
        const req = store.put(this.keepDefinition(report, getReq.result));

        req.onsuccess = () => {
          this.changesSubject.next();
          resolve();
        };
        req.onerror = () => reject(req.error);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }

  /**
   * `definitionJson` (and `inspectorName`) are grafted onto the list/detail responses
   * only; the PATCH and transition responses carry none. A `put` of such a response would wipe the cached
   * definition, and the report's field sections would show "no usable field definition"
   * until the next pull restored it. Keep the cached one when the incoming record has
   * none (undefined) — an explicit `null` from the server is still honoured.
   */
  private keepDefinition(
    incoming: LocalInspectionReport,
    existing: LocalInspectionReport | undefined,
  ): LocalInspectionReport {
    if (!existing) return incoming;
    const merged = { ...incoming };
    if (
      incoming.definitionJson === undefined &&
      existing.definitionJson !== undefined
    ) {
      merged.definitionJson = existing.definitionJson;
    }
    // Same for the derived inspector name (detail payload only).
    if (
      incoming.inspectorName === undefined &&
      existing.inspectorName !== undefined
    ) {
      merged.inspectorName = existing.inspectorName;
    }
    return merged;
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
        const getReq = store.get(report.id);
        getReq.onsuccess = () => {
          store.put(this.keepDefinition(report, getReq.result));
        };
      }
    });
  }

  async delete(id: string): Promise<void> {
    const db = await this.dbService.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readwrite');
      const req = tx.objectStore(this.STORE_NAME).delete(id);

      req.onsuccess = () => {
        this.changesSubject.next();
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
  }

  async remapId(
    oldId: string,
    newReport: LocalInspectionReport,
  ): Promise<void> {
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
