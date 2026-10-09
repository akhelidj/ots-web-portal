import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '@app-env/environment';
import { ENTITY_TYPES } from '@portal/core/constants/app.constants';
import {
  LocalChildReport,
  LocalCustomer,
  LocalInspectionApprovalBatch,
  LocalInspectionReport,
  LocalSerialNumber,
  OutboxItem,
} from '@portal/core/offline/models/types';
import { OutboxLocalRepo } from '@portal/core/offline/repos/outbox-local.repo';
import { InspectionReportLocalRepo } from '@portal/core/offline/repos/inspection-report-local.repo';
import { SerialNumberLocalRepo } from '@portal/core/offline/repos/serial-number-local.repo';
import { CustomerLocalRepo } from '@portal/core/offline/repos/customer-local.repo';
import { ChildReportLocalRepo } from '@portal/core/offline/repos/child-report-local.repo';
import { ApprovalBatchLocalRepo } from '@portal/core/offline/repos/approval-batch-local.repo';
import { OutboxService } from '@portal/core/offline/services/outbox.service';
import {
  FieldDifference,
  Side,
  buildMergedPayload,
  diffDocuments,
  rebaseVersion,
} from './conflict-merge';

/** The marker `OutboxService` gives items that were only blocked behind a conflicted one. */
const DEPENDENCY_MARKER = 'Dependency is in CONFLICT';

/** A conflicted queued edit plus the later edits that were blocked behind it. */
export interface ConflictGroup {
  root: OutboxItem;
  dependents: OutboxItem[];
  /** Short human title, e.g. "Report update". */
  title: string;
  /** Whether the user can compare field by field (otherwise: keep server / try again). */
  mergeable: boolean;
}

/** The server's current state of the record, ready to compare against the queued edit. */
export interface ConflictComparison {
  differences: FieldDifference[];
  /** The server document the differences were computed against. */
  serverDoc: Record<string, unknown>;
  serverVersion: number;
  /** The raw server record (used to refresh the local copy). */
  serverRecord: unknown;
}

interface ServerState {
  doc: Record<string, unknown>;
  version: number;
  record: unknown;
}

/** How one kind of queued edit is compared with, and written back to, its record. */
interface MergeAdapter {
  title: string;
  /** What the user's queued edit says, as a document (no version). */
  mine(item: OutboxItem): Record<string, unknown>;
  /** The request body to send once resolved. */
  payload(
    item: OutboxItem,
    merged: Record<string, unknown>,
    server: ServerState,
  ): Record<string, unknown>;
  /** Local copy = server + the chosen edits, still waiting to sync. */
  applyMine(
    item: OutboxItem,
    server: ServerState,
    merged: Record<string, unknown>,
  ): Promise<void>;
}

const without = (
  payload: Record<string, unknown>,
  ...keys: string[]
): Record<string, unknown> => {
  const out = { ...payload };
  for (const k of keys) delete out[k];
  return out;
};

type ServerSerial = {
  id: string;
  serialNumber: string;
  version: number;
  inspectionData?: Record<string, unknown> | null;
  [key: string]: unknown;
};

/**
 * Resolves sync conflicts without losing work. A 409 leaves the user's queued edit parked as
 * CONFLICT; this service lets them (a) take the server's version, (b) keep their edit on top of
 * the server's current version, field by field where the edit is a plain update, or (c) try the
 * edit again. Later edits blocked behind the conflicted one are released, their expected
 * versions shifted to match. Nothing is deleted unless the user chose the server's version.
 */
@Injectable({ providedIn: 'root' })
export class ConflictResolutionService {
  private http = inject(HttpClient);
  private outboxRepo = inject(OutboxLocalRepo);
  private outbox = inject(OutboxService);
  private irRepo = inject(InspectionReportLocalRepo);
  private snRepo = inject(SerialNumberLocalRepo);
  private customerRepo = inject(CustomerLocalRepo);
  private crRepo = inject(ChildReportLocalRepo);
  private batchRepo = inject(ApprovalBatchLocalRepo);

