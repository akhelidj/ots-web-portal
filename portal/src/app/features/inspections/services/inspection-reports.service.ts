import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { signal } from '@angular/core';
import { environment } from '@app-env/environment';
import { InspectionReportLocalRepo } from '@portal/core/offline/repos/inspection-report-local.repo';
import { SerialNumberLocalRepo } from '@portal/core/offline/repos/serial-number-local.repo';
import {
  Attachment,
  LocalInspectionReport,
  LocalSerialNumber,
  LocalTransitionLog,
  LocalInspectionApprovalBatch,
  LocalBatchSerialNumber,
} from '@portal/core/offline/models/types';
import { OutboxService } from '@portal/core/offline/services/outbox.service';
import { TransitionLogLocalRepo } from '@portal/core/offline/repos/transition-log-local.repo';
import { ApprovalBatchLocalRepo } from '@portal/core/offline/repos/approval-batch-local.repo';
import { BatchSerialNumberLocalRepo } from '@portal/core/offline/repos/batch-serial-number-local.repo';
import { ChildReportLocalRepo } from '@portal/core/offline/repos/child-report-local.repo';
import { SessionService } from '@portal/core/auth/services/session.service';
import {
  BATCH_STATUSES,
  CHILD_REPORT_TYPES,
  CHILD_REPORT_STATUSES,
  ENTITY_TYPES,
  ReportStatus,
  REPORT_STATUSES,
  SERIAL_STATUSES,
} from '@portal/core/constants/app.constants';
import { ConnectivityService } from '@portal/core/offline/services/connectivity.service';
import { OutboxLocalRepo } from '@portal/core/offline/repos/outbox-local.repo';
import {
  DataHydrationContext,
  DataHydrationSource,
} from '@portal/core/offline/services/data-hydration.token';

/** One selectable template for the create-report picker. Mirrors the API's minimal
 *  available-templates shape (no fileBlob, no definition contents) — front/back contract
 *  duplicated by design (ADR-0008). */
export interface AvailableTemplate {
  templateKey: string;
  templateVersion: number;
  displayName: string;
}

/**
 * Thrown by {@link InspectionReportsService.uploadAttachment} when the device is
 * offline. Attachment upload is online-only. The attachments UI checks
 * connectivity and disables its controls ahead of time; this typed error is the
 * fallback if an upload is somehow attempted while offline — a caller can test
 * `err instanceof AttachmentUploadOfflineError` instead of string-matching.
 */
export class AttachmentUploadOfflineError extends Error {
  readonly offline = true as const;
  constructor(message = 'Attachment upload is only available while online.') {
    super(message);
    this.name = 'AttachmentUploadOfflineError';
  }
}

@Injectable({
  providedIn: 'root',
})
export class InspectionReportsService implements DataHydrationSource {
  private http = inject(HttpClient);
  public irRepo = inject(InspectionReportLocalRepo);
  private snRepo = inject(SerialNumberLocalRepo);
  private tlRepo = inject(TransitionLogLocalRepo);
  private approvalBatchRepo = inject(ApprovalBatchLocalRepo);
  private batchSnRepo = inject(BatchSerialNumberLocalRepo);
  private crRepo = inject(ChildReportLocalRepo);
  private outbox = inject(OutboxService);
  private outboxRepo = inject(OutboxLocalRepo);
  private session = inject(SessionService);
  private connectivity = inject(ConnectivityService);

  public readonly reports = signal<LocalInspectionReport[]>([]);
  public readonly resourceKey = 'inspection-reports';

  private mapServerSerialUpdate(
    local: LocalSerialNumber,
    update: {
      serialNumber?: string;
      inspectionData?: Record<string, unknown>;
      approvalStatus?: LocalSerialNumber['approvalStatus'];
      version?: number;
      updatedAt?: string;
      [key: string]: unknown;
    },
  ): LocalSerialNumber {
    return {
      ...local,
      value: update.serialNumber ?? local.value,
      inspectionJson:
        update.inspectionData !== undefined
          ? update.inspectionData
          : local.inspectionJson,
      approvalStatus: update.approvalStatus ?? local.approvalStatus,
      version: update.version ?? local.version,
      updatedAt: update.updatedAt ?? local.updatedAt,
      syncState: 'SYNCED',
    };
  }

  private get canUseNetwork(): boolean {
    return this.connectivity.isOnline();
  }

  public canHydrate(context: DataHydrationContext): boolean {
    return context.isAuthenticated;
  }

