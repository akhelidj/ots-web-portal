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
    await this.localRepo.bulkUpsert(customers);
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