  private readonly adapters: Record<string, MergeAdapter> = {
    [`${ENTITY_TYPES.INSPECTION_REPORT}:UPDATE`]: {
      title: 'Report update',
      mine: (i) => without(i.payload, 'version'),
      payload: (_i, merged, s) => ({ ...merged, version: s.version }),
      applyMine: async (i, s, merged) => {
        const existing = await this.irRepo.getById(i.entityId);
        await this.irRepo.upsert({
          ...(existing ?? {}),
          ...(s.record as LocalInspectionReport),
          ...merged,
          syncState: 'PENDING',
        } as LocalInspectionReport);
      },
    },
    [`${ENTITY_TYPES.SERIAL_NUMBER}:SN_UPDATE_INSPECTION`]: {
      title: 'Serial inspection data',
      mine: (i) => ({ inspectionData: i.payload['inspectionData'] ?? {} }),
      payload: (_i, merged, s) => ({
        inspectionData: merged['inspectionData'] ?? s.doc['inspectionData'],
        version: s.version,
      }),
      applyMine: async (i, s, merged) => {
        const row = this.mapServerSerial(
          await this.snRepo.getById(i.entityId),
          s.record as ServerSerial,
        );
        await this.snRepo.upsert({
          ...row,
          inspectionJson: (merged['inspectionData'] ??
            row.inspectionJson) as Record<string, unknown>,
          // Same convention as an offline edit: the local row is one ahead of the server.
          version: s.version + 1,
          syncState: 'PENDING',
        });
      },
    },
    [`${ENTITY_TYPES.SERIAL_NUMBER}:UPDATE`]: {
      title: 'Serial number',
      mine: (i) => ({ value: i.payload['value'] }),
      payload: (_i, merged, s) => ({
        value: merged['value'] ?? s.doc['value'],
        version: s.version,
      }),
      applyMine: async (i, s, merged) => {
        const row = this.mapServerSerial(
          await this.snRepo.getById(i.entityId),
          s.record as ServerSerial,
        );
        await this.snRepo.upsert({
          ...row,
          value: (merged['value'] ?? row.value) as string,
          version: s.version + 1,
          syncState: 'PENDING',
        });
      },
    },
    [`${ENTITY_TYPES.CUSTOMER}:UPDATE`]: {
      title: 'Customer update',
      mine: (i) => without(i.payload, 'version'),
      payload: (_i, merged, s) => ({ ...merged, version: s.version }),
      applyMine: async (i, s, merged) => {
        const existing = await this.customerRepo.getById(i.entityId);
        await this.customerRepo.upsert({
          ...(existing ?? {}),
          ...(s.record as LocalCustomer),
          ...merged,
          syncState: 'PENDING',
        } as LocalCustomer);
      },
    },
    [`${ENTITY_TYPES.CHILD_REPORT}:UPDATE`]: {
      title: 'Child report update',
      mine: (i) => without(i.payload, 'version'),
      payload: (_i, merged, s) => ({ ...merged, version: s.version }),
      applyMine: async (i, s, merged) => {
        const existing = await this.crRepo.getById(i.entityId);
        await this.crRepo.upsert({
          ...(existing ?? {}),
          ...(s.record as LocalChildReport),
          ...merged,
          syncState: 'PENDING',
        } as LocalChildReport);
      },
    },
  };

  /** The conflicts waiting for a decision, each with the edits queued behind it. */
  public async listGroups(): Promise<ConflictGroup[]> {
    const conflicts = (await this.outboxRepo.getConflictItems()).sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
    const isBlocked = (i: OutboxItem) => i.lastError === DEPENDENCY_MARKER;
    const roots = conflicts.filter((i) => !isBlocked(i));
    const claimed = new Set<string>();

    const groups: ConflictGroup[] = roots.map((root) => {
      const dependents = conflicts.filter(
        (c) =>
          isBlocked(c) &&
          (c.entityId === root.entityId ||
            c.payload['inspectionReportId'] === root.entityId),
      );
      dependents.forEach((d) => claimed.add(d.id));
      return this.toGroup(root, dependents);
    });

    // Defensive: a blocked item whose root is gone must still be resolvable.
    for (const orphan of conflicts.filter(
      (c) => isBlocked(c) && !claimed.has(c.id),
    )) {
      groups.push(this.toGroup(orphan, []));
    }
    return groups;
  }

