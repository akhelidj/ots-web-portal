import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class DbService {
  private readonly DB_NAME = 'ots_offline_db';
  private readonly DB_VERSION = 3;
  private dbInstance: IDBDatabase | null = null;
  private initPromise: Promise<IDBDatabase> | null = null;

  public async getDb(): Promise<IDBDatabase> {
    if (this.dbInstance) {
      return this.dbInstance;
    }
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = new Promise((resolve, reject) => {
      const request = window.indexedDB.open(this.DB_NAME, this.DB_VERSION);

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

        if (!db.objectStoreNames.contains('inspection_reports')) {
          const store = db.createObjectStore('inspection_reports', { keyPath: 'id' });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
          store.createIndex('status', 'status', { unique: false });
          store.createIndex('customerId', 'customerId', { unique: false });
        }

        if (!db.objectStoreNames.contains('serial_numbers')) {
          const store = db.createObjectStore('serial_numbers', { keyPath: 'id' });
          store.createIndex('inspectionReportId', 'inspectionReportId', { unique: false });
          store.createIndex('serialNumberValue', 'serialNumberValue', { unique: false });
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
      };
    });

    return this.initPromise;
  }
}
