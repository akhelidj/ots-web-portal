import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { signal } from '@angular/core';
import { environment } from '@app-env/environment';
import { InspectionReportLocalRepo } from '@portal/core/offline/repos/inspection-report-local.repo';
import { SerialNumberLocalRepo } from '@portal/core/offline/repos/serial-number-local.repo';
import { LocalInspectionReport, LocalSerialNumber, LocalTransitionLog } from '@portal/core/offline/models/types';
import { OutboxService } from '@portal/core/offline/services/outbox.service';
import { TransitionLogLocalRepo } from '@portal/core/offline/repos/transition-log-local.repo';
import { SessionService } from '@portal/core/auth/services/session.service';

@Injectable({
  providedIn: 'root'
})
export class InspectionReportsService {
  private http = inject(HttpClient);
  public irRepo = inject(InspectionReportLocalRepo);
  private snRepo = inject(SerialNumberLocalRepo);
  private tlRepo = inject(TransitionLogLocalRepo);
  private outbox = inject(OutboxService);
  private session = inject(SessionService);

  public readonly reports = signal<LocalInspectionReport[]>([]);

  private async enqueueChildSync(reportId: string): Promise<void> {
    await this.outbox.enqueue({
      id: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      entityType: 'CHILD_REPORT',
      entityId: reportId,
      operation: 'SYNC_REWORK',
      payload: {},
      status: 'PENDING',
      attemptCount: 0,
      lastError: null,
    });
  }

  constructor() {
    this.irRepo.changes$.subscribe(() => {
      this.refreshLocalCache();
    });
  }

  public async refreshLocalCache(): Promise<void> {
    const list = await this.irRepo.list();
    this.reports.set(list);
  }

  public async getSnForReport(reportId: string): Promise<LocalSerialNumber[]> {
    return this.snRepo.listByReportId(reportId);
  }

  public async getTransitionLogsLocally(reportId: string): Promise<LocalTransitionLog[]> {
    return this.tlRepo.listByReportId(reportId);
  }

