import { Injectable, inject } from '@angular/core';
import { DbService } from './db.service';
import { LocalCustomer } from './types';
import { Subject, Observable } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class CustomerLocalRepo {
  private dbService = inject(DbService);
  private readonly STORE_NAME = 'customers';
  
  // Emit changes to allow components to listen reactively
  private changesSubject = new Subject<void>();
  public changes$: Observable<void> = this.changesSubject.asObservable();

  public async getById(id: string): Promise<LocalCustomer | undefined> {
    const db = await this.dbService.getDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.STORE_NAME, 'readonly');
      const store = transaction.objectStore(this.STORE_NAME);
      const request = store.get(id);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  public async list(): Promise<LocalCustomer[]> {
    const db = await this.dbService.getDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.STORE_NAME, 'readonly');
      const store = transaction.objectStore(this.STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  public async upsert(customer: LocalCustomer): Promise<void> {
    const db = await this.dbService.getDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.STORE_NAME, 'readwrite');
      const store = transaction.objectStore(this.STORE_NAME);
      const request = store.put(customer);

      request.onsuccess = () => {
        resolve();
        this.changesSubject.next();
      };
      request.onerror = () => reject(request.error);
    });
  }

  public async bulkUpsert(customers: LocalCustomer[]): Promise<void> {
    if (!customers.length) return;
    
    const db = await this.dbService.getDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.STORE_NAME, 'readwrite');
      const store = transaction.objectStore(this.STORE_NAME);

      transaction.oncomplete = () => {
        resolve();
        this.changesSubject.next();
      };
      transaction.onerror = () => reject(transaction.error);

      customers.forEach((customer) => {
        if (!customer.syncState) {
          customer.syncState = 'SYNCED';
        }
        store.put(customer);
      });
    });
  }

  public async setActive(id: string, isActive: boolean, reason?: string): Promise<void> {
    const db = await this.dbService.getDb();
    const customer = await this.getById(id);
    if (!customer) return;

    customer.isActive = isActive;
    customer.syncState = 'PENDING';
    
    // Optimistic offline timestamp placeholder
    if (!isActive) {
      (customer as any).deactivatedAt = new Date().toISOString();
      if (reason) {
        (customer as any).deactivationReason = reason;
      }
    } else {
      (customer as any).deactivatedAt = null;
      (customer as any).deactivationReason = null;
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.STORE_NAME, 'readwrite');
      const store = transaction.objectStore(this.STORE_NAME);
      const request = store.put(customer);

      request.onsuccess = () => {
        resolve();
        this.changesSubject.next();
      };
      request.onerror = () => reject(request.error);
    });
  }

  public async remapId(oldLocalId: string, newServerCustomer: LocalCustomer): Promise<void> {
    const db = await this.dbService.getDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.STORE_NAME, 'readwrite');
      const store = transaction.objectStore(this.STORE_NAME);
      
      const deleteRequest = store.delete(oldLocalId);
      
      deleteRequest.onsuccess = () => {
        const putRequest = store.put({ ...newServerCustomer, syncState: 'SYNCED' });
        putRequest.onsuccess = () => {
          resolve();
          this.changesSubject.next();
        };
        putRequest.onerror = () => reject(putRequest.error);
      };
      
      deleteRequest.onerror = () => reject(deleteRequest.error);
    });
  }
}
