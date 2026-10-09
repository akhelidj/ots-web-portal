/**
 * Tests — the idempotency key is transmitted (KNOWN-ISSUES #3), client-side half. The API
 * half is common/idempotency/idempotency.interceptor.integration.spec.ts.
 *
 * These drive the REAL production path end-to-end at the client boundary:
 *   OutboxService.enqueue -> OutboxService.processQueue -> SyncDispatcherService.dispatch -> HTTP
 * and inspect the actual outgoing request via HttpTestingController. The simplest
 * single-request CREATE path (CUSTOMER:CREATE) is used — CREATE is where the
 * duplicate risk actually bites.
 *
 * Contract: every dispatched request carries the item's key in the Idempotency-Key header,
 * the same key on every retry; queue-status logic (5xx -> PENDING, 4xx -> FAILED) is unchanged.
 *
 * Zoneless note: this suite deliberately avoids fakeAsync/tick (which depend on
 * zone.js). It uses real async and a setTimeout(0) macrotask drain to let the
 * mocked request fire mid-processQueue.
 */
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  TestRequest,
} from '@angular/common/http/testing';

import { environment } from '@app-env/environment';
import { OutboxItem } from '@portal/core/offline/models/types';
import { OutboxService } from '@portal/core/offline/services/outbox.service';
import { SyncDispatcherService } from '@portal/core/offline/services/sync-dispatcher.service';
import { OutboxLocalRepo } from '@portal/core/offline/repos/outbox-local.repo';
import { UserLocalRepo } from '@portal/core/offline/repos/user-local.repo';
import { CustomerLocalRepo } from '@portal/core/offline/repos/customer-local.repo';
import { InspectionReportLocalRepo } from '@portal/core/offline/repos/inspection-report-local.repo';
import { SerialNumberLocalRepo } from '@portal/core/offline/repos/serial-number-local.repo';
import { ChildReportLocalRepo } from '@portal/core/offline/repos/child-report-local.repo';
import { ApprovalBatchLocalRepo } from '@portal/core/offline/repos/approval-batch-local.repo';
import { BatchSerialNumberLocalRepo } from '@portal/core/offline/repos/batch-serial-number-local.repo';
import { SessionService } from '@portal/core/auth/services/session.service';

const CUSTOMERS_URL = `${environment.apiUrl}/customers`;

// A stable, obviously-non-coincidental value so "the key appears nowhere" is
// unambiguous when asserted against the request.
const IDEMPOTENCY_KEY = 'idem-key-0000-4000-8000-000000000001';

/**
 * In-memory stand-in for the IndexedDB-backed OutboxLocalRepo. Implements only
 * the methods that OutboxService.processQueue and SyncDispatcherService.dispatch
 * touch. Clones on read and write to mimic IndexedDB value (structured-clone)
 * semantics, so callers never share a reference with the store.
 */
class FakeOutboxLocalRepo {
  private readonly store = new Map<string, OutboxItem>();

  private clone(item: OutboxItem): OutboxItem {
    // OutboxItem is plain JSON data; a JSON round-trip is an exact deep clone and
    // avoids relying on structuredClone (not exposed as a jsdom global here).
    return JSON.parse(JSON.stringify(item)) as OutboxItem;
  }

  async getById(id: string): Promise<OutboxItem | null> {
    const found = this.store.get(id);
    return found ? this.clone(found) : null;
  }

  async getPendingItems(): Promise<OutboxItem[]> {
    return [...this.store.values()]
      .filter((i) => i.status === 'PENDING')
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      )
      .map((i) => this.clone(i));
  }

  async getConflictItems(): Promise<OutboxItem[]> {
    return [...this.store.values()]
      .filter((i) => i.status === 'CONFLICT')
      .map((i) => this.clone(i));
  }

  async upsert(item: OutboxItem): Promise<void> {
    this.store.set(item.id, this.clone(item));
  }

  async countPendingItems(): Promise<number> {
    return [...this.store.values()].filter((i) => i.status === 'PENDING')
      .length;
  }

  async hasConflictItems(): Promise<boolean> {
    return [...this.store.values()].some((i) => i.status === 'CONFLICT');
  }
}

/** Drain the microtask chain up to the next macrotask (zoneless-safe). */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** A minimal, valid CUSTOMER:CREATE outbox item carrying an idempotency key. */
function makeCustomerCreateItem(): OutboxItem {
  return {
    id: 'outbox-1',
    idempotencyKey: IDEMPOTENCY_KEY,
    createdAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
    entityType: 'CUSTOMER',
    entityId: 'local-cust-1',
    operation: 'CREATE',
    payload: { name: 'Acme Test', code: 'ACME', isActive: true },
    status: 'PENDING',
    attemptCount: 0,
    lastError: null,
  };
}

/**
 * Assert the generated idempotency key is transmitted nowhere in the request:
 * not in the URL, not in any header (name or value), not in the body.
 */
