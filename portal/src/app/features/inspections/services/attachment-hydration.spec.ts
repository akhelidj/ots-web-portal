/**
 * Behavior spec — attachments are hydrated into the local cache through the pull
 * path, so a read-only consumer (e.g. a customer) sees their documents.
 *
 * The list endpoint (`GET /inspection-reports`) omits attachments; only the
 * per-report detail (`GET /inspection-reports/:id`) includes them. Before this
 * change nothing carried attachments into IndexedDB, so `ReportAttachmentsComponent`
 * — which seeds from `irRepo.getById` — always rendered empty for a report that
 * had server-side attachments. `pullAllAndCache` now fetches the detail per SYNCED
 * report and merges `attachments` into the cached record (offline-first: once
 * pulled, they render offline).
 *
 * Harness mirrors conflict-terminal.spec.ts: real fake-indexeddb + real repos +
 * HttpTestingController, the most faithful pin of "what actually lands in the cache".
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
  Attachment,
  LocalInspectionReport,
} from '@portal/core/offline/models/types';
import { DbService } from '@portal/core/offline/services/db.service';
import { InspectionReportLocalRepo } from '@portal/core/offline/repos/inspection-report-local.repo';
import { ConnectivityService } from '@portal/core/offline/services/connectivity.service';
import { SessionService } from '@portal/core/auth/services/session.service';
import { InspectionReportsService } from '@portal/features/inspections/services/inspection-reports.service';

const REPORTS_URL = `${environment.apiUrl}/inspection-reports`;

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

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

describe('Inspection reports — attachment hydration through the pull path', () => {
  let dbService: DbService;
  let irRepo: InspectionReportLocalRepo;
  let service: InspectionReportsService;
  let httpMock: HttpTestingController;

  // The list-endpoint shape: a report WITHOUT its attachments.
  const listReport: LocalInspectionReport = {
    id: 'ir-1',
    customerId: 'cust-1',
    poNumber: 'PO-1',
    status: 'APPROVED',
    templateKey: 'DRILL_PIPE_REPORT',
    templateVersion: 1,
    templateHash: 'h',
    version: 3,
  };

  const att: Attachment = {
    id: 'att-1',
    filename: 'inspection-note.pdf',
    url: '/api/files/attachments/att-1',
    createdAt: '2026-08-27T00:00:00.000Z',
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

  it('merges attachments from the detail endpoint into the cached report (list payload omits them)', async () => {
    const processing = service.pullAllAndCache();

    (await expectRequest(httpMock, REPORTS_URL)).flush([listReport]);
    (await expectRequest(httpMock, `${REPORTS_URL}/ir-1/serial-numbers`)).flush(
      [],
    );
    // The detail fetch carries the attachments the list omitted.
    (await expectRequest(httpMock, `${REPORTS_URL}/ir-1`)).flush({
      ...listReport,
      attachments: [att],
    });

    await processing;

    const after = await irRepo.getById('ir-1');
    expect(after?.attachments).toEqual([att]);
    // The rest of the record is the SYNCED list truth, untouched.
    expect(after?.syncState).toBe('SYNCED');
    expect(after?.poNumber).toBe('PO-1');
  });

  it('does NOT fetch the detail for a non-SYNCED local row (a PENDING local edit is never clobbered)', async () => {
    // A locally-PENDING report for the same id: it must not be overwritten, and no
    // detail fetch should fire for it. (httpMock.verify() in afterEach enforces the
    // "no detail request" half — an unmatched request would fail the test.)
    await irRepo.upsert({ ...listReport, syncState: 'PENDING' });

    const processing = service.pullAllAndCache();

    (await expectRequest(httpMock, REPORTS_URL)).flush([listReport]);
    (await expectRequest(httpMock, `${REPORTS_URL}/ir-1/serial-numbers`)).flush(
      [],
    );

    await processing;

    const after = await irRepo.getById('ir-1');
    expect(after?.syncState).toBe('PENDING');
    // No attachments hydrated onto a row we deliberately left alone.
    expect(after?.attachments).toBeUndefined();
  });
});
