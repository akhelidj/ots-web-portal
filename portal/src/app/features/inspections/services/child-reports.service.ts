import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ChildReportLocalRepo } from '@portal/core/offline/repos/child-report-local.repo';
import { OutboxService } from '@portal/core/offline/services/outbox.service';
import { OutboxLocalRepo } from '@portal/core/offline/repos/outbox-local.repo';
import {
  CHILD_REPORT_TYPES,
  ENTITY_TYPES,
} from '@portal/core/constants/app.constants';
import { LocalChildReport } from '@portal/core/offline/models/types';
import { environment } from '@app-env/environment';
import { ConnectivityService } from '@portal/core/offline/services/connectivity.service';

@Injectable({ providedIn: 'root' })
export class ChildReportsService {
  private http = inject(HttpClient);
  private crRepo = inject(ChildReportLocalRepo);
  private outbox = inject(OutboxService);
  private outboxRepo = inject(OutboxLocalRepo);
  private connectivity = inject(ConnectivityService);

  public readonly changes$ = this.crRepo.changes$;

  private get isOnline(): boolean {
    return this.connectivity.isOnline();
  }

  public async getChildReportsForInspection(
    inspectionReportId: string,
  ): Promise<LocalChildReport[]> {
    return this.crRepo.listByReportId(inspectionReportId);
  }

  /**
   * Fetch the latest state of a child report from the server and update local DB.
   * Always call this to ensure the local DB reflects server truth.
   */
  public async pullSingleFromServer(
    id: string,
  ): Promise<LocalChildReport | null> {
    if (!this.isOnline) return null;
    try {
      const serverReport = await firstValueFrom(
        this.http.get<LocalChildReport>(
          `${environment.apiUrl}/child-reports/${id}`,
        ),
      );
      this.connectivity.markApiReachable();
      await this.crRepo.upsert({ ...serverReport, syncState: 'SYNCED' });
      return serverReport;
    } catch (e) {
      if (this.isOfflineError(e)) {
        this.connectivity.markApiUnreachable();
      }

      console.error(`Failed to pull child report ${id} from server`, e);
      return null;
    }
  }