  /** A short name for the record a conflict is about (best effort, from the local copy). */
  public async recordLabel(group: ConflictGroup): Promise<string> {
    const { entityType, entityId } = group.root;
    try {
      switch (entityType) {
        case ENTITY_TYPES.INSPECTION_REPORT: {
          const r = await this.irRepo.getById(entityId);
          return r ? `Report PO ${r.poNumber}` : 'Report';
        }
        case ENTITY_TYPES.SERIAL_NUMBER: {
          const s = await this.snRepo.getById(entityId);
          return s ? `Serial ${s.value}` : 'Serial number';
        }
        case ENTITY_TYPES.CUSTOMER: {
          const c = await this.customerRepo.getById(entityId);
          return c ? `Customer ${c.name}` : 'Customer';
        }
        case ENTITY_TYPES.CHILD_REPORT: {
          const c = await this.crRepo.getById(entityId);
          return c?.reportNumber
            ? `Child report ${c.reportNumber}`
            : 'Child report';
        }
        default:
          return this.humanize(entityType);
      }
    } catch {
      return this.humanize(entityType);
    }
  }

  /** Fetch the server's current record and diff the user's edit against it. */
  public async compare(group: ConflictGroup): Promise<ConflictComparison> {
    const adapter = this.adapterFor(group.root);
    if (!adapter) {
      throw new Error('This kind of change cannot be compared field by field.');
    }
    const server = await this.fetchServer(group.root);
    return {
      differences: diffDocuments(adapter.mine(group.root), server.doc),
      serverDoc: server.doc,
      serverVersion: server.version,
      serverRecord: server.record,
    };
  }

  /** Take the server's version: the user's edit is dropped, later edits are released. */
  public async keepServer(group: ConflictGroup): Promise<void> {
    await this.dropEdit(group, await this.tryFetchServer(group.root));
  }

  private async dropEdit(
    group: ConflictGroup,
    server: ServerState | null,
  ): Promise<void> {
    await this.applyServerRecord(
      group.root,
      server,
      group.dependents.length > 0,
    );
    await this.outboxRepo.delete(group.root.id);
    await this.release(group, server?.version);
    await this.outbox.rehydrateCount();
  }

  /** Keep the user's edit on top of the server's current version, with the chosen fields. */
  public async keepMine(
    group: ConflictGroup,
    comparison: ConflictComparison,
    choices: Record<string, Side>,
  ): Promise<void> {
    const adapter = this.adapterFor(group.root);
    if (!adapter) throw new Error('This change cannot be merged.');

    const merged = buildMergedPayload(
      comparison.serverDoc,
      comparison.differences,
      choices,
    );
    if (Object.keys(merged).length === 0) {
      // Everything resolved to the server's value: nothing of the edit is left to send.
      await this.dropEdit(group, {
        doc: comparison.serverDoc,
        version: comparison.serverVersion,
        record: comparison.serverRecord,
      });
      return;
    }

    const server: ServerState = {
      doc: comparison.serverDoc,
      version: comparison.serverVersion,
      record: comparison.serverRecord,
    };
    const root = group.root;
    await adapter.applyMine(root, server, merged);
    await this.outboxRepo.upsert({
      ...root,
      idempotencyKey: crypto.randomUUID(),
      payload: adapter.payload(root, merged, server),
      status: 'PENDING',
      attemptCount: 0,
      lastError: null,
    });
    await this.release(group, server.version);
    await this.outbox.rehydrateCount();
  }

