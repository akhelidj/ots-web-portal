import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ChildReportLocalRepo } from '../core/offline/child-report-local.repo';
import { OutboxService } from '../core/offline/outbox.service';
import { LocalChildReport } from '../core/offline/types';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ChildReportsService {
  private http = inject(HttpClient);
  private crRepo = inject(ChildReportLocalRepo);
  private outbox = inject(OutboxService);

  public readonly changes$ = this.crRepo.changes$;

  public async getChildReportsForInspection(inspectionReportId: string): Promise<LocalChildReport[]> {
    return this.crRepo.listByReportId(inspectionReportId);
  }

  public async createOffline(payload: { inspectionReportId: string; serialNumberId: string; type: 'REWORK' | 'SCRAP' | 'HOLD'; notes?: string }): Promise<void> {
    const tempId = crypto.randomUUID();
    
    // Create optimistic local record
    const newCr: LocalChildReport = {
      id: tempId,
      tenantId: 'local', // Placeholder, API assigns real one
      inspectionReportId: payload.inspectionReportId,
      serialNumberId: payload.serialNumberId,
      type: payload.type,
      notes: payload.notes || null,
      status: 'DRAFT',
      version: 1,
      syncState: 'PENDING',
      updatedAt: new Date().toISOString()
    };

    await this.crRepo.upsert(newCr);

    // Enqueue creation 
    const backendPayload = {
      id: tempId,
      inspectionReportId: payload.inspectionReportId,
      serialNumberId: payload.serialNumberId,
      type: payload.type,
      notes: payload.notes
    };

    await this.outbox.enqueue({
      id: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      entityType: 'CHILD_REPORT',
      entityId: tempId,
      operation: 'CREATE',
      payload: backendPayload,
      status: 'PENDING',
      attemptCount: 0,
      lastError: null
    });
  }

  public async updateOffline(id: string, payload: { status?: 'DRAFT' | 'IN_INSPECTION' | 'PENDING_APPROVAL' | 'APPROVED' | 'CLOSED'; notes?: string }): Promise<void> {
    const cr = await this.crRepo.getById(id);
    if (!cr) throw new Error(`Child report not found locally: ${id}`);

    const updatedCr: LocalChildReport = {
      ...cr,
      ...payload,
      syncState: 'PENDING',
      updatedAt: new Date().toISOString()
    };

    await this.crRepo.upsert(updatedCr);

    const backendPayload = {
      ...payload,
      version: cr.version
    };

    await this.outbox.enqueue({
      id: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      entityType: 'CHILD_REPORT',
      entityId: id,
      operation: 'UPDATE',
      payload: backendPayload,
      status: 'PENDING',
      attemptCount: 0,
      lastError: null
    });
  }

  public async pullForInspectionFromServer(inspectionReportId: string): Promise<void> {
    try {
      const serverReports = await firstValueFrom(
        this.http.get<LocalChildReport[]>(`${environment.apiUrl}/child-reports?inspectionReportId=${inspectionReportId}`)
      );
      
      const localList = await this.crRepo.listByReportId(inspectionReportId);
      const localMap = new Map(localList.map(c => [c.id, c]));

      const toUpsert: LocalChildReport[] = [];
      for (const s of serverReports) {
        const local = localMap.get(s.id);
        if (!local || local.syncState === 'SYNCED') {
          toUpsert.push({ ...s, syncState: 'SYNCED' });
        }
      }

      if (toUpsert.length > 0) {
        await this.crRepo.bulkUpsert(toUpsert);
      }
    } catch (e) {
      console.error(`Failed to pull Child Reports from server for report ${inspectionReportId}`, e);
    }
  }
}
