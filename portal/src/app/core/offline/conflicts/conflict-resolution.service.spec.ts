/**
 * Conflict resolution — real fake-indexeddb repos + HttpTestingController.
 * Proves a parked (CONFLICT) edit can be resolved without losing work: keep the server's
 * version, keep mine on top of the server's current version (field by field), or retry.
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  TestRequest,
} from '@angular/common/http/testing';

import { environment } from '@app-env/environment';
import {
  LocalInspectionReport,
  LocalSerialNumber,
  OutboxItem,
} from '@portal/core/offline/models/types';
import { DbService } from '@portal/core/offline/services/db.service';
import { OutboxLocalRepo } from '@portal/core/offline/repos/outbox-local.repo';
import { InspectionReportLocalRepo } from '@portal/core/offline/repos/inspection-report-local.repo';
import { SerialNumberLocalRepo } from '@portal/core/offline/repos/serial-number-local.repo';
import { ConnectivityService } from '@portal/core/offline/services/connectivity.service';
import { SessionService } from '@portal/core/auth/services/session.service';
import { ConflictResolutionService } from './conflict-resolution.service';

const API = environment.apiUrl;
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

async function expectRequest(
  httpMock: HttpTestingController,
  url: string,
): Promise<TestRequest> {
  for (let i = 0; i < 50; i++) {
    const m = httpMock.match(url);
    if (m.length === 1) return m[0] as TestRequest;
    await flush();
  }
  throw new Error(`No request for ${url}`);
}

const item = (over: Partial<OutboxItem>): OutboxItem => ({
  id: 'o1',
  idempotencyKey: 'old-key',
  createdAt: '2026-01-01T00:00:00.000Z',
  entityType: 'INSPECTION_REPORT',
  entityId: 'r1',
  operation: 'UPDATE',
  payload: { poNumber: 'PO-MINE', version: 3 },
  status: 'CONFLICT',
  attemptCount: 1,
  lastError: 'Version conflict',
  ...over,
});

const localReport = (over: Partial<LocalInspectionReport> = {}) =>
  ({
    id: 'r1',
    customerId: 'c1',
    poNumber: 'PO-MINE',
    status: 'IN_INSPECTION',
    templateKey: 'T',
    templateVersion: 1,
    templateHash: 'h',
    version: 3,
    syncState: 'CONFLICT',
    ...over,
  }) as LocalInspectionReport;

describe('ConflictResolutionService', () => {
  let service: ConflictResolutionService;
  let outbox: OutboxLocalRepo;
  let irRepo: InspectionReportLocalRepo;
  let snRepo: SerialNumberLocalRepo;
  let http: HttpTestingController;
  let db: DbService;

  beforeEach(async () => {
    const factory = new IDBFactory();
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = factory;
    (window as unknown as { indexedDB: IDBFactory }).indexedDB = factory;
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ConnectivityService,
          useValue: {
            isOnline: () => true,
            markApiReachable: () => undefined,
            markApiUnreachable: () => undefined,
          },
        },
        {
          provide: SessionService,
          useValue: { isAuthenticated: signal(true), profile: signal(null) },
        },
      ],
    });
    db = TestBed.inject(DbService);
    outbox = TestBed.inject(OutboxLocalRepo);
    irRepo = TestBed.inject(InspectionReportLocalRepo);
    snRepo = TestBed.inject(SerialNumberLocalRepo);
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(ConflictResolutionService);
    await db.openForTenant('t');
  });

  afterEach(() => {
    http.verify();
    db.close();
  });

  describe('listGroups', () => {
    it('groups a conflict with the edits that were blocked behind it', async () => {
      await outbox.upsert(item({}));
      await outbox.upsert(
        item({
          id: 'o2',
          createdAt: '2026-01-01T00:00:05.000Z',
          payload: { poNumber: 'PO-LATER', version: 4 },
          lastError: 'Dependency is in CONFLICT',
        }),
      );
      await outbox.upsert(
        item({ id: 'o3', status: 'PENDING', lastError: null }),
      );
      const groups = await service.listGroups();
      expect(groups).toHaveLength(1);
      expect(groups[0]?.root.id).toBe('o1');
      expect(groups[0]?.dependents.map((d) => d.id)).toEqual(['o2']);
      expect(groups[0]?.mergeable).toBe(true);
      expect(groups[0]?.title).toBe('Report update');
    });

    it('marks operations without a field-level merge as not mergeable', async () => {
      await outbox.upsert(
        item({
          operation: 'TRANSITION',
          payload: { toStatus: 'APPROVED', version: 3 },
        }),
      );
      const [g] = await service.listGroups();
      expect(g?.mergeable).toBe(false);
    });

    it('still surfaces a blocked item whose root is gone', async () => {
      await outbox.upsert(
        item({ id: 'orphan', lastError: 'Dependency is in CONFLICT' }),
      );
      expect(await service.listGroups()).toHaveLength(1);
    });
  });

  describe('compare + keepMine (report update)', () => {
    it('keeps my fields on top of the server version, rebases later edits and mints a new key', async () => {
      await irRepo.upsert(localReport());
      await outbox.upsert(item({}));
      await outbox.upsert(
        item({
          id: 'o2',
          createdAt: '2026-01-01T00:00:05.000Z',
          payload: { reportNumber: 'RN-LATER', version: 4 },
          lastError: 'Dependency is in CONFLICT',
        }),
      );
      const [group] = await service.listGroups();

      const comparing = service.compare(group!);
      (await expectRequest(http, `${API}/inspection-reports/r1`)).flush({
        ...localReport({
          poNumber: 'PO-SERVER',
          version: 7,
          syncState: undefined,
        }),
      });
      const cmp = await comparing;
      expect(cmp.serverVersion).toBe(7);
      expect(cmp.differences.map((d) => d.path)).toEqual([['poNumber']]);

      await service.keepMine(group!, cmp, {});

      const root = await outbox.getById('o1');
      expect(root?.status).toBe('PENDING');
      expect(root?.payload).toEqual({ poNumber: 'PO-MINE', version: 7 });
      expect(root?.idempotencyKey).not.toBe('old-key');
      expect(root?.lastError).toBeNull();

      // Later edit released; its expected version moved with the base (4 + (7 - 3)).
      const later = await outbox.getById('o2');
      expect(later?.status).toBe('PENDING');
      expect(later?.payload['version']).toBe(8);

      const row = await irRepo.getById('r1');
      expect(row?.syncState).toBe('PENDING');
      expect(row?.poNumber).toBe('PO-MINE');
      expect(row?.version).toBe(7);
    });

    it('with every field resolved to the server it behaves like "keep server"', async () => {
      await irRepo.upsert(localReport());
      await outbox.upsert(item({}));
      const [group] = await service.listGroups();
      const comparing = service.compare(group!);
      (await expectRequest(http, `${API}/inspection-reports/r1`)).flush(
        localReport({
          poNumber: 'PO-SERVER',
          version: 7,
          syncState: undefined,
        }),
      );
      const cmp = await comparing;
      const choices = Object.fromEntries(
        cmp.differences.map((d) => [d.id, 'server' as const]),
      );

      await service.keepMine(group!, cmp, choices);

      expect(await outbox.getById('o1')).toBeNull();
      const row = await irRepo.getById('r1');
      expect(row?.poNumber).toBe('PO-SERVER');
      expect(row?.syncState).toBe('SYNCED');
    });
  });

  describe('keepServer', () => {
    it('replaces the local copy with the server record, drops the edit and releases later ones', async () => {
      await irRepo.upsert(localReport());
      await outbox.upsert(item({}));
      await outbox.upsert(
        item({
          id: 'o2',
          createdAt: '2026-01-01T00:00:05.000Z',
          payload: { reportNumber: 'RN', version: 4 },
          lastError: 'Dependency is in CONFLICT',
        }),
      );
      const [group] = await service.listGroups();
      const resolving = service.keepServer(group!);
      (await expectRequest(http, `${API}/inspection-reports/r1`)).flush(
        localReport({
          poNumber: 'PO-SERVER',
          version: 7,
          syncState: undefined,
        }),
      );
      await resolving;

      expect(await outbox.getById('o1')).toBeNull();
      const later = await outbox.getById('o2');
      expect(later?.status).toBe('PENDING');
      expect(later?.payload['version']).toBe(8);
      const row = await irRepo.getById('r1');
      expect(row?.poNumber).toBe('PO-SERVER');
      // A released edit is still queued, so the row is not "clean" yet.
      expect(row?.syncState).toBe('PENDING');
    });

    it('unsticks the row even when the server cannot be reached', async () => {
      await irRepo.upsert(localReport());
      await outbox.upsert(item({}));
      const [group] = await service.listGroups();
      const resolving = service.keepServer(group!);
      (await expectRequest(http, `${API}/inspection-reports/r1`)).flush(
        'down',
        {
          status: 503,
          statusText: 'Service Unavailable',
        },
      );
      await resolving;
      expect(await outbox.getById('o1')).toBeNull();
      expect((await irRepo.getById('r1'))?.syncState).toBe('SYNCED');
    });
  });

  describe('serial inspection data', () => {
    const sn: LocalSerialNumber = {
      id: 's1',
      inspectionReportId: 'r1',
      value: 'SN-1',
      version: 5,
      inspectionJson: { body: { emiResult: 'PASS', note: 'mine' } },
      syncState: 'CONFLICT',
    };
    const serverSn = {
      id: 's1',
      serialNumber: 'SN-1',
      version: 9,
      inspectionData: {
        body: { emiResult: 'REWORK', note: 'mine' },
        extra: { k: 1 },
      },
    };

    it('merges field by field and keeps server-only fields', async () => {
      await snRepo.upsert(sn);
      await outbox.upsert(
        item({
          id: 'o9',
          entityType: 'SERIAL_NUMBER',
          entityId: 's1',
          operation: 'SN_UPDATE_INSPECTION',
          payload: { inspectionData: sn.inspectionJson, version: 5 },
        }),
      );
      const [group] = await service.listGroups();
      const comparing = service.compare(group!);
      (
        await expectRequest(http, `${API}/inspection-reports/r1/serial-numbers`)
      ).flush([serverSn]);
      const cmp = await comparing;
      expect(cmp.differences.map((d) => d.path)).toEqual([
        ['inspectionData', 'body', 'emiResult'],
      ]);

      await service.keepMine(group!, cmp, {});

      const root = await outbox.getById('o9');
      expect(root?.payload).toEqual({
        inspectionData: {
          body: { emiResult: 'PASS', note: 'mine' },
          extra: { k: 1 },
        },
        version: 9,
      });
      const row = await snRepo.getById('s1');
      expect(row?.syncState).toBe('PENDING');
      expect(row?.version).toBe(10);
      expect(row?.inspectionJson).toEqual(root?.payload['inspectionData']);
    });

    it('keeping the server version replaces the local inspection data', async () => {
      await snRepo.upsert(sn);
      await outbox.upsert(
        item({
          id: 'o9',
          entityType: 'SERIAL_NUMBER',
          entityId: 's1',
          operation: 'SN_UPDATE_INSPECTION',
          payload: { inspectionData: sn.inspectionJson, version: 5 },
        }),
      );
      const [group] = await service.listGroups();
      const resolving = service.keepServer(group!);
      (
        await expectRequest(http, `${API}/inspection-reports/r1/serial-numbers`)
      ).flush([serverSn]);
      await resolving;
      const row = await snRepo.getById('s1');
      expect(row?.inspectionJson).toEqual(serverSn.inspectionData);
      expect(row?.version).toBe(9);
      expect(row?.syncState).toBe('SYNCED');
    });
  });

  describe('retry', () => {
    it("re-queues a transition against the server's current version", async () => {
      await irRepo.upsert(localReport());
      await outbox.upsert(
        item({
          operation: 'TRANSITION',
          payload: { toStatus: 'APPROVED', version: 3 },
        }),
      );
      const [group] = await service.listGroups();
      const retrying = service.retry(group!);
      (await expectRequest(http, `${API}/inspection-reports/r1`)).flush(
        localReport({ version: 6, syncState: undefined }),
      );
      await retrying;
      const root = await outbox.getById('o1');
      expect(root?.status).toBe('PENDING');
      expect(root?.payload).toEqual({ toStatus: 'APPROVED', version: 6 });
      expect(root?.idempotencyKey).not.toBe('old-key');
      expect((await irRepo.getById('r1'))?.syncState).toBe('PENDING');
    });

    it('does not look up a record that only exists locally (temporary id)', async () => {
      await outbox.upsert(
        item({
          entityId: 'local-ir-1',
          operation: 'CREATE',
          payload: { poNumber: 'X' },
        }),
      );
      const [group] = await service.listGroups();
      await service.retry(group!);
      http.expectNone(() => true);
      expect((await outbox.getById('o1'))?.status).toBe('PENDING');
    });
  });
});