  /** Send the edit again unchanged, against the server's current version where it has one. */
  public async retry(group: ConflictGroup): Promise<void> {
    const root = group.root;
    const server = await this.tryFetchServer(root);
    const payload = { ...root.payload };
    if (server && typeof payload['version'] === 'number') {
      payload['version'] = server.version;
    }
    await this.outboxRepo.upsert({
      ...root,
      idempotencyKey: crypto.randomUUID(),
      payload,
      status: 'PENDING',
      attemptCount: 0,
      lastError: null,
    });
    if (server && !this.isTemporaryId(root.entityId)) {
      // The local copy is no longer in CONFLICT; it waits to sync like any queued edit.
      await this.setRowState(root, 'PENDING');
    }
    await this.release(group, server?.version);
    await this.outbox.rehydrateCount();
  }

  // ---------------------------------------------------------------- internals

  private toGroup(root: OutboxItem, dependents: OutboxItem[]): ConflictGroup {
    const adapter = this.adapterFor(root);
    return {
      root,
      dependents,
      title:
        adapter?.title ??
        `${this.humanize(root.entityType)} ${this.humanize(root.operation).toLowerCase()}`,
      mergeable: !!adapter,
    };
  }

  private adapterFor(item: OutboxItem): MergeAdapter | undefined {
    return this.adapters[`${item.entityType}:${item.operation}`];
  }

