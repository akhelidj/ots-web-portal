/**
 * Characterization tests — risk #1 (CONFLICT is terminal).
 * See docs/internal/sync-risks.md.
 *
 * Once a row's syncState is 'CONFLICT', no code path resets it to 'SYNCED':
 *  - hydration's guard `if (!local || local.syncState === 'SYNCED')`
 *    (inspection-reports.service.ts:299/325) skips it, so server truth is fetched
 *    but never written over the conflicted row; and
 *  - the direct online-write path (saveReportUpdates) PATCHes with the stale
 *    local version, which re-409s and rethrows rather than resetting.
 *
 * Seeding: real fake-indexeddb + real repos + HttpTestingController. The observable
 * effect of risk #1 is "the persisted CONFLICT row is left untouched", so we seed a
 * real IndexedDB row and read it back through the real repo — the most faithful pin.
 * (structuredClone polyfill for fake-indexeddb lives in portal/src/test-setup.ts.)
 *
 * WHICH ASSERTIONS ARE EXPECTED TO FLIP IN PHASE 3:
 *   - Test 1's "row stays CONFLICT with its local values, server truth ignored"
 *     assertions are the KNOWN-BUG pins for the stuck-CONFLICT behavior and WILL
 *     flip once Phase 3 makes a conflicted row recoverable. They carry the
 *     CHARACTERIZATION comment.
 *   - Test 2 documents that saveReportUpdates re-409s on a stale version and does
 *     NOT reset CONFLICT->SYNCED. That is correct optimistic concurrency (a stale
 *     PATCH *should* 409); it is a STABLE guard against a Phase 3 refactor mistaking
 *     that path for dead code, and is NOT expected to flip.
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  TestRequest,
} from '@angular/common/http/testing';

import { environment } from '@app-env/environment';
import { LocalInspectionReport } from '@portal/core/offline/models/types';
import { DbService } from '@portal/core/offline/services/db.service';
import { InspectionReportLocalRepo } from '@portal/core/offline/repos/inspection-report-local.repo';
import { ConnectivityService } from '@portal/core/offline/services/connectivity.service';
import { SessionService } from '@portal/core/auth/services/session.service';
import { InspectionReportsService } from '@portal/features/inspections/services/inspection-reports.service';

const REPORTS_URL = `${environment.apiUrl}/inspection-reports`;

/** Drain the microtask chain up to the next macrotask (zoneless-safe). */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Wait for exactly one pending request matching `url`, draining the event loop
 * until it appears. Robust to a variable number of async hops before the request
 * fires (e.g. an IndexedDB read ahead of the HTTP call), so it does not flake
 * under a busier full-suite event loop the way a fixed flush count can.
 */
async function expectRequest(
  httpMock: HttpTestingController,
  url: string,
): Promise<TestRequest> {
  for (let i = 0; i < 50; i++) {
    const matches = httpMock.match(url);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      throw new Error(
        `Expected one request for ${url}, found ${matches.length}`,
      );
    }
    await flush();
  }
  throw new Error(`No request for ${url} after draining the event loop`);
}