  public async refreshAvailableTransitions(reportId: string): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<{ fromStatus: string; transitions: { toStatus: string; requiresReason: boolean }[] }>(
          `${environment.apiUrl}/inspection-reports/${reportId}/available-transitions`
        )
      );

      const rep = await this.irRepo.getById(reportId);
      if (rep) {
         await this.irRepo.upsert({ ...rep, availableTransitions: JSON.stringify(res) });
      }
      await this.refreshLocalCache();
    } catch (e) {
      console.error(`Failed to refresh available transitions for report ${reportId}`, e);
    }
  }

  public async refreshTransitionLogs(reportId: string): Promise<void> {
    try {
      const logs = await firstValueFrom(
        this.http.get<LocalTransitionLog[]>(`${environment.apiUrl}/inspection-reports/${reportId}/transitions`)
      );
      
      const localLogs = await this.tlRepo.listByReportId(reportId);
      const localMap = new Map(localLogs.map(l => [l.id, l]));

      // Clear pseudo-logs created locally
      for (const lg of localLogs) {
         if (lg.id.startsWith('local-tl-')) {
            await this.tlRepo.delete(lg.id);
            localMap.delete(lg.id);
         }
      }

      const toUpsert: LocalTransitionLog[] = [];
      for (const lg of logs) {
         if (!localMap.has(lg.id)) {
            toUpsert.push(lg);
         }
      }

      if (toUpsert.length > 0) {
        await this.tlRepo.bulkUpsert(toUpsert);
      }
    } catch (e) {
       console.error(`Failed to refresh transition logs for report ${reportId}`, e);
    }
  }

  public async pullAllAndCache(): Promise<void> {
    try {
      let url = `${environment.apiUrl}/inspection-reports`;
      const profile = this.session.profile();
      if (profile?.role === 'SUPERVISOR') {
        url += '?status=PENDING_APPROVAL';
      }

      const reports = await firstValueFrom(
        this.http.get<LocalInspectionReport[]>(url)
      );

      const localReports = await this.irRepo.list();
      const localMap = new Map(localReports.map(r => [r.id, r]));

      const toUpsert: LocalInspectionReport[] = [];
      for (const r of reports) {
        const local = localMap.get(r.id);
        if (!local || local.syncState === 'SYNCED') {
          r.syncState = 'SYNCED';
          toUpsert.push(r);
        }
      }
      
      if (toUpsert.length > 0) {
        await this.irRepo.bulkUpsert(toUpsert);
      }

      for (const rep of reports) {
        try {
          const serials = await firstValueFrom(
            this.http.get<{ id: string; serialNumber: string; [key: string]: unknown }[]>(`${environment.apiUrl}/inspection-reports/${rep.id}/serial-numbers`)
          );
          
          const localSnList = await this.snRepo.listByReportId(rep.id);
          const localSnMap = new Map(localSnList.map(s => [s.id, s]));
          
          const toUpsertSn: LocalSerialNumber[] = [];
          for (const s of serials) {
            const local = localSnMap.get(s.id);
            if (!local || local.syncState === 'SYNCED') {
               const { serialNumber, inspectionData, ...restS } = s;
               const ls = { ...restS, value: serialNumber, inspectionJson: inspectionData, inspectionReportId: rep.id, syncState: 'SYNCED' };
               toUpsertSn.push(ls as unknown as LocalSerialNumber);
            }
          }
          
          if (toUpsertSn.length > 0) {
            await this.snRepo.bulkUpsert(toUpsertSn);
          }
        } catch (snErr) {
          console.error(`Failed to pull SNs for report ${rep.id}`, snErr);
        }
      }

      await this.refreshLocalCache();
    } catch (e) {
      console.error('Failed to pull all inspection reports and serials from server', e);
      throw e;
    }
  }

  public async createOffline(payload: { customerId: string; poNumber: string; templateKey: string }): Promise<void> {
    const tempId = 'local-ir-' + crypto.randomUUID();
    const newReport: LocalInspectionReport = {
      id: tempId,
      customerId: payload.customerId || null,
      poNumber: payload.poNumber,
      status: 'DRAFT',
      templateKey: payload.templateKey,
      templateVersion: 1, // Just dummy for offline
      templateHash: '',
      version: 1,
      syncState: 'PENDING',
    };

    await this.irRepo.upsert(newReport);

    await this.outbox.enqueue({
      id: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      entityType: 'INSPECTION_REPORT',
      entityId: tempId,
      operation: 'CREATE',
      payload: { ...payload },
      status: 'PENDING',
      attemptCount: 0,
      lastError: null,
    });
  }

  public async updateReportOffline(id: string, updates: Partial<LocalInspectionReport>): Promise<void> {
    const rep = await this.irRepo.getById(id);
    if (!rep) throw new Error('Report not found');

    const updatedRep: LocalInspectionReport = {
      ...rep,
      ...updates,
      syncState: 'PENDING',
    };

    await this.irRepo.upsert(updatedRep);

    await this.outbox.enqueue({
      id: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      entityType: 'INSPECTION_REPORT',
      entityId: id,
      operation: 'UPDATE',
      payload: { ...updates, version: rep.version },
      status: 'PENDING',
      attemptCount: 0,
      lastError: null,
    });
  }

  public async transitionOffline(id: string, toStatus: string, reason?: string): Promise<void> {
    const rep = await this.irRepo.getById(id);
    if (!rep) throw new Error('Report not found');

    const updatedRep: LocalInspectionReport = {
      ...rep,
      pendingTransitionToStatus: toStatus,
      syncState: 'PENDING',
    };

    await this.irRepo.upsert(updatedRep);

    const profile = this.session.profile();
    if (profile) {
      const tempLogId = 'local-tl-' + crypto.randomUUID();
      const tempLog: LocalTransitionLog = {
        id: tempLogId,
        inspectionReportId: id,
        fromStatus: rep.status,
        toStatus: toStatus,
        reason: reason || '',
        userId: profile.id,
        timestamp: new Date().toISOString()
      };
      await this.tlRepo.upsert(tempLog);
    }

    await this.outbox.enqueue({
      id: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      entityType: 'INSPECTION_REPORT',
      entityId: id,
      operation: 'TRANSITION',
      payload: { toStatus, reason, version: rep.version },
      status: 'PENDING',
      attemptCount: 0,
      lastError: null,
    });
  }

  public async addSerialNumberOffline(reportId: string, serials: string[]): Promise<void> {
    const validSerials = serials.map(s => s.trim()).filter(s => s.length > 0);
    if (validSerials.length === 0) return;

    const existingSns = await this.snRepo.listByReportId(reportId);
    const existingVals = new Set(existingSns.map(s => s.value.toLowerCase()));

    const uniqueSerials = [...new Set(validSerials)];
    const newSerials = uniqueSerials.filter(s => !existingVals.has(s.toLowerCase()));

    if (newSerials.length === 0) {
       throw new Error('All provided serial numbers already exist in this report.');
    }

    const itemsPayload: { clientRef: string, serialNumber: string }[] = [];

    for (const serial of newSerials) {
      const tempId = 'local-sn-' + crypto.randomUUID();
      const sn: LocalSerialNumber = {
        id: tempId,
        inspectionReportId: reportId,
        value: serial,
        version: 1,
        syncState: 'PENDING',
      };

      await this.snRepo.upsert(sn);
      itemsPayload.push({ clientRef: tempId, serialNumber: serial });
    }

    await this.outbox.enqueue({
      id: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      entityType: 'SERIAL_NUMBER',
      entityId: reportId, // Entity ID is the report for bulk
      operation: 'BULK_CREATE',
      payload: { inspectionReportId: reportId, items: itemsPayload },
      status: 'PENDING',
      attemptCount: 0,
      lastError: null,
    });

    await this.enqueueChildSync(reportId);
  }

  public async renameSerialNumberOffline(id: string, newSerial: string): Promise<void> {
    const sn = await this.snRepo.getById(id);
    if (!sn) throw new Error('Serial number not found locally');

    const trimmed = newSerial.trim();
    const existingSns = await this.snRepo.listByReportId(sn.inspectionReportId);
    if (existingSns.some(s => s.id !== id && s.value.toLowerCase() === trimmed.toLowerCase())) {
       throw new Error(`Serial number '${trimmed}' already exists in this report.`);
    }

    const updatedSn: LocalSerialNumber = {
      ...sn,
      value: trimmed,
      version: sn.version + 1,
      syncState: 'PENDING',
    };

    await this.snRepo.upsert(updatedSn);

    await this.outbox.enqueue({
      id: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      entityType: 'SERIAL_NUMBER',
      entityId: id,
      operation: 'UPDATE',
      payload: { value: newSerial.trim(), version: sn.version },
      status: 'PENDING',
      attemptCount: 0,
      lastError: null,
    });

    await this.enqueueChildSync(sn.inspectionReportId);
  }

  public async saveSerialNumberInspectionOffline(id: string, inspectionJson: Record<string, unknown>): Promise<void> {
    const sn = await this.snRepo.getById(id);
    if (!sn) throw new Error('Serial number not found locally');

    const updatedSn: LocalSerialNumber = {
      ...sn,
      inspectionJson,
      version: sn.version + 1,
      syncState: 'PENDING',
    };

    await this.snRepo.upsert(updatedSn);

    await this.outbox.enqueue({
      id: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      entityType: 'SERIAL_NUMBER',
      entityId: id,
      operation: 'SN_UPDATE_INSPECTION',
      payload: { inspectionData: inspectionJson, version: sn.version },
      status: 'PENDING',
      attemptCount: 0,
      lastError: null,
    });

    await this.enqueueChildSync(sn.inspectionReportId);
  }

  public async deleteSerialNumberOffline(id: string): Promise<void> {
    const sn = await this.snRepo.getById(id);
    if (!sn) throw new Error('Serial number not found locally');

    await this.snRepo.delete(id);

    await this.outbox.enqueue({
      id: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      entityType: 'SERIAL_NUMBER',
      entityId: id,
      operation: 'SN_DELETE',
      payload: { inspectionReportId: sn.inspectionReportId },
      status: 'PENDING',
      attemptCount: 0,
      lastError: null,
    });
  }
}