  private humanize(value: string): string {
    const text = value.replace(/_/g, ' ').toLowerCase();
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  private isTemporaryId(id: string): boolean {
    return id.startsWith('local-');
  }

  /**
   * Release the edits queued behind a resolved conflict. Each expected version is shifted by
   * how far the record's base moved, so the chain of offline edits stays consistent.
   */
  private async release(
    group: ConflictGroup,
    serverVersion: number | undefined,
  ): Promise<void> {
    const oldBase = group.root.payload['version'];
    for (const dep of group.dependents) {
      const payload = { ...dep.payload };
      if (typeof oldBase === 'number' && serverVersion !== undefined) {
        payload['version'] = rebaseVersion(
          payload['version'],
          oldBase,
          serverVersion,
        );
      }
      await this.outboxRepo.upsert({
        ...dep,
        payload,
        status: 'PENDING',
        attemptCount: 0,
        lastError: null,
      });
    }
  }

  private async fetchServer(item: OutboxItem): Promise<ServerState> {
    const api = environment.apiUrl;
    switch (item.entityType) {
      case ENTITY_TYPES.INSPECTION_REPORT: {
        const r = await firstValueFrom(
          this.http.get<LocalInspectionReport>(
            `${api}/inspection-reports/${item.entityId}`,
          ),
        );
        return {
          doc: r as unknown as Record<string, unknown>,
          version: r.version,
          record: r,
        };
      }
      case ENTITY_TYPES.SERIAL_NUMBER: {
        const sn = await this.snRepo.getById(item.entityId);
        const reportId =
          sn?.inspectionReportId ??
          (item.payload['inspectionReportId'] as string | undefined);
        if (!reportId)
          throw new Error("Cannot find this serial number's report.");
        const list = await firstValueFrom(
          this.http.get<ServerSerial[]>(
            `${api}/inspection-reports/${reportId}/serial-numbers`,
          ),
        );
        const found = list.find((s) => s.id === item.entityId);
        if (!found)
          throw new Error('The serial number no longer exists on the server.');
        return {
          doc: {
            value: found.serialNumber,
            inspectionData: found.inspectionData ?? {},
          },
          version: found.version,
          record: found,
        };
      }
      case ENTITY_TYPES.CUSTOMER: {
        const list = await firstValueFrom(
          this.http.get<LocalCustomer[]>(`${api}/customers`),
        );
        const found = list.find((c) => c.id === item.entityId);
        if (!found)
          throw new Error('The customer no longer exists on the server.');
        return {
          doc: found as unknown as Record<string, unknown>,
          version: found.version,
          record: found,
        };
      }
      case ENTITY_TYPES.CHILD_REPORT: {
        const r = await firstValueFrom(
          this.http.get<LocalChildReport>(
            `${api}/child-reports/${item.entityId}`,
          ),
        );
        return {
          doc: r as unknown as Record<string, unknown>,
          version: r.version,
          record: r,
        };
      }
      default:
        throw new Error('No server lookup for this kind of record.');
    }
  }

  /** Like fetchServer, but a missing/unsupported record or a network failure is just `null`. */
  private async tryFetchServer(item: OutboxItem): Promise<ServerState | null> {
    if (this.isTemporaryId(item.entityId)) return null;
    try {
      return await this.fetchServer(item);
    } catch {
      return null;
    }
  }

  private mapServerSerial(
    existing: LocalSerialNumber | undefined,
    server: ServerSerial,
  ): LocalSerialNumber {
    const { serialNumber, inspectionData, ...rest } = server;
    return {
      ...(existing ?? {}),
      ...rest,
      value: serialNumber,
      inspectionJson: (inspectionData ?? undefined) as
        Record<string, unknown> | undefined,
      syncState: 'SYNCED',
    } as unknown as LocalSerialNumber;
  }

  /** Make the local copy equal the server's (or just unstick it when the server is unreachable). */
  private async applyServerRecord(
    item: OutboxItem,
    server: ServerState | null,
    editsStillQueued: boolean,
  ): Promise<void> {
    const state = editsStillQueued ? 'PENDING' : 'SYNCED';
    if (!server) {
      await this.setRowState(item, state);
      return;
    }
    switch (item.entityType) {
      case ENTITY_TYPES.INSPECTION_REPORT: {
        const existing = await this.irRepo.getById(item.entityId);
        await this.irRepo.upsert({
          ...(existing ?? {}),
          ...(server.record as LocalInspectionReport),
          syncState: state,
        });
        break;
      }
      case ENTITY_TYPES.SERIAL_NUMBER: {
        const existing = await this.snRepo.getById(item.entityId);
        await this.snRepo.upsert({
          ...this.mapServerSerial(existing, server.record as ServerSerial),
          syncState: state,
        });
        break;
      }
      case ENTITY_TYPES.CUSTOMER: {
        const existing = await this.customerRepo.getById(item.entityId);
        await this.customerRepo.upsert({
          ...(existing ?? {}),
          ...(server.record as LocalCustomer),
          syncState: state,
        });
        break;
      }
      case ENTITY_TYPES.CHILD_REPORT: {
        const existing = await this.crRepo.getById(item.entityId);
        await this.crRepo.upsert({
          ...(existing ?? {}),
          ...(server.record as LocalChildReport),
          syncState: state,
        });
        break;
      }
      default:
        await this.setRowState(item, state);
    }
  }

  /** Only the sync flag changes; the next pull refreshes a row left SYNCED. */
  private async setRowState(
    item: OutboxItem,
    state: 'PENDING' | 'SYNCED',
  ): Promise<void> {
    switch (item.entityType) {
      case ENTITY_TYPES.INSPECTION_REPORT: {
        const row = await this.irRepo.getById(item.entityId);
        if (row) await this.irRepo.upsert({ ...row, syncState: state });
        break;
      }
      case ENTITY_TYPES.SERIAL_NUMBER: {
        const row = await this.snRepo.getById(item.entityId);
        if (row) await this.snRepo.upsert({ ...row, syncState: state });
        break;
      }
      case ENTITY_TYPES.CUSTOMER: {
        const row = await this.customerRepo.getById(item.entityId);
        if (row) await this.customerRepo.upsert({ ...row, syncState: state });
        break;
      }
      case ENTITY_TYPES.CHILD_REPORT: {
        const row = await this.crRepo.getById(item.entityId);
        if (row) await this.crRepo.upsert({ ...row, syncState: state });
        break;
      }
      case ENTITY_TYPES.APPROVAL_BATCH: {
        const row = await this.batchRepo.getById(item.entityId);
        if (row) {
          await this.batchRepo.upsert({
            ...row,
            syncState: state,
          } as unknown as LocalInspectionApprovalBatch);
        }
        break;
      }
      default:
        break;
    }
  }
}
