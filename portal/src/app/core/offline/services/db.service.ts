import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class DbService {
  private readonly DB_PREFIX = 'ots_';
  private readonly DB_VERSION = 9;
  private dbInstance: IDBDatabase | null = null;
  private initPromise: Promise<IDBDatabase> | null = null;
  private currentTenantId: string | null = null;

  public async openForTenant(tenantId: string): Promise<void> {
    if (this.currentTenantId === tenantId && this.dbInstance) {
      return;
    }

    if (this.dbInstance) {
      this.close();
    }

    this.currentTenantId = tenantId;
    const dbName = `${this.DB_PREFIX}${tenantId}`;

    this.initPromise = new Promise((resolve, reject) => {
      const request = window.indexedDB.open(dbName, this.DB_VERSION);

      request.onerror = () => {
        console.error('Failed to open IndexedDB:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.dbInstance = request.result;
        resolve(this.dbInstance);
      };

      request.onupgradeneeded = () => {
        const db = request.result;

        let irStore: IDBObjectStore;
        if (!db.objectStoreNames.contains('inspection_reports')) {
          irStore = db.createObjectStore('inspection_reports', {
            keyPath: 'id',
          });
        } else {
          if (!request.transaction) throw new Error('Transaction is missing');
          irStore = request.transaction.objectStore('inspection_reports');
        }
        if (!irStore.indexNames.contains('updatedAt'))
          irStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        if (!irStore.indexNames.contains('status'))
          irStore.createIndex('status', 'status', { unique: false });
        if (!irStore.indexNames.contains('customerId'))
          irStore.createIndex('customerId', 'customerId', { unique: false });
        if (!irStore.indexNames.contains('syncState'))
          irStore.createIndex('syncState', 'syncState', { unique: false });

        let snStore: IDBObjectStore;
        if (!db.objectStoreNames.contains('serial_numbers')) {
          snStore = db.createObjectStore('serial_numbers', { keyPath: 'id' });
        } else {
          if (!request.transaction) throw new Error('Transaction is missing');
          snStore = request.transaction.objectStore('serial_numbers');
        }
        if (!snStore.indexNames.contains('inspectionReportId'))
          snStore.createIndex('inspectionReportId', 'inspectionReportId', {
            unique: false,
          });
        if (!snStore.indexNames.contains('value'))
          snStore.createIndex('value', 'value', { unique: false });
        if (!snStore.indexNames.contains('syncState'))
          snStore.createIndex('syncState', 'syncState', { unique: false });

        let crStore: IDBObjectStore;
        if (!db.objectStoreNames.contains('child_reports')) {
          crStore = db.createObjectStore('child_reports', { keyPath: 'id' });
        } else {
          if (!request.transaction) throw new Error('Transaction is missing');
          crStore = request.transaction.objectStore('child_reports');
        }
        if (!crStore.indexNames.contains('inspectionReportId'))
          crStore.createIndex('inspectionReportId', 'inspectionReportId', {
            unique: false,
          });
        if (crStore.indexNames.contains('serialNumberId'))
          crStore.deleteIndex('serialNumberId');
        if (!crStore.indexNames.contains('syncState'))
          crStore.createIndex('syncState', 'syncState', { unique: false });

        if (!db.objectStoreNames.contains('transitionLogs')) {
          const tlStore = db.createObjectStore('transitionLogs', {
            keyPath: 'id',
          });
          tlStore.createIndex('inspectionReportId', 'inspectionReportId', {
            unique: false,
          });
          tlStore.createIndex('childReportId', 'childReportId', {
            unique: false,
          });
        }

        if (!db.objectStoreNames.contains('outbox')) {
          const store = db.createObjectStore('outbox', { keyPath: 'id' });
          store.createIndex('status', 'status', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }

        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }

        if (!db.objectStoreNames.contains('users')) {
          const store = db.createObjectStore('users', { keyPath: 'id' });
          store.createIndex('email', 'email', { unique: false });
          store.createIndex('role', 'role', { unique: false });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
          store.createIndex('isActive', 'isActive', { unique: false });
        }

        if (!db.objectStoreNames.contains('customers')) {
          const store = db.createObjectStore('customers', { keyPath: 'id' });
          store.createIndex('name', 'name', { unique: false });
          store.createIndex('isActive', 'isActive', { unique: false });
          store.createIndex('syncState', 'syncState', { unique: false });
        }

        if (!db.objectStoreNames.contains('inspection_approval_batches')) {
          const store = db.createObjectStore('inspection_approval_batches', {
            keyPath: 'id',
          });
          store.createIndex('inspectionReportId', 'inspectionReportId', {
            unique: false,
          });
          store.createIndex('status', 'status', { unique: false });
        }

        if (
          !db.objectStoreNames.contains('inspection_approval_batch_members')
        ) {
          const store = db.createObjectStore(
            'inspection_approval_batch_members',
            { keyPath: 'id' },
          );
          store.createIndex(
            'inspectionApprovalBatchId',
            'inspectionApprovalBatchId',
            { unique: false },
          );
          store.createIndex('serialNumberId', 'serialNumberId', {
            unique: false,
          });
        }
      };
    });

    await this.initPromise;
  }

  public close(): void {
    if (this.dbInstance) {
      this.dbInstance.close();
      this.dbInstance = null;
    }
    this.currentTenantId = null;
    this.initPromise = null;
  }

  public async getDb(): Promise<IDBDatabase> {
    if (!this.dbInstance && !this.initPromise) {
      throw new Error(
        'Database is not opened for any tenant. Call openForTenant first.',
      );
    }
    if (this.initPromise) {
      return this.initPromise;
    }
    if (!this.dbInstance) {
      throw new Error('Database instance is unexpectedly missing');
    }
    return this.dbInstance;
  }
}