describe('Inspection reports — terminal CONFLICT state (risk #1)', () => {
  let dbService: DbService;
  let irRepo: InspectionReportLocalRepo;
  let service: InspectionReportsService;
  let httpMock: HttpTestingController;

  // A locally-conflicted report carrying distinctive local values, so "kept the
  // local values" vs "overwritten by server truth" is unambiguous.
  const conflictLocal: LocalInspectionReport = {
    id: 'ir-1',
    customerId: 'cust-1',
    poNumber: 'LOCAL-PO-KEEP',
    status: 'DRAFT',
    templateKey: 'DRILL_PIPE_REPORT',
    templateVersion: 1,
    templateHash: 'local-hash',
    version: 2,
    inspectorComment: 'local unsynced edit',
    syncState: 'CONFLICT',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  // Fresh server truth for the same id — different in every meaningful field.
  const serverTruth: LocalInspectionReport = {
    id: 'ir-1',
    customerId: 'cust-1',
    poNumber: 'SERVER-PO-DIFFERENT',
    status: 'APPROVED',
    templateKey: 'DRILL_PIPE_REPORT',
    templateVersion: 1,
    templateHash: 'server-hash',
    version: 9,
    inspectorComment: 'server value',
  };

  beforeEach(async () => {
    const freshFactory = new IDBFactory();
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB =
      freshFactory;
    (window as unknown as { indexedDB: IDBFactory }).indexedDB = freshFactory;

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

    dbService = TestBed.inject(DbService);
    irRepo = TestBed.inject(InspectionReportLocalRepo);
    service = TestBed.inject(InspectionReportsService);
    httpMock = TestBed.inject(HttpTestingController);

    await dbService.openForTenant('test-tenant');
  });

  afterEach(() => {
    httpMock.verify();
    dbService.close();
  });

  it('pullAllAndCache does NOT overwrite a locally-CONFLICT row even when the server returns fresh truth — the row stays CONFLICT with its local values (KNOWN BUG: risk #1 terminal CONFLICT)', async () => {
    await irRepo.upsert(conflictLocal);

    const processing = service.pullAllAndCache();

    (await expectRequest(httpMock, REPORTS_URL)).flush([serverTruth]); // fresh truth
    (await expectRequest(httpMock, `${REPORTS_URL}/ir-1/serial-numbers`)).flush(
      [],
    );

    await processing;

    const after = await irRepo.getById('ir-1');

    // CHARACTERIZATION — pins current behavior. KNOWN BUG (risk #1), see docs/internal/sync-risks.md. Phase 3 fix will flip this.
    // Hydration skips the conflicted row, so server truth is discarded and the row
    // is left CONFLICT with its stale local values — the "stuck CONFLICT" state.
    expect(after?.syncState).toBe('CONFLICT');
    expect(after).toEqual(conflictLocal);

    // Explicitly: none of the server's fresh values landed.
    expect(after?.poNumber).toBe('LOCAL-PO-KEEP');
    expect(after?.status).toBe('DRAFT');
    expect(after?.version).toBe(2);
    expect(after?.inspectorComment).toBe('local unsynced edit');
    expect(after?.poNumber).not.toBe(serverTruth.poNumber);
    expect(after?.status).not.toBe(serverTruth.status);
  });

  it('saveReportUpdates on a conflicted row re-409s on the stale version and does NOT reset CONFLICT->SYNCED (stable: documents the dead reset path)', async () => {
    // STABLE characterization — NOT expected to flip. saveReportUpdates has a
    // syncState:'SYNCED' upsert on a successful PATCH, but after a conflict the
    // local version is stale, so the PATCH itself 409s and rethrows before ever
    // reaching that write. This test documents that the path's current effect is
    // "no reset", so a Phase 3 refactor does not mistake it for dead code.
    await irRepo.upsert(conflictLocal);

    let caught: unknown;
    const processing = service
      .saveReportUpdates('ir-1', {
        poNumber: 'attempted-edit-while-conflicted',
      })
      .catch((e: unknown) => {
        caught = e;
      });

    const patchReq = await expectRequest(httpMock, `${REPORTS_URL}/ir-1`);
    expect(patchReq.request.method).toBe('PATCH');
    // The stale local version (2) is sent — this is why the server 409s.
    expect(patchReq.request.body).toEqual({
      poNumber: 'attempted-edit-while-conflicted',
      version: 2,
    });
    patchReq.flush(
      { message: 'version conflict' },
      { status: 409, statusText: 'Conflict' },
    );

    await processing;

    // The 409 is rethrown (not swallowed as an offline error).
    expect((caught as HttpErrorResponse)?.status).toBe(409);

    // No CONFLICT->SYNCED reset: the row is byte-for-byte unchanged, still CONFLICT.
    const after = await irRepo.getById('ir-1');
    expect(after?.syncState).toBe('CONFLICT');
    expect(after).toEqual(conflictLocal);
  });
});
