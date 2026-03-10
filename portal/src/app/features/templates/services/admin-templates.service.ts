import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { environment } from '@app-env/environment';

export interface AdminTemplateItem {
  id: string;
  templateKey: string;
  templateVersion: number;
  status: 'ACTIVE' | 'DEPRECATED';
  changeNote: string;
  createdAt: string;
  createdById: string;
}

@Injectable({
  providedIn: 'root'
})
export class AdminTemplatesService {
  private http = inject(HttpClient);
  
  private templatesSubj = new BehaviorSubject<AdminTemplateItem[]>([]);
  public readonly templates$ = this.templatesSubj.asObservable();

  public async fetchAll(): Promise<void> {
    try {
      const templates = await firstValueFrom(
        this.http.get<AdminTemplateItem[]>(`${environment.apiUrl}/templates`)
      );
      this.templatesSubj.next(templates);
    } catch (e) {
      console.error('Failed to fetch templates:', e);
      throw e;
    }
  }

  public async createTemplate(templateKey: string, changeNote: string, file: File): Promise<void> {
    const formData = new FormData();
    formData.append('templateKey', templateKey);
    formData.append('changeNote', changeNote);
    formData.append('file', file);

    await firstValueFrom(
      this.http.post(`${environment.apiUrl}/templates`, formData)
    );
    await this.fetchAll();
  }

  public async deprecateTemplate(id: string): Promise<void> {
    await firstValueFrom(
      this.http.patch(`${environment.apiUrl}/templates/${id}/deprecate`, {})
    );
    await this.fetchAll();
  }
}
