import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { CustomerLocalRepo } from '../core/offline/customer-local.repo';
import { LocalCustomer } from '../core/offline/types';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class AdminCustomersService {
  private http = inject(HttpClient);
  private localRepo = inject(CustomerLocalRepo);

  async pullAllAndCache(): Promise<void> {
    const customers = await firstValueFrom(this.http.get<LocalCustomer[]>(`${environment.apiUrl}/customers`));
    const localList = await this.localRepo.list();
    const localMap = new Map(localList.map(c => [c.id, c]));
    
    const toUpsert: LocalCustomer[] = [];
    for (const c of customers) {
      const local = localMap.get(c.id);
      if (!local || local.syncState === 'SYNCED') {
         toUpsert.push({ ...c, syncState: 'SYNCED' });
      }
    }
    
    if (toUpsert.length > 0) {
      await this.localRepo.bulkUpsert(toUpsert);
    }
  }

  async createOnServer(dto: any): Promise<LocalCustomer> {
    return firstValueFrom(this.http.post<LocalCustomer>(`${environment.apiUrl}/customers`, dto));
  }

  async patchOnServer(id: string, dto: any): Promise<LocalCustomer> {
    return firstValueFrom(this.http.patch<LocalCustomer>(`${environment.apiUrl}/customers/${id}`, dto));
  }

  async setActiveOnServer(id: string, isActive: boolean, version: number, reason?: string): Promise<LocalCustomer> {
    return firstValueFrom(
      this.http.patch<LocalCustomer>(`${environment.apiUrl}/customers/${id}/active`, { isActive, version, reason })
    );
  }
}