  /**
   * Transition a child report status.
   * Online: direct API call, refresh local from server response.
   * Offline: update local + enqueue outbox.
   */
  public async transition(
    id: string,
    toStatus: LocalChildReport['status'],
    reason?: string,
  ): Promise<void> {
    const cr = await this.crRepo.getById(id);
    if (!cr) throw new Error(`Child report not found locally: ${id}`);

    if (this.isOnline) {
      const result = await firstValueFrom(
        this.http.post<LocalChildReport>(
          `${environment.apiUrl}/child-reports/${id}/transition`,
          { toStatus, reason, version: cr.version },
        ),
      );
      this.connectivity.markApiReachable();
      await this.crRepo.upsert({ ...result, syncState: 'SYNCED' });
    } else {
      await this.crRepo.upsert({
        ...cr,
        status: toStatus,
        syncState: 'PENDING',
        updatedAt: new Date().toISOString(),
      });
      await this.outbox.enqueue({
        id: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        entityType: ENTITY_TYPES.CHILD_REPORT,
        entityId: id,
        operation: 'TRANSITION',
        payload: { toStatus, reason, version: cr.version },
        status: 'PENDING',
        attemptCount: 0,
        lastError: null,
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
          { notes, version: cr.version },
        ),
      );
      this.connectivity.markApiReachable();
      await this.crRepo.upsert({ ...result, syncState: 'SYNCED' });
    } else {
      await this.crRepo.upsert({
        ...cr,
        notes,
        syncState: 'PENDING',
        updatedAt: new Date().toISOString(),
      });
      await this.outbox.enqueue({
        id: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        entityType: ENTITY_TYPES.CHILD_REPORT,
        entityId: id,
        operation: 'UPDATE',
        payload: { notes, version: cr.version },
        status: 'PENDING',
        attemptCount: 0,
        lastError: null,
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
    disposition?: string,
  ): Promise<void> {
    const cr = await this.crRepo.getById(childReportId);
    if (!cr)
      throw new Error(`Child report not found locally: ${childReportId}`);

    if (this.isOnline) {
      const result = await firstValueFrom(
        this.http.patch<LocalChildReport>(
          `${environment.apiUrl}/child-reports/${childReportId}/serial-numbers/${serialNumberId}`,
          { inspectionData, disposition },
        ),
      );
      this.connectivity.markApiReachable();
      await this.crRepo.upsert({ ...result, syncState: 'SYNCED' });
    } else {
      const newSerials = cr.serialNumbers.map((s) =>
        s.id === serialNumberId ? { ...s, inspectionData, disposition } : s,
      );
      await this.crRepo.upsert({
        ...cr,
        serialNumbers: newSerials,
        syncState: 'PENDING',
        updatedAt: new Date().toISOString(),
      });
      await this.outbox.enqueue({
        id: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        entityType: ENTITY_TYPES.CHILD_REPORT,
        entityId: childReportId,
        operation: 'SN_UPDATE_INSPECTION',
        payload: { serialNumberId, inspectionData, disposition },
        status: 'PENDING',
        attemptCount: 0,
        lastError: null,
      });
    }
  }

  /**
   * Pull all child reports for a parent inspection report from the server.
   * Always replaces local SYNCED copies with server truth.
   */
  public async pullForInspectionFromServer(
    inspectionReportId: string,
  ): Promise<void> {
    if (!this.isOnline) return;
    try {
      const serverReports = await firstValueFrom(
        this.http.get<LocalChildReport[]>(
          `${environment.apiUrl}/child-reports?inspectionReportId=${inspectionReportId}`,
        ),
      );
      this.connectivity.markApiReachable();
      const localList = await this.crRepo.listByReportId(inspectionReportId);
      const localMap = new Map(localList.map((c) => [c.id, c]));

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
      if (this.isOfflineError(e)) {
        this.connectivity.markApiUnreachable();
      }

      console.error(
        `Failed to pull Child Reports from server for report ${inspectionReportId}`,
        e,
      );
    }
  }

  public async generateReworkChildReport(
    inspectionReportId: string,
  ): Promise<LocalChildReport | null> {
    if (!this.isOnline) {
      const localChildren =
        await this.crRepo.listByReportId(inspectionReportId);
      const existingRework = localChildren.find(
        (child) => child.type === CHILD_REPORT_TYPES.REWORK,
      );
      if (existingRework) {
        return existingRework;
      }

      const alreadyQueued = await this.outboxRepo.hasPendingOperation(
        ENTITY_TYPES.CHILD_REPORT,
        inspectionReportId,
        'SYNC_REWORK',
      );

      if (!alreadyQueued) {
        await this.outbox.enqueue({
          id: crypto.randomUUID(),
          idempotencyKey: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          entityType: ENTITY_TYPES.CHILD_REPORT,
          entityId: inspectionReportId,
          operation: 'SYNC_REWORK',
          payload: {},
          status: 'PENDING',
          attemptCount: 0,
          lastError: null,
        });
      }

      return null;
    }

    const serverReport = await firstValueFrom(
      this.http.post<LocalChildReport | null>(
        `${environment.apiUrl}/inspection-reports/${inspectionReportId}/child-reports/sync-rework`,
        {},
      ),
    );
    this.connectivity.markApiReachable();

    if (serverReport) {
      await this.crRepo.upsert({ ...serverReport, syncState: 'SYNCED' });
      return serverReport;
    }

    const localChildren = await this.crRepo.listByReportId(inspectionReportId);
    const reworkChild = localChildren.find(
      (child) => child.type === CHILD_REPORT_TYPES.REWORK,
    );
    if (reworkChild) {
      await this.crRepo.delete(reworkChild.id);
    }

    return null;
  }

  public async uploadAttachment(id: string, file: File): Promise<void> {
    if (!this.isOnline) {
      throw new Error(
        'Attachment upload is currently only supported when online.',
      );
    }

    const formData = new FormData();
    formData.append('file', file);

    const result = await firstValueFrom(
      this.http.post<LocalChildReport>(
        `${environment.apiUrl}/child-reports/${id}/attachments`,
        formData,
      ),
    );

    this.connectivity.markApiReachable();
    await this.crRepo.upsert({ ...result, syncState: 'SYNCED' });
  }

  private isOfflineError(error: unknown): boolean {
    return error instanceof HttpErrorResponse && error.status === 0;
  }
}
