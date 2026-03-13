import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { signal } from '@angular/core';
import { environment } from '@app-env/environment';
import { InspectionReportLocalRepo } from '@portal/core/offline/repos/inspection-report-local.repo';
import { SerialNumberLocalRepo } from '@portal/core/offline/repos/serial-number-local.repo';
import { LocalInspectionReport, LocalSerialNumber, LocalTransitionLog, LocalInspectionApprovalBatch, LocalBatchSerialNumber } from '@portal/core/offline/models/types';
import { OutboxService } from '@portal/core/offline/services/outbox.service';
import { TransitionLogLocalRepo } from '@portal/core/offline/repos/transition-log-local.repo';
import { ApprovalBatchLocalRepo } from '@portal/core/offline/repos/approval-batch-local.repo';
import { BatchSerialNumberLocalRepo } from '@portal/core/offline/repos/batch-serial-number-local.repo';
import { SessionService } from '@portal/core/auth/services/session.service';
import { BATCH_STATUSES, ENTITY_TYPES, ReportStatus, REPORT_STATUSES, SERIAL_STATUSES } from '@portal/core/constants/app.constants';

@Injectable({
  providedIn: 'root'
})
export class InspectionReportsService {
  private http = inject(HttpClient);
  public irRepo = inject(InspectionReportLocalRepo);
  private snRepo = inject(SerialNumberLocalRepo);
  private tlRepo = inject(TransitionLogLocalRepo);
  private approvalBatchRepo = inject(ApprovalBatchLocalRepo);
  private batchSnRepo = inject(BatchSerialNumberLocalRepo);
  private outbox = inject(OutboxService);
  private session = inject(SessionService);

  public readonly reports = signal<LocalInspectionReport[]>([]);

