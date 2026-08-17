import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { signal } from '@angular/core';
import { environment } from '@app-env/environment';
import { APP_ROLES } from '@portal/core/constants/app.constants';
import {
  DataHydrationContext,
  DataHydrationSource,
} from '@portal/core/offline/services/data-hydration.token';

export interface AdminTemplateItem {
  id: string;
  templateKey: string;
  templateVersion: number;
  status: 'ACTIVE' | 'DEPRECATED';
  changeNote: string;
  createdAt: string;
  createdById: string;
}

/** One extracted `{{token}}` from `GET /templates/:id/tokens`. Mirrors the API's
 *  ExtractedToken (no shared DTO package — see ADR-0008). */
export interface ExtractedToken {
  token: string;
  cell: string;
  row: number;
}

/** Portal-side mirror of the API's ops field type. `date` is renderable (Phase D 2b). */
export type OpsFieldType = 'text' | 'number' | 'boolean' | 'select' | 'date';

/** One ops-described field for `PUT /templates/:id/definition`. Mirrors OpsTokenField. */
export interface OpsTokenField {
  token: string;
  label: string;
  type: OpsFieldType;
  required: boolean;
  scope: 'header' | 'item';
  section?: string;
  options?: string[];
}

/** The request body for `PUT /templates/:id/definition`. Mirrors the API's
 *  DefineTemplateDto — the front/back HTTP contract, duplicated by design. The UI does
 *  NOT author `computed`/`disposition`/transforms; the server gate is the sole authority
 *  on validity, and this ships only what the describe screen collects. */
export interface DefineTemplateDto {
  displayName?: string;
  region: {
    id: string;
    label?: string;
    marker: string;
  };
  fields: OpsTokenField[];
}

@Injectable({
  providedIn: 'root',
})
export class AdminTemplatesService implements DataHydrationSource {
  private http = inject(HttpClient);

  public readonly templates = signal<AdminTemplateItem[]>([]);
  public readonly resourceKey = 'admin-templates';

  public canHydrate(context: DataHydrationContext): boolean {
    return context.profile?.role === APP_ROLES.ADMIN;
  }

  public async pullAllAndCache(): Promise<void> {
    try {
      const templates = await firstValueFrom(
        this.http.get<AdminTemplateItem[]>(`${environment.apiUrl}/templates`),
      );
      this.templates.set(templates);
    } catch (e) {
      console.error('Failed to fetch templates:', e);
      throw e;
    }
  }

  public async fetchAll(): Promise<void> {
    await this.pullAllAndCache();
  }

  public async createTemplate(
    templateKey: string,
    changeNote: string,
    file: File,
  ): Promise<void> {
    const formData = new FormData();
    formData.append('templateKey', templateKey);
    formData.append('changeNote', changeNote);
    formData.append('file', file);

    await firstValueFrom(
      this.http.post(`${environment.apiUrl}/templates`, formData),
    );
    await this.fetchAll();
  }

  /** Read-only: the workbook's extracted tokens, for the describe screen. */
  public async getTokens(id: string): Promise<ExtractedToken[]> {
    return firstValueFrom(
      this.http.get<ExtractedToken[]>(
        `${environment.apiUrl}/templates/${id}/tokens`,
      ),
    );
  }

  /** Submit the ops-authored description. Resolves on 200 (definition written);
   *  rejects with the server's per-check reason on a 4xx gate rejection. */
  public async defineTemplate(
    id: string,
    dto: DefineTemplateDto,
  ): Promise<unknown> {
    return firstValueFrom(
      this.http.put(`${environment.apiUrl}/templates/${id}/definition`, dto),
    );
  }

  public async deprecateTemplate(id: string): Promise<void> {
    await firstValueFrom(
      this.http.patch(`${environment.apiUrl}/templates/${id}/deprecate`, {}),
    );
    await this.fetchAll();
  }
}
