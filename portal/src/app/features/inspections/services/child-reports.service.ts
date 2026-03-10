import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ChildReportLocalRepo } from '@portal/core/offline/repos/child-report-local.repo';
import { OutboxService } from '@portal/core/offline/services/outbox.service';
import { LocalChildReport } from '@portal/core/offline/models/types';
import { environment } from '@app-env/environment';

@Injectable({ providedIn: 'root' })
export class ChildReportsService {
  private http = inject(HttpClient);
  private crRepo = inject(ChildReportLocalRepo);
  private outbox = inject(OutboxService);

  public readonly changes$ = this.crRepo.changes$;

  private get isOnline(): boolean {
    return navigator.onLine;
  }

  public async getChildReportsForInspection(inspectionReportId: string): Promise<LocalChildReport[]> {
    return this.crRepo.listByReportId(inspectionReportId);
  }

  /**
   * Fetch the latest state of a child report from the server and update local DB.
   * Always call this to ensure the local DB reflects server truth.
   */
  public async pullSingleFromServer(id: string): Promise<LocalChildReport | null> {
    if (!this.isOnline) return null;
    try {
      const serverReport = await firstValueFrom(
        this.http.get<LocalChildReport>(`${environment.apiUrl}/child-reports/${id}`)
      );
      await this.crRepo.upsert({ ...serverReport, syncState: 'SYNCED' });
      return serverReport;
    } catch (e) {
      console.error(`Failed to pull child report ${id} from server`, e);
      return null;
    }
  }

  /**
   * Transition a child report status.
   * Online: direct API call, refresh local from server response.
   * Offline: update local + enqueue outbox.
   */
  public async transition(id: string, toStatus: LocalChildReport['status'], reason?: string): Promise<void> {
    const cr = await this.crRepo.getById(id);
    if (!cr) throw new Error(`Child report not found locally: ${id}`);

    if (this.isOnline) {
      const result = await firstValueFrom(
        this.http.post<LocalChildReport>(
          `${environment.apiUrl}/child-reports/${id}/transition`,
          { toStatus, reason, version: cr.version }
        )
      );
      await this.crRepo.upsert({ ...result, syncState: 'SYNCED' });
    } else {
      await this.crRepo.upsert({
        ...cr,
        status: toStatus,
        syncState: 'PENDING',
        updatedAt: new Date().toISOString()
      });
      await this.outbox.enqueue({
        id: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        entityType: 'CHILD_REPORT',
        entityId: id,
        operation: 'TRANSITION',
        payload: { toStatus, reason, version: cr.version },
        status: 'PENDING',
        attemptCount: 0,
        lastError: null
      });
    }
  }

  /**
   * Update notes on a child report.
   * Online: direct API call, refresh local from server response.
   * Offline: update local + enqueue outbox.
   */
  public async updateNotes(id: string, notes: string): Promise<void> {
    const cr = await this.crRepo.getById(id);
    if (!cr) throw new Error(`Child report not found locally: ${id}`);

    if (this.isOnline) {
      const result = await firstValueFrom(
        this.http.patch<LocalChildReport>(
          `${environment.apiUrl}/child-reports/${id}`,
          { notes, version: cr.version }
        )
      );
      await this.crRepo.upsert({ ...result, syncState: 'SYNCED' });
    } else {
      await this.crRepo.upsert({
        ...cr,
        notes,
        syncState: 'PENDING',
        updatedAt: new Date().toISOString()
      });
      await this.outbox.enqueue({
        id: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        entityType: 'CHILD_REPORT',
        entityId: id,
        operation: 'UPDATE',
        payload: { notes, version: cr.version },
        status: 'PENDING',
        attemptCount: 0,
        lastError: null
      });
    }
  }

  /**
   * Save inspection data for a serial number in a child report.
   * Online: direct API call, refresh the whole child report from server response.
   * Offline: update local cache + enqueue outbox.
   */
  public async updateSerialNumberInspection(
    childReportId: string,
    serialNumberId: string,
    inspectionData: Record<string, unknown>,
    disposition?: string
  ): Promise<void> {
    const cr = await this.crRepo.getById(childReportId);
    if (!cr) throw new Error(`Child report not found locally: ${childReportId}`);

    if (this.isOnline) {
      const result = await firstValueFrom(
        this.http.patch<LocalChildReport>(
          `${environment.apiUrl}/child-reports/${childReportId}/serial-numbers/${serialNumberId}`,
          { inspectionData, disposition }
        )
      );
      await this.crRepo.upsert({ ...result, syncState: 'SYNCED' });
    } else {
      const newSerials = cr.serialNumbers.map(s =>
        s.id === serialNumberId ? { ...s, inspectionData, disposition } : s
      );
      await this.crRepo.upsert({
        ...cr,
        serialNumbers: newSerials,
        syncState: 'PENDING',
        updatedAt: new Date().toISOString()
      });
      await this.outbox.enqueue({
        id: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        entityType: 'CHILD_REPORT',
        entityId: childReportId,
        operation: 'SN_UPDATE_INSPECTION',
        payload: { serialNumberId, inspectionData, disposition },
        status: 'PENDING',
        attemptCount: 0,
        lastError: null
      });
    }
  }

  /**
   * Pull all child reports for a parent inspection report from the server.
   * Always replaces local SYNCED copies with server truth.
   */
  public async pullForInspectionFromServer(inspectionReportId: string): Promise<void> {
    if (!this.isOnline) return;
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

  public async uploadAttachment(id: string, file: File): Promise<void> {
    const formData = new FormData();
    formData.append('file', file);
    await firstValueFrom(
      this.http.post(`${environment.apiUrl}/child-reports/${id}/attachments`, formData)
    );
  }
}