  public async enqueueChildSync(
    reportId: string,
    options?: { forceCreate?: boolean },
  ): Promise<void> {
    if (!options?.forceCreate) {
      const existingChildren = await this.crRepo.listByReportId(reportId);
      const hasReworkChild = existingChildren.some(
        (child) => child.type === CHILD_REPORT_TYPES.REWORK,
      );

      if (!hasReworkChild) {
        return;
      }
    }

    const alreadyQueued = await this.outboxRepo.hasPendingOperation(
      ENTITY_TYPES.CHILD_REPORT,
      reportId,
      'SYNC_REWORK',
    );

    if (alreadyQueued) {
      return;
    }

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
      if (!this.session.isAuthenticated()) {
        return;
      }

      void this.refreshLocalCache();
    });
  }

  public async refreshLocalCache(): Promise<void> {
    if (!this.session.isAuthenticated()) {
      this.reports.set([]);
      return;
    }

    try {
      const list = await this.irRepo.list();
      this.reports.set(list);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (message.includes('Database is not opened for any tenant')) {
        this.reports.set([]);
        return;
      }
      throw e;
    }
  }

  public async getSnForReport(reportId: string): Promise<LocalSerialNumber[]> {
    return this.snRepo.listByReportId(reportId);
  }

  public async getTransitionLogsLocally(
    reportId: string,
  ): Promise<LocalTransitionLog[]> {
    return this.tlRepo.listByReportId(reportId);
  }

  public async refreshAvailableTransitions(reportId: string): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<{
          fromStatus: string;
          transitions: { toStatus: string; requiresReason: boolean }[];
        }>(
          `${environment.apiUrl}/inspection-reports/${reportId}/available-transitions`,
        ),
      );

      const rep = await this.irRepo.getById(reportId);
      if (rep) {
        await this.irRepo.upsert({
          ...rep,
          availableTransitions: JSON.stringify(res),
        });
      }
      await this.refreshLocalCache();
    } catch (e) {
      console.error(
        `Failed to refresh available transitions for report ${reportId}`,
        e,
      );
    }
  }

  public async refreshTransitionLogs(reportId: string): Promise<void> {
    try {
      const logs = await firstValueFrom(
        this.http.get<LocalTransitionLog[]>(
          `${environment.apiUrl}/inspection-reports/${reportId}/transitions`,
        ),
      );

      const localLogs = await this.tlRepo.listByReportId(reportId);
      const localMap = new Map(localLogs.map((l) => [l.id, l]));

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
      console.error(
        `Failed to refresh transition logs for report ${reportId}`,
        e,
      );
    }
  }
  public async pullBatchesForReport(reportId: string): Promise<void> {
    try {
      const batches = await firstValueFrom(
        this.http.get<LocalInspectionApprovalBatch[]>(
          `${environment.apiUrl}/inspection-reports/${reportId}/approval-batches`,
        ),
      );

      for (const b of batches) {
        // Upsert Batch
        const batchData = {
          id: b.id,
          tenantId: b.tenantId,
          inspectionReportId: reportId,
          childReportId: b.childReportId,
          submittedByUserId: b.submittedByUserId,
          submittedAt: b.submittedAt,
          reviewedByUserId: b.reviewedByUserId,
          reviewedAt: b.reviewedAt,
          status: b.status, // 'SUBMITTED', 'APPROVED', 'RETURNED'
          notes: b.notes,
          version: b.version,
        };
        await this.approvalBatchRepo.upsert(batchData);

        // Upsert serial associations. The GET /approval-batches response nests a
        // `serialNumbers` array per batch (API includes it) that the transport
        // DTO doesn't declare; reach for that honest shape at the read boundary.
        const bExt = b as LocalInspectionApprovalBatch & {
          serialNumbers?: {
            id: string;
            serialNumberId: string;
            status?: LocalBatchSerialNumber['status'];
          }[];
        };
        if (bExt.serialNumbers && Array.isArray(bExt.serialNumbers)) {
          const associations: LocalBatchSerialNumber[] = bExt.serialNumbers.map(
            (sn) => ({
              id: sn.id,
              inspectionApprovalBatchId: b.id,
              serialNumberId: sn.serialNumberId,
              status: sn.status || 'PENDING',
            }),
          );
          await this.batchSnRepo.bulkUpsert(associations);
        }
      }

      await this.refreshLocalCache();
    } catch (e) {
      console.error(`Failed to pull batches for report ${reportId}`, e);
    }
  }

  public async pullAllAndCache(): Promise<void> {
    if (!this.canUseNetwork) {
      await this.refreshLocalCache();
      return;
    }

    try {
      const url = `${environment.apiUrl}/inspection-reports`;
      // Removed role-based status filtering for Supervisors to ensure all reports are visible

      const reports = await firstValueFrom(
        this.http.get<LocalInspectionReport[]>(url),
      );
      this.connectivity.markApiReachable();

      const localReports = await this.irRepo.list();
      const localMap = new Map(localReports.map((r) => [r.id, r]));

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
            this.http.get<
              { id: string; serialNumber: string; [key: string]: unknown }[]
            >(
              `${environment.apiUrl}/inspection-reports/${rep.id}/serial-numbers`,
            ),
          );

          const localSnList = await this.snRepo.listByReportId(rep.id);
          const localSnMap = new Map(localSnList.map((s) => [s.id, s]));

          const toUpsertSn: LocalSerialNumber[] = [];
          for (const s of serials) {
            const local = localSnMap.get(s.id);
            if (!local || local.syncState === 'SYNCED') {
              const { serialNumber, inspectionData, ...restS } = s;

              // Safeguard: Preserve local disposition/final section if server data is partial
              let mergedInspectionJson = inspectionData as Record<
                string,
                unknown
              >;
              if (local?.inspectionJson && inspectionData) {
                const localFinal = local.inspectionJson['final'] as
                  | Record<string, unknown>
                  | undefined;
                const localDisp =
                  local.inspectionJson['disposition'] ||
                  localFinal?.['disposition'];
                const serverDisp =
                  ((inspectionData as Record<string, unknown>)[
                    'disposition'
                  ] as string) ||
                  ((
                    (inspectionData as Record<string, unknown>)['final'] as
                      | Record<string, unknown>
                      | undefined
                  )?.['disposition'] as string | undefined);

                if (localDisp && !serverDisp) {
                  // Merge local disposition back into the server payload if missing
                  mergedInspectionJson = {
                    ...(inspectionData as Record<string, unknown>),
                    ['final']: {
                      ...((inspectionData as Record<string, unknown>)[
                        'final'
                      ] || {}),
                      ['disposition']: localDisp,
                    },
                  };
                }
              }

              const ls = {
                ...restS,
                value: serialNumber,
                inspectionJson: mergedInspectionJson,
                inspectionReportId: rep.id,
                syncState: 'SYNCED',
              };
              toUpsertSn.push(ls as unknown as LocalSerialNumber);
            }
          }

          if (toUpsertSn.length > 0) {
            await this.snRepo.bulkUpsert(toUpsertSn);
          }
        } catch (snErr) {
          console.error(`Failed to pull SNs for report ${rep.id}`, snErr);
        }

        // Attachments live only on the per-report detail payload — the list
        // endpoint omits them — so hydrate them the same way as serials: through
        // the pull, into the cache, so a read-only consumer (a customer) sees
        // their documents offline-first. The detail payload also carries the pinned
        // template's `definitionJson` (grafted server-side, same as the list), so
        // re-establish it here too — the read-only Specs surface needs it, and this
        // guarantees it can never be left null on a hydrated row. Only SYNCED rows
        // are touched: a PENDING local edit is never clobbered, and no detail fetch
        // is made for a not-yet-synced local id (which the server would 404).
        try {
          const localRep = await this.irRepo.getById(rep.id);
          if (localRep && localRep.syncState === 'SYNCED') {
            const detail = await firstValueFrom(
              this.http.get<LocalInspectionReport>(
                `${environment.apiUrl}/inspection-reports/${rep.id}`,
              ),
            );
            await this.irRepo.upsert({
              ...localRep,
              attachments: detail.attachments ?? localRep.attachments,
              definitionJson: detail.definitionJson ?? localRep.definitionJson,
            });
          }
        } catch (attErr) {
          console.error(
            `Failed to pull attachments for report ${rep.id}`,
            attErr,
          );
        }
      }

      await this.refreshLocalCache();
    } catch (e) {
      if (this.isOfflineError(e)) {
        this.connectivity.markApiUnreachable();
        await this.refreshLocalCache();
        return;
      }

      console.error(
        'Failed to pull all inspection reports and serials from server',
        e,
      );
      throw e;
    }
  }

  /**
   * The consumption picker's source: templates a report can be created against —
   * defined+active only, tenant-wide (the server enforces the filter). Online-only: a
   * report is created online in the live path, and picking a template needs the current
   * server list; if the fetch fails we surface an empty list (the picker shows nothing
   * to choose, rather than a stale hardcode). Mirrors GET /inspection-reports/
   * available-templates.
   */
  public async getAvailableTemplates(): Promise<AvailableTemplate[]> {
    return firstValueFrom(
      this.http.get<AvailableTemplate[]>(
        `${environment.apiUrl}/inspection-reports/available-templates`,
      ),
    );
  }

  public async createReport(payload: {
    customerId: string;
    poNumber: string;
    templateKey: string;
  }): Promise<void> {
    if (this.canUseNetwork) {
      try {
        const createdReport = await firstValueFrom(
          this.http.post<LocalInspectionReport>(
            `${environment.apiUrl}/inspection-reports`,
            payload,
          ),
        );

        this.connectivity.markApiReachable();
        await this.irRepo.upsert({ ...createdReport, syncState: 'SYNCED' });
        await this.refreshLocalCache();
        return;
      } catch (error) {
        if (!this.isOfflineError(error)) {
          throw error;
        }

        this.connectivity.markApiUnreachable();
      }
    }

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

  public async saveReportUpdates(
    id: string,
    updates: Partial<LocalInspectionReport>,
  ): Promise<void> {
    const rep = await this.irRepo.getById(id);
    if (!rep) throw new Error('Report not found');

    if (this.canUseNetwork && !id.startsWith('local-ir-')) {
      try {
        const updatedReport = await firstValueFrom(
          this.http.patch<LocalInspectionReport>(
            `${environment.apiUrl}/inspection-reports/${id}`,
            { ...updates, version: rep.version },
          ),
        );

        this.connectivity.markApiReachable();
        await this.irRepo.upsert({ ...updatedReport, syncState: 'SYNCED' });
        await this.refreshLocalCache();
        return;
      } catch (error) {
        if (!this.isOfflineError(error)) {
          throw error;
        }

        this.connectivity.markApiUnreachable();
      }
    }

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

  public async transitionReport(
    id: string,
    toStatus: string,
    reason?: string,
  ): Promise<void> {
    const rep = await this.irRepo.getById(id);
    if (!rep) throw new Error('Report not found');

    if (this.canUseNetwork && !id.startsWith('local-ir-')) {
      try {
        const transitionedReport = await firstValueFrom(
          this.http.post<LocalInspectionReport>(
            `${environment.apiUrl}/inspection-reports/${id}/transitions`,
            { toStatus, reason, version: rep.version },
          ),
        );

        this.connectivity.markApiReachable();
        await this.irRepo.upsert({
          ...rep,
          ...transitionedReport,
          pendingTransitionToStatus: null,
          syncState: 'SYNCED',
        });
        await this.refreshAvailableTransitions(id);
        await this.refreshTransitionLogs(id);
        await this.refreshLocalCache();
        return;
      } catch (error) {
        if (!this.isOfflineError(error)) {
          throw error;
        }

        this.connectivity.markApiUnreachable();
      }
    }

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
        timestamp: new Date().toISOString(),
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

  public async addSerialNumbers(
    reportId: string,
    serials: string[],
  ): Promise<void> {
    const validSerials = serials
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (validSerials.length === 0) return;

    const existingSns = await this.snRepo.listByReportId(reportId);
    const existingVals = new Set(existingSns.map((s) => s.value.toLowerCase()));

    const uniqueSerials = [...new Set(validSerials)];
    const newSerials = uniqueSerials.filter(
      (s) => !existingVals.has(s.toLowerCase()),
    );

    if (newSerials.length === 0) {
      throw new Error(
        'All provided serial numbers already exist in this report.',
      );
    }

    if (this.canUseNetwork && !reportId.startsWith('local-ir-')) {
      try {
        await firstValueFrom(
          this.http.post(
            `${environment.apiUrl}/inspection-reports/${reportId}/serial-numbers`,
            {
              items: newSerials.map((serial) => ({
                clientRef: crypto.randomUUID(),
                serialNumber: serial,
              })),
            },
          ),
        );

        this.connectivity.markApiReachable();
        await this.pullAllAndCache();
        await this.enqueueChildSync(reportId);
        return;
      } catch (error) {
        if (!this.isOfflineError(error)) {
          throw error;
        }

        this.connectivity.markApiUnreachable();
      }
    }

    const itemsPayload: { clientRef: string; serialNumber: string }[] = [];

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

  public async renameSerialNumber(
    id: string,
    newSerial: string,
  ): Promise<void> {
    const sn = await this.snRepo.getById(id);
    if (!sn) throw new Error('Serial number not found locally');

    const trimmed = newSerial.trim();
    const existingSns = await this.snRepo.listByReportId(sn.inspectionReportId);
    if (
      existingSns.some(
        (s) => s.id !== id && s.value.toLowerCase() === trimmed.toLowerCase(),
      )
    ) {
      throw new Error(
        `Serial number '${trimmed}' already exists in this report.`,
      );
    }

    if (this.canUseNetwork && !id.startsWith('local-sn-')) {
      try {
        const updateRes = await firstValueFrom(
          this.http.patch<{ serialNumber: string; [key: string]: unknown }>(
            `${environment.apiUrl}/serial-numbers/${id}`,
            { serialNumber: trimmed, version: sn.version },
          ),
        );

        this.connectivity.markApiReachable();
        await this.snRepo.upsert(this.mapServerSerialUpdate(sn, updateRes));
        return;
      } catch (error) {
        if (!this.isOfflineError(error)) {
          throw error;
        }

        this.connectivity.markApiUnreachable();
      }
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
  }

  public async saveSerialNumberInspection(
    id: string,
    inspectionJson: Record<string, unknown>,
  ): Promise<void> {
    const sn = await this.snRepo.getById(id);
    if (!sn) throw new Error('Serial number not found locally');

    if (this.canUseNetwork && !id.startsWith('local-sn-')) {
      try {
        const updateRes = await firstValueFrom(
          this.http.patch<{ serialNumber: string; [key: string]: unknown }>(
            `${environment.apiUrl}/serial-numbers/${id}`,
            { inspectionData: inspectionJson, version: sn.version },
          ),
        );

        this.connectivity.markApiReachable();
        await this.snRepo.upsert(this.mapServerSerialUpdate(sn, updateRes));
        await this.enqueueChildSync(sn.inspectionReportId);
        return;
      } catch (error) {
        if (!this.isOfflineError(error)) {
          throw error;
        }

        this.connectivity.markApiUnreachable();
      }
    }

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

  public async deleteSerialNumber(id: string): Promise<void> {
    const sn = await this.snRepo.getById(id);
    if (!sn) throw new Error('Serial number not found locally');

    if (this.canUseNetwork && !id.startsWith('local-sn-')) {
      try {
        await firstValueFrom(
          this.http.delete(`${environment.apiUrl}/serial-numbers/${id}`),
        );

        this.connectivity.markApiReachable();
        await this.snRepo.delete(id);
        await this.enqueueChildSync(sn.inspectionReportId);
        return;
      } catch (error) {
        if (!this.isOfflineError(error)) {
          throw error;
        }

        this.connectivity.markApiUnreachable();
      }
    }

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

    await this.enqueueChildSync(sn.inspectionReportId);
  }

  public async submitApprovalBatch(
    reportId: string,
    serialNumberIds: string[],
    childReportId?: string,
  ): Promise<void> {
    if (this.canUseNetwork) {
      const rep = await this.irRepo.getById(reportId);
      if (!rep) throw new Error('Report not found');

      try {
        await firstValueFrom(
          this.http.post<Record<string, unknown>>(
            `${environment.apiUrl}/inspection-reports/${reportId}/approval-batches`,
            {
              serialNumberIds,
              reportVersion: rep.version,
              childReportId,
            },
          ),
        );
        // Refresh local cache with server state
        await this.pullBatchesForReport(reportId);
        await this.pullAllAndCache();
        return;
      } catch (err) {
        console.error(
          'Direct batch submission failed, falling back to offline',
          err,
        );
      }
    }
    return this.queueApprovalBatchSubmission(
      reportId,
      serialNumberIds,
      childReportId,
    );
  }

  public async queueApprovalBatchSubmission(
    reportId: string,
    serialNumberIds: string[],
    childReportId?: string,
  ): Promise<void> {
    const rep = await this.irRepo.getById(reportId);
    if (!rep) throw new Error('Report not found');

    const batchId = 'local-batch-' + crypto.randomUUID();
    const profile = this.session.profile();

    const newBatch: LocalInspectionApprovalBatch = {
      id: batchId,
      tenantId: profile?.tenantId || '',
      inspectionReportId: reportId,
      childReportId: childReportId || null,
      submittedByUserId: profile?.id || '',
      submittedAt: new Date().toISOString(),
      status: 'SUBMITTED',
      version: 1,
      syncState: 'PENDING',
    };

    await this.approvalBatchRepo.upsert(newBatch);

    const bSns: LocalBatchSerialNumber[] = serialNumberIds.map((snId) => ({
      id: 'local-bsn-' + crypto.randomUUID(),
      inspectionApprovalBatchId: batchId,
      serialNumberId: snId,
      status: 'PENDING',
    }));

    await this.batchSnRepo.bulkUpsert(bSns);

    await this.outbox.enqueue({
      id: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      entityType: ENTITY_TYPES.APPROVAL_BATCH,
      entityId: batchId,
      operation: 'SUBMIT',
      payload: {
        inspectionReportId: reportId,
        serialNumberIds,
        reportVersion: rep.version,
        childReportId,
      },
      status: 'PENDING',
      attemptCount: 0,
      lastError: null,
    });

    if (childReportId) {
      const childReport = await this.crRepo.getById(childReportId);
      if (childReport) {
        const updatedSerials = childReport.serialNumbers.map((serial) =>
          serialNumberIds.includes(serial.id)
            ? {
                ...serial,
                approvalStatus: SERIAL_STATUSES.SUBMITTED_FOR_APPROVAL,
              }
            : serial,
        );

        const allSubmitted = updatedSerials.every(
          (serial) =>
            serial.approvalStatus === SERIAL_STATUSES.SUBMITTED_FOR_APPROVAL ||
            serial.approvalStatus === SERIAL_STATUSES.APPROVED,
        );

        let newStatus = childReport.status;
        if (
          allSubmitted &&
          childReport.status === CHILD_REPORT_STATUSES.IN_INSPECTION
        ) {
          newStatus = CHILD_REPORT_STATUSES.PENDING_APPROVAL;
        }

        await this.crRepo.upsert({
          ...childReport,
          serialNumbers: updatedSerials,
          status: newStatus,
          syncState: 'PENDING',
          updatedAt: new Date().toISOString(),
        });
      }
    } else {
      for (const snId of serialNumberIds) {
        const sn = await this.snRepo.getById(snId);
        if (sn) {
          await this.snRepo.upsert({
            ...sn,
            approvalStatus: SERIAL_STATUSES.SUBMITTED_FOR_APPROVAL,
            syncState: 'PENDING',
          });
        }
      }
    }

    await this.refreshLocalCache();
  }

  public async approveBatch(
    batchId: string,
    serialNumberIds?: string[],
  ): Promise<void> {
    if (this.canUseNetwork) {
      const batch = await this.approvalBatchRepo.getById(batchId);
      if (batch && !batch.id.startsWith('local-')) {
        const rep = await this.irRepo.getById(batch.inspectionReportId);
        if (rep) {
          try {
            await firstValueFrom(
              this.http.post<Record<string, unknown>>(
                `${environment.apiUrl}/inspection-reports/${batch.inspectionReportId}/approval-batches/${batchId}/approve`,
                {
                  batchVersion: batch.version,
                  reportVersion: rep.version,
                  serialNumberIds,
                },
              ),
            );
            await this.pullBatchesForReport(batch.inspectionReportId);
            await this.pullAllAndCache();
            return;
          } catch (err) {
            console.error(
              'Direct batch approval failed, falling back to offline',
              err,
            );
          }
        }
      }
    }
    return this.queueBatchApproval(batchId, serialNumberIds);
  }

  public async queueBatchApproval(
    batchId: string,
    serialNumberIds?: string[],
  ): Promise<void> {
    const batch = await this.approvalBatchRepo.getById(batchId);
    if (!batch) throw new Error('Batch not found');

    const rep = await this.irRepo.getById(batch.inspectionReportId);
    if (!rep) throw new Error('Report not found');

    await this.outbox.enqueue({
      id: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      entityType: ENTITY_TYPES.APPROVAL_BATCH,
      entityId: batchId,
      operation: 'APPROVE',
      payload: {
        batchVersion: batch.version,
        reportVersion: rep.version,
        serialNumberIds,
      },
      status: 'PENDING',
      attemptCount: 0,
      lastError: null,
    });

    const batchSns = await this.batchSnRepo.listByBatchId(batchId);
    const selectedIds =
      serialNumberIds && serialNumberIds.length > 0
        ? serialNumberIds
        : batchSns.map((member) => member.serialNumberId);
    const targetSnIds = await this.filterPendingBatchSerials(
      batch,
      selectedIds,
    );

    if (targetSnIds.length > 0) {
      await this.updateLocalBatchSerialStatuses(
        batch,
        targetSnIds,
        SERIAL_STATUSES.APPROVED,
      );

      const toUpsertLinks = batchSns
        .filter((member) => targetSnIds.includes(member.serialNumberId))
        .map((member) => ({
          ...member,
          status: 'APPROVED' as const,
        }));
      await this.batchSnRepo.bulkUpsert(toUpsertLinks);
    }

    const allMembers = await this.batchSnRepo.listByBatchId(batchId);
    const pendingMembers = await this.filterPendingBatchSerials(
      batch,
      allMembers.map((member) => member.serialNumberId),
    );
    const allProcessed = pendingMembers.length === 0;

    if (allProcessed) {
      batch.status = BATCH_STATUSES.APPROVED;
      await this.approvalBatchRepo.upsert(batch);
    }

    await this.refreshLocalCache();
    await this.checkAndAutoApproveReport(batch.inspectionReportId);
  }

  public async returnBatch(
    batchId: string,
    reason: string,
    serialNumberIds?: string[],
  ): Promise<void> {
    if (this.canUseNetwork) {
      const batch = await this.approvalBatchRepo.getById(batchId);
      if (batch && !batch.id.startsWith('local-')) {
        const rep = await this.irRepo.getById(batch.inspectionReportId);
        if (rep) {
          try {
            await firstValueFrom(
              this.http.post<Record<string, unknown>>(
                `${environment.apiUrl}/inspection-reports/${batch.inspectionReportId}/approval-batches/${batchId}/return`,
                {
                  reason,
                  batchVersion: batch.version,
                  reportVersion: rep.version,
                  serialNumberIds,
                },
              ),
            );
            await this.pullBatchesForReport(batch.inspectionReportId);
            await this.pullAllAndCache();
            return;
          } catch (err) {
            console.error(
              'Direct batch return failed, falling back to offline',
              err,
            );
          }
        }
      }
    }
    return this.queueBatchReturn(batchId, reason, serialNumberIds);
  }

  public async queueBatchReturn(
    batchId: string,
    reason: string,
    serialNumberIds?: string[],
  ): Promise<void> {
    const batch = await this.approvalBatchRepo.getById(batchId);
    if (!batch) throw new Error('Batch not found');

    const rep = await this.irRepo.getById(batch.inspectionReportId);
    if (!rep) throw new Error('Report not found');

    await this.outbox.enqueue({
      id: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      entityType: ENTITY_TYPES.APPROVAL_BATCH,
      entityId: batchId,
      operation: 'RETURN',
      payload: {
        reason,
        batchVersion: batch.version,
        reportVersion: rep.version,
        serialNumberIds,
      },
      status: 'PENDING',
      attemptCount: 0,
      lastError: null,
    });

    const batchSns = await this.batchSnRepo.listByBatchId(batchId);
    const selectedIds =
      serialNumberIds && serialNumberIds.length > 0
        ? serialNumberIds
        : batchSns.map((member) => member.serialNumberId);
    const targetSnIds = await this.filterPendingBatchSerials(
      batch,
      selectedIds,
    );

    if (targetSnIds.length > 0) {
      await this.updateLocalBatchSerialStatuses(
        batch,
        targetSnIds,
        SERIAL_STATUSES.INSPECTED_DRAFT,
      );

      const toUpsertLinks = batchSns
        .filter((member) => targetSnIds.includes(member.serialNumberId))
        .map((member) => ({
          ...member,
          status: 'RETURNED' as const,
        }));
      await this.batchSnRepo.bulkUpsert(toUpsertLinks);
    }

    const allMembers = await this.batchSnRepo.listByBatchId(batchId);
    const pendingMembers = await this.filterPendingBatchSerials(
      batch,
      allMembers.map((member) => member.serialNumberId),
    );
    const allProcessed = pendingMembers.length === 0;

    if (allProcessed) {
      batch.status = BATCH_STATUSES.RETURNED;
      batch.notes = reason;
      await this.approvalBatchRepo.upsert(batch);
    }

    await this.refreshLocalCache();
  }

  private async filterPendingBatchSerials(
    batch: LocalInspectionApprovalBatch,
    serialNumberIds: string[],
  ): Promise<string[]> {
    if (batch.childReportId) {
      const childReport = await this.crRepo.getById(batch.childReportId);
      if (!childReport) {
        return [];
      }

      return childReport.serialNumbers
        .filter(
          (serial) =>
            serialNumberIds.includes(serial.id) &&
            serial.approvalStatus === SERIAL_STATUSES.SUBMITTED_FOR_APPROVAL,
        )
        .map((serial) => serial.id);
    }

    const pendingIds: string[] = [];
    for (const serialId of serialNumberIds) {
      const serial = await this.snRepo.getById(serialId);
      if (
        serial &&
        serial.approvalStatus === SERIAL_STATUSES.SUBMITTED_FOR_APPROVAL
      ) {
        pendingIds.push(serialId);
      }
    }

    return pendingIds;
  }

  private async updateLocalBatchSerialStatuses(
    batch: LocalInspectionApprovalBatch,
    serialNumberIds: string[],
    targetStatus:
      | typeof SERIAL_STATUSES.APPROVED
      | typeof SERIAL_STATUSES.INSPECTED_DRAFT,
  ): Promise<void> {
    if (batch.childReportId) {
      const childReport = await this.crRepo.getById(batch.childReportId);
      if (!childReport) {
        return;
      }

      const updatedSerials = childReport.serialNumbers.map((serial) =>
        serialNumberIds.includes(serial.id)
          ? { ...serial, approvalStatus: targetStatus }
          : serial,
      );

      await this.crRepo.upsert({
        ...childReport,
        serialNumbers: updatedSerials,
        syncState: 'PENDING',
        updatedAt: new Date().toISOString(),
      });
      return;
    }

    for (const serialId of serialNumberIds) {
      const serial = await this.snRepo.getById(serialId);
      if (!serial) {
        continue;
      }

      await this.snRepo.upsert({
        ...serial,
        approvalStatus: targetStatus,
        syncState: 'PENDING',
      });
    }
  }

  public async publishReport(reportId: string): Promise<void> {
    const rep = await this.irRepo.getById(reportId);
    if (!rep) throw new Error('Report not found');

    if (this.canUseNetwork && !reportId.startsWith('local-ir-')) {
      try {
        const updatedReport = await firstValueFrom(
          this.http.patch<LocalInspectionReport>(
            `${environment.apiUrl}/inspection-reports/${reportId}`,
            {
              status: REPORT_STATUSES.APPROVED,
              version: rep.version,
            },
          ),
        );

        this.connectivity.markApiReachable();
        await this.irRepo.upsert({ ...updatedReport, syncState: 'SYNCED' });
        await this.refreshLocalCache();
        return;
      } catch (error) {
        if (!this.isOfflineError(error)) {
          throw error;
        }

        this.connectivity.markApiUnreachable();
      }
    }

    await this.outbox.enqueue({
      id: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      entityType: ENTITY_TYPES.INSPECTION_REPORT,
      entityId: reportId,
      operation: 'UPDATE_STATUS',
      payload: {
        status: REPORT_STATUSES.APPROVED,
        version: rep.version,
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
    void reportId;
  }

  private isOfflineError(error: unknown): boolean {
    return error instanceof HttpErrorResponse && error.status === 0;
  }

  /**
   * Upload a file as an attachment on the parent inspection report. Online-only:
   * throws {@link AttachmentUploadOfflineError} when offline (a typed condition
   * the UI can pre-empt, rather than a raw string surfaced after the click). On
   * success the new attachment is merged into the locally-cached report so other
   * views reflect it, and the created attachment is returned.
   */
  public async uploadAttachment(
    reportId: string,
    file: File,
  ): Promise<Attachment> {
    if (!this.canUseNetwork) {
      throw new AttachmentUploadOfflineError();
    }

    const formData = new FormData();
    formData.append('file', file);

    const attachment = await firstValueFrom(
      this.http.post<Attachment>(
        `${environment.apiUrl}/inspection-reports/${reportId}/attachments`,
        formData,
      ),
    );

    this.connectivity.markApiReachable();

    const existing = await this.irRepo.getById(reportId);
    if (existing) {
      await this.irRepo.upsert({
        ...existing,
        attachments: [...(existing.attachments ?? []), attachment],
      });
    }

    return attachment;
  }

  /**
   * Fetch an attachment's bytes through HttpClient so the JWT interceptor
   * applies — the `/api/files/attachments/:id` endpoint is auth-guarded, so a
   * bare `<img src>`/`<a href>` (no Authorization header) would 401. Callers turn
   * the returned Blob into an object URL for a thumbnail or a download.
   */
  public fetchAttachmentBlob(attachmentId: string): Promise<Blob> {
    return firstValueFrom(
      this.http.get(
        `${environment.apiUrl}/api/files/attachments/${attachmentId}`,
        { responseType: 'blob' },
      ),
    );
  }
}