  private async enqueueChildSync(reportId: string): Promise<void> {
    await this.outbox.enqueue({
      id: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      entityType: ENTITY_TYPES.CHILD_REPORT,

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
  public async pullBatchesForReport(reportId: string): Promise<void> {
    try {
      const batches = await firstValueFrom(
        this.http.get<any[]>(`${environment.apiUrl}/inspection-reports/${reportId}/approval-batches`)
      );



      for (const b of batches) {
        // Upsert Batch
        const batchData = {
          id: b.id,
          tenantId: b.tenantId,
          inspectionReportId: reportId,
          submittedByUserId: b.submittedByUserId,
          submittedAt: b.submittedAt,
          reviewedByUserId: b.reviewedByUserId,
          reviewedAt: b.reviewedAt,
          status: b.status, // 'SUBMITTED', 'APPROVED', 'RETURNED'
          notes: b.notes,
          version: b.version
        };
        await this.approvalBatchRepo.upsert(batchData);

        // Upsert serial associations
        if (b.serialNumbers && Array.isArray(b.serialNumbers)) {
           const associations = b.serialNumbers.map((sn: any) => ({
             id: sn.id,
             inspectionApprovalBatchId: b.id,
             serialNumberId: sn.serialNumberId
           }));
           await this.batchSnRepo.bulkUpsert(associations);
        }
      }
      
      await this.refreshLocalCache();
    } catch (e) {
      console.error(`Failed to pull batches for report ${reportId}`, e);
    }
  }

  public async pullAllAndCache(): Promise<void> {
    try {
      const url = `${environment.apiUrl}/inspection-reports`;
      // Removed role-based status filtering for Supervisors to ensure all reports are visible

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
               
               // Safeguard: Preserve local disposition/final section if server data is partial
               let mergedInspectionJson = inspectionData as Record<string, any>;
               if (local?.inspectionJson && inspectionData) {
                  const localDisp = local.inspectionJson['disposition'] || local.inspectionJson['final']?.['disposition'];
                  const serverDisp = (inspectionData as Record<string, any>)['disposition'] || (inspectionData as Record<string, any>)['final']?.['disposition'];
                  
                  if (localDisp && !serverDisp) {
                    // Merge local disposition back into the server payload if missing
                    mergedInspectionJson = {
                      ...(inspectionData as Record<string, any>),
                      ['final']: {
                        ...((inspectionData as Record<string, any>)['final'] || {}),
                        ['disposition']: localDisp
                      }
                    };
                  }
               }

               const ls = { ...restS, value: serialNumber, inspectionJson: mergedInspectionJson, inspectionReportId: rep.id, syncState: 'SYNCED' };
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
      entityType: ENTITY_TYPES.INSPECTION_REPORT,
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
      entityType: ENTITY_TYPES.INSPECTION_REPORT,
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
      pendingTransitionToStatus: toStatus as ReportStatus,
      syncState: 'PENDING',
    };

    await this.irRepo.upsert(updatedRep);

    const profile = this.session.profile();
    if (profile) {
      const tempLogId = 'local-tl-' + crypto.randomUUID();
      const tempLog: LocalTransitionLog = {
        id: tempLogId,
        inspectionReportId: id,
        fromStatus: rep.status as ReportStatus,
        toStatus: toStatus as ReportStatus,
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
      entityType: ENTITY_TYPES.INSPECTION_REPORT,
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
      entityType: ENTITY_TYPES.SERIAL_NUMBER,
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
      entityType: ENTITY_TYPES.SERIAL_NUMBER,
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
      entityType: ENTITY_TYPES.SERIAL_NUMBER,
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
      entityType: ENTITY_TYPES.SERIAL_NUMBER,
      entityId: id,
      operation: 'SN_DELETE',
      payload: { inspectionReportId: sn.inspectionReportId },
      status: 'PENDING',
      attemptCount: 0,
      lastError: null,
    });
  }

  public async submitApprovalBatch(reportId: string, serialNumberIds: string[]): Promise<void> {
    if (navigator.onLine) {
      const rep = await this.irRepo.getById(reportId);
      if (!rep) throw new Error('Report not found');

      try {
        const response = await firstValueFrom(
          this.http.post<any>(`${environment.apiUrl}/inspection-reports/${reportId}/approval-batches`, {
            serialNumberIds,
            reportVersion: rep.version
          })
        );
        // Refresh local cache with server state
        await this.pullBatchesForReport(reportId);
        await this.pullAllAndCache();
        return;
      } catch (err) {
        console.error('Direct batch submission failed, falling back to offline', err);
      }
    }
    return this.submitApprovalBatchOffline(reportId, serialNumberIds);
  }

  public async submitApprovalBatchOffline(reportId: string, serialNumberIds: string[]): Promise<void> {

    const rep = await this.irRepo.getById(reportId);
    if (!rep) throw new Error('Report not found');

    const batchId = 'local-batch-' + crypto.randomUUID();
    const profile = this.session.profile();

    const newBatch: LocalInspectionApprovalBatch = {
      id: batchId,
      tenantId: profile?.tenantId || '',
      inspectionReportId: reportId,
      submittedByUserId: profile?.id || '',
      submittedAt: new Date().toISOString(),
      status: 'SUBMITTED',
      version: 1,
      syncState: 'PENDING'
    };

    await this.approvalBatchRepo.upsert(newBatch);

    const bSns: LocalBatchSerialNumber[] = serialNumberIds.map(snId => ({
      id: 'local-bsn-' + crypto.randomUUID(),
      inspectionApprovalBatchId: batchId,
      serialNumberId: snId,
    }));
    
    await this.batchSnRepo.bulkUpsert(bSns);

    await this.outbox.enqueue({
      id: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      entityType: 'APPROVAL_BATCH', // We defined it as APPROVAL_BATCH in sync-dispatcher
      entityId: batchId,
      operation: 'SUBMIT',
      payload: { inspectionReportId: reportId, serialNumberIds, reportVersion: rep.version },
      status: 'PENDING',
      attemptCount: 0,
      lastError: null,
    });
    
    for (const snId of serialNumberIds) {
      const sn = await this.snRepo.getById(snId);
      if (sn) {
        await this.snRepo.upsert({ ...sn, approvalStatus: 'SUBMITTED_FOR_APPROVAL', syncState: 'PENDING' });
      }
    }
    
    await this.refreshLocalCache();
  }

  public async approveBatch(batchId: string, serialNumberIds?: string[]): Promise<void> {
    if (navigator.onLine) {
      const batch = await this.approvalBatchRepo.getById(batchId);
      if (batch && !batch.id.startsWith('local-')) {
        const rep = await this.irRepo.getById(batch.inspectionReportId);
        if (rep) {
          try {
            await firstValueFrom(
              this.http.post<any>(`${environment.apiUrl}/inspection-reports/${batch.inspectionReportId}/approval-batches/${batchId}/approve`, {
                batchVersion: batch.version,
                reportVersion: rep.version,
                serialNumberIds
              })
            );
            await this.pullBatchesForReport(batch.inspectionReportId);
            await this.pullAllAndCache();
            return;
          } catch (err) {
            console.error('Direct batch approval failed, falling back to offline', err);
          }
        }
      }
    }
    return this.approveBatchOffline(batchId, serialNumberIds);
  }

  public async approveBatchOffline(batchId: string, serialNumberIds?: string[]): Promise<void> {
    const batch = await this.approvalBatchRepo.getById(batchId);
    if (!batch) throw new Error('Batch not found');

    const rep = await this.irRepo.getById(batch.inspectionReportId);
    if (!rep) throw new Error('Report not found');

    await this.outbox.enqueue({
      id: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      entityType: 'APPROVAL_BATCH',
      entityId: batchId,
      operation: 'APPROVE',
      payload: { 
        batchVersion: batch.version,
        reportVersion: rep.version,
        serialNumberIds
      },
      status: 'PENDING',
      attemptCount: 0,
      lastError: null,
    });

    const batchSns = await this.batchSnRepo.listByBatchId(batchId);
    const targetSnIds: string[] = [];
    if (serialNumberIds && serialNumberIds.length > 0) {
      // Filter provided IDs to only include those that are actually pending
      for (const id of serialNumberIds) {
        const sn = await this.snRepo.getById(id);
        if (sn && sn.approvalStatus === SERIAL_STATUSES.SUBMITTED_FOR_APPROVAL) {
          targetSnIds.push(id);
        }
      }
    } else {
      // Filter batch members for items that are actually pending
      for (const m of batchSns) {
        const sn = await this.snRepo.getById(m.serialNumberId);
        if (sn && sn.approvalStatus === SERIAL_STATUSES.SUBMITTED_FOR_APPROVAL) {
          targetSnIds.push(m.serialNumberId);
        }
      }
    }

    if (targetSnIds.length > 0) {
      for (const snId of targetSnIds) {
        const sn = await this.snRepo.getById(snId);
        if (sn) {
          sn.approvalStatus = SERIAL_STATUSES.APPROVED;
          sn.syncState = 'PENDING';
          await this.snRepo.upsert(sn);
        }
      }
    }

    // Update batch status only if all members are processed
    const allMembers = await this.batchSnRepo.listByBatchId(batchId);
    let allProcessed = true;
    for (const m of allMembers) {
      const sn = await this.snRepo.getById(m.serialNumberId);
      if (sn && sn.approvalStatus === SERIAL_STATUSES.SUBMITTED_FOR_APPROVAL) {
        allProcessed = false;
        break;
      }
    }

    if (allProcessed) {
      batch.status = BATCH_STATUSES.APPROVED;
      await this.approvalBatchRepo.upsert(batch);
    }

    await this.refreshLocalCache();
    await this.checkAndAutoApproveReport(batch.inspectionReportId);
  }

  public async returnBatch(batchId: string, reason: string, serialNumberIds?: string[]): Promise<void> {
    if (navigator.onLine) {
      const batch = await this.approvalBatchRepo.getById(batchId);
      if (batch && !batch.id.startsWith('local-')) {
        const rep = await this.irRepo.getById(batch.inspectionReportId);
        if (rep) {
          try {
            await firstValueFrom(
              this.http.post<any>(`${environment.apiUrl}/inspection-reports/${batch.inspectionReportId}/approval-batches/${batchId}/return`, {
                reason,
                batchVersion: batch.version,
                reportVersion: rep.version,
                serialNumberIds
              })
            );
            await this.pullBatchesForReport(batch.inspectionReportId);
            await this.pullAllAndCache();
            return;
          } catch (err) {
            console.error('Direct batch return failed, falling back to offline', err);
          }
        }
      }
    }
    return this.returnBatchOffline(batchId, reason, serialNumberIds);
  }

  public async returnBatchOffline(batchId: string, reason: string, serialNumberIds?: string[]): Promise<void> {
    const batch = await this.approvalBatchRepo.getById(batchId);
    if (!batch) throw new Error('Batch not found');

    const rep = await this.irRepo.getById(batch.inspectionReportId);
    if (!rep) throw new Error('Report not found');

    await this.outbox.enqueue({
      id: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      entityType: 'APPROVAL_BATCH',
      entityId: batchId,
      operation: 'RETURN',
      payload: { 
        reason,
        batchVersion: batch.version,
        reportVersion: rep.version,
        serialNumberIds
      },
      status: 'PENDING',
      attemptCount: 0,
      lastError: null,
    });

    const batchSns = await this.batchSnRepo.listByBatchId(batchId);
    const targetSnIds: string[] = [];
    if (serialNumberIds && serialNumberIds.length > 0) {
      // Filter provided IDs to only include those that are actually pending
      for (const id of serialNumberIds) {
        const sn = await this.snRepo.getById(id);
        if (sn && sn.approvalStatus === SERIAL_STATUSES.SUBMITTED_FOR_APPROVAL) {
          targetSnIds.push(id);
        }
      }
    } else {
      // Filter batch members for items that are actually pending
      for (const m of batchSns) {
        const sn = await this.snRepo.getById(m.serialNumberId);
        if (sn && sn.approvalStatus === SERIAL_STATUSES.SUBMITTED_FOR_APPROVAL) {
          targetSnIds.push(m.serialNumberId);
        }
      }
    }

    if (targetSnIds.length > 0) {
      for (const snId of targetSnIds) {
        const sn = await this.snRepo.getById(snId);
        if (sn) {
          sn.approvalStatus = SERIAL_STATUSES.INSPECTED_DRAFT;
          sn.syncState = 'PENDING';
          await this.snRepo.upsert(sn);
        }
      }
    }

    // Update batch status only if all members are processed
    const allMembers = await this.batchSnRepo.listByBatchId(batchId);
    let allProcessed = true;
    for (const m of allMembers) {
      const sn = await this.snRepo.getById(m.serialNumberId);
      if (sn && sn.approvalStatus === SERIAL_STATUSES.SUBMITTED_FOR_APPROVAL) {
        allProcessed = false;
        break;
      }
    }

    if (allProcessed) {
      batch.status = BATCH_STATUSES.RETURNED;
      batch.notes = reason;
      await this.approvalBatchRepo.upsert(batch);
    }

    await this.refreshLocalCache();
  }

  public async publishReport(reportId: string): Promise<void> {
    const rep = await this.irRepo.getById(reportId);
    if (!rep) throw new Error('Report not found');

    await this.outbox.enqueue({
      id: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      entityType: ENTITY_TYPES.INSPECTION_REPORT,
      entityId: reportId,
      operation: 'UPDATE_STATUS',
      payload: { 
        status: REPORT_STATUSES.APPROVED,
        version: rep.version
      },
      status: 'PENDING',
      attemptCount: 0,
      lastError: null,
    });

    rep.status = REPORT_STATUSES.APPROVED;
    rep.syncState = 'PENDING';
    rep.updatedAt = new Date().toISOString();
    await this.irRepo.upsert(rep);

    await this.refreshLocalCache();
  }

  private async checkAndAutoApproveReport(reportId: string): Promise<void> {
    const sns = await this.snRepo.listByReportId(reportId);
    if (sns.length === 0) return;

    const allApproved = sns.every(sn => sn.approvalStatus === SERIAL_STATUSES.APPROVED);
    if (allApproved) {
      const rep = await this.irRepo.getById(reportId);
      if (rep && rep.status !== REPORT_STATUSES.APPROVED) {
        // We still allow manual publish via button, but we could auto-trigger here if desired.
        // For now, only local update to help UI states.
        rep.status = REPORT_STATUSES.APPROVED;
        await this.irRepo.upsert(rep);
      }
    }
  }
}