function assertKeySentAsHeaderOnly(req: TestRequest, key: string): void {
  // Transmitted in the Idempotency-Key header...
  expect(req.request.headers.get('Idempotency-Key')).toBe(key);
  // ...and nowhere else: not in the body, not in the URL.
  expect(
    (req.request.body as Record<string, unknown>)?.['idempotencyKey'],
  ).toBe(undefined);
  expect(JSON.stringify(req.request.body ?? {})).not.toContain(key);
  expect(req.request.urlWithParams).not.toContain(key);
}
describe('Offline sync — idempotency key on the wire (risk #3, client-side)', () => {
  let outbox: OutboxService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    const noopRepo = {} as unknown;

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: OutboxLocalRepo, useClass: FakeOutboxLocalRepo },
        // Authenticated session so processQueue is allowed to run.
        {
          provide: SessionService,
          useValue: {
            isAuthenticated: signal(true),
            profile: signal(null),
          },
        },
        // Only CustomerLocalRepo is touched by CUSTOMER:CREATE; getById -> null
        // makes the temporal-id remap a no-op. The rest are inert stubs.
        {
          provide: CustomerLocalRepo,
          useValue: {
            getById: async () => null,
            remapId: async () => undefined,
            upsert: async () => undefined,
            delete: async () => undefined,
          },
        },
        { provide: UserLocalRepo, useValue: noopRepo },
        { provide: InspectionReportLocalRepo, useValue: noopRepo },
        { provide: SerialNumberLocalRepo, useValue: noopRepo },
        { provide: ChildReportLocalRepo, useValue: noopRepo },
        { provide: ApprovalBatchLocalRepo, useValue: noopRepo },
        { provide: BatchSerialNumberLocalRepo, useValue: noopRepo },
        OutboxService,
        SyncDispatcherService,
      ],
    });

    outbox = TestBed.inject(OutboxService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('sends the idempotency key as the Idempotency-Key header on dispatch (and only there)', async () => {
    const item = makeCustomerCreateItem();
    await outbox.enqueue(item);

    const processing = outbox.processQueue();
    await flush(); // let getConflict/getPending/getById resolve and the request fire

    const req = httpMock.expectOne(CUSTOMERS_URL);
    expect(req.request.method).toBe('POST');
    // Body is exactly the payload — the key is a sibling field on the outbox item,
    // and it is not folded into the request anywhere.
    expect(req.request.body).toEqual(item.payload);
    assertKeySentAsHeaderOnly(req, IDEMPOTENCY_KEY);

    req.flush({ id: 'srv-cust-1', ...item.payload, version: 1 });
    await processing;
  });

  it('leaves the item PENDING (stays queued) on a 5xx response', async () => {
    // NOTE: 5xx -> PENDING is correct, stable behavior (transient errors should
    // retry). It is NOT expected to change. It is pinned here because it is the
    // substrate the bug rides on: the retry re-sends with no key.
    const item = makeCustomerCreateItem();
    await outbox.enqueue(item);

    const processing = outbox.processQueue();
    await flush();

    const req = httpMock.expectOne(CUSTOMERS_URL);
    req.flush(
      { message: 'boom' },
      { status: 500, statusText: 'Internal Server Error' },
    );
    await processing;

    const stored = await TestBed.inject(OutboxLocalRepo).getById(item.id);
    expect(stored?.status).toBe('PENDING');
  });

  it('marks the item FAILED on a 4xx in [400,500)', async () => {
    // Stable: a 4xx is terminal -> FAILED. Not expected to change.
    const item = makeCustomerCreateItem();
    await outbox.enqueue(item);

    const processing = outbox.processQueue();
    await flush();

    const req = httpMock.expectOne(CUSTOMERS_URL);
    req.flush(
      { message: 'bad request' },
      { status: 400, statusText: 'Bad Request' },
    );
    await processing;

    const stored = await TestBed.inject(OutboxLocalRepo).getById(item.id);
    expect(stored?.status).toBe('FAILED');
  });

  it('on retry after a 5xx, re-sends the same request with the SAME idempotency key (so the API can replay instead of duplicating)', async () => {
    const item = makeCustomerCreateItem();
    await outbox.enqueue(item);

    // First attempt -> 5xx -> item stays PENDING.
    let processing = outbox.processQueue();
    await flush();
    const req1 = httpMock.expectOne(CUSTOMERS_URL);
    const url1 = req1.request.urlWithParams;
    const body1 = req1.request.body;
    req1.flush('server error', {
      status: 503,
      statusText: 'Service Unavailable',
    });
    await processing;

    const afterFirst = await TestBed.inject(OutboxLocalRepo).getById(item.id);
    expect(afterFirst?.status).toBe('PENDING'); // stable: item is retryable

    // Second attempt (the retry) -> the request the server sees again.
    processing = outbox.processQueue();
    await flush();
    const req2 = httpMock.expectOne(CUSTOMERS_URL);

    // Stable: same target, same payload (this part does NOT change).
    expect(req2.request.method).toBe('POST');
    expect(req2.request.urlWithParams).toBe(url1);
    expect(req2.request.body).toEqual(body1);

    // The same key on both attempts: a 5xx that actually committed server-side is
    // answered from the stored response instead of being executed twice.
    expect(req1.request.headers.get('Idempotency-Key')).toBe(IDEMPOTENCY_KEY);
    assertKeySentAsHeaderOnly(req2, IDEMPOTENCY_KEY);

    req2.flush('server error', {
      status: 503,
      statusText: 'Service Unavailable',
    });
    await processing;
  });
});
