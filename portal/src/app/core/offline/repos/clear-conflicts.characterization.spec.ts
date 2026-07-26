/**
 * Characterization tests — risk #2 (`clearConflicts` over-deletion).
 * Pins the cursor sweep in outbox-local.repo.ts:74. See docs/internal/sync-risks.md.
 *
 * This exercises the REAL IndexedDB code path: the real DbService opens the real
 * schema against `fake-indexeddb`, and the real OutboxLocalRepo runs its actual
 * `openCursor()` delete sweep. Nothing about the cursor logic is mocked.
 *
 * fake-indexeddb wiring: imported LOCALLY in this spec (not in the global
 * portal test-setup.ts) so no other spec runs against a patched IndexedDB global,
 * and so each test here gets a pristine IDBFactory (no cross-test DB bleed).
 *
 * WHICH ASSERTIONS ARE EXPECTED TO FLIP IN PHASE 3:
 *   - The "PENDING-with-lastError item is deleted" assertions are the risk #2
 *     over-deletion. They are KNOWN-BUG pins and WILL flip once Phase 3 narrows the
 *     delete condition (drops the `|| item.lastError` clause). They carry the
 *     CHARACTERIZATION comment.
 *   - Deleting CONFLICT/FAILED items, keeping the clean PENDING item, and leaving
 *     the entity stores untouched characterize intended/stable behavior and are
 *     NOT expected to flip.
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { TestBed } from '@angular/core/testing';

// Note: the `structuredClone` polyfill that fake-indexeddb@6 needs under jsdom now
// lives in portal/src/test-setup.ts (shared setup), so it is not repeated here.

import { OutboxItem } from '@portal/core/offline/models/types';
import { LocalCustomer } from '@portal/core/offline/models/types';
import { DbService } from '@portal/core/offline/services/db.service';
import { OutboxLocalRepo } from '@portal/core/offline/repos/outbox-local.repo';
import { CustomerLocalRepo } from '@portal/core/offline/repos/customer-local.repo';

function makeOutboxItem(overrides: Partial<OutboxItem>): OutboxItem {
  return {
    id: 'outbox-x',
    idempotencyKey: 'idem-x',
    createdAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
    entityType: 'CUSTOMER',
    entityId: 'local-cust-x',
    operation: 'CREATE',
    payload: { name: 'x' },
    status: 'PENDING',
    attemptCount: 0,
    lastError: null,
    ...overrides,
  };
}

describe('OutboxLocalRepo.clearConflicts — over-deletion (risk #2)', () => {
  let dbService: DbService;
  let outboxRepo: OutboxLocalRepo;
  let customerRepo: CustomerLocalRepo;

  // The four seed kinds used across tests.
  const conflictItem = makeOutboxItem({
    id: 'it-conflict',
    createdAt: new Date('2026-01-01T00:00:01.000Z').toISOString(),
    status: 'CONFLICT',
    lastError: 'Conflict detected during sync.',
  });
  const failedItem = makeOutboxItem({
    id: 'it-failed',
    createdAt: new Date('2026-01-01T00:00:02.000Z').toISOString(),
    status: 'FAILED',
    lastError: 'Application logic error: 400',
  });
  const pendingWithErrorItem = makeOutboxItem({
    id: 'it-pending-with-error',
    createdAt: new Date('2026-01-01T00:00:03.000Z').toISOString(),
    status: 'PENDING',
    lastError: 'transient network blip', // retryable, but recorded an error
  });
  const cleanPendingItem = makeOutboxItem({
    id: 'it-pending-clean',
    createdAt: new Date('2026-01-01T00:00:04.000Z').toISOString(),
    status: 'PENDING',
    lastError: null,
  });

  beforeEach(async () => {
    // Fresh IndexedDB namespace per test — no databases survive from a prior test.
    const freshFactory = new IDBFactory();
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB =
      freshFactory;
    (window as unknown as { indexedDB: IDBFactory }).indexedDB = freshFactory;

    TestBed.configureTestingModule({});
    dbService = TestBed.inject(DbService);
    outboxRepo = TestBed.inject(OutboxLocalRepo);
    customerRepo = TestBed.inject(CustomerLocalRepo);

    await dbService.openForTenant('test-tenant');
  });

  afterEach(() => {
    dbService.close();
  });

  it('after clearConflicts, only the clean PENDING item survives (CONFLICT, FAILED, and PENDING-with-lastError are all deleted)', async () => {
    await outboxRepo.upsert(conflictItem);
    await outboxRepo.upsert(failedItem);
    await outboxRepo.upsert(pendingWithErrorItem);
    await outboxRepo.upsert(cleanPendingItem);

    await outboxRepo.clearConflicts();

    // Stable: the two error statuses are cleared as intended.
    expect(await outboxRepo.getById('it-conflict')).toBeNull();
    expect(await outboxRepo.getById('it-failed')).toBeNull();

    // CHARACTERIZATION — pins current behavior. KNOWN BUG (risk #2), see docs/internal/sync-risks.md. Phase 3 fix will flip this.
    // The retryable PENDING item is collateral damage of the `|| item.lastError` clause.
    expect(await outboxRepo.getById('it-pending-with-error')).toBeNull();

    // Stable: the clean PENDING item is (correctly) kept.
    const survivor = await outboxRepo.getById('it-pending-clean');
    expect(survivor).not.toBeNull();
    expect(survivor?.status).toBe('PENDING');

    // Current survivor set is exactly one item. (This total flips in Phase 3, when
    // the PENDING-with-lastError item also survives.)
    expect(await outboxRepo.countPendingItems()).toBe(1);
  });

  it('ALSO deletes a still-recoverable PENDING item that merely recorded a transient error (KNOWN BUG: risk #2 over-deletion)', async () => {
    await outboxRepo.upsert(pendingWithErrorItem);
    await outboxRepo.upsert(cleanPendingItem);

    // Precondition: it is genuinely still PENDING (queued/retryable), just carrying
    // a lastError string — not CONFLICT, not FAILED.
    const before = await outboxRepo.getById('it-pending-with-error');
    expect(before?.status).toBe('PENDING');
    expect(before?.lastError).toBeTruthy();

    await outboxRepo.clearConflicts();

    // CHARACTERIZATION — pins current behavior. KNOWN BUG (risk #2), see docs/internal/sync-risks.md. Phase 3 fix will flip this.
    expect(await outboxRepo.getById('it-pending-with-error')).toBeNull();

    // Sanity (stable): the error-free PENDING item is untouched, proving the
    // deletion above is driven by `lastError`, not by being PENDING.
    expect(await outboxRepo.getById('it-pending-clean')).not.toBeNull();
  });

  it('touches only the outbox store — a conflicted entity row is left unchanged', async () => {
    const conflictedCustomer: LocalCustomer = {
      id: 'cust-conf-1',
      name: 'Conflicted Co',
      isActive: true,
      version: 3,
      syncState: 'CONFLICT',
      updatedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
    };

    await customerRepo.upsert(conflictedCustomer);
    await outboxRepo.upsert(conflictItem);

    const entityBefore = await customerRepo.getById('cust-conf-1');

    // Spy on the live DB handle: record every object store any transaction opens
    // during clearConflicts.
    const db = await dbService.getDb();
    const txSpy = jest.spyOn(db, 'transaction');

    await outboxRepo.clearConflicts();

    // Stable: clearConflicts opens transactions on the outbox store ONLY — the
    // customer/entity stores are never opened, let alone written.
    expect(txSpy).toHaveBeenCalled();
    for (const call of txSpy.mock.calls) {
      expect(call[0]).toBe('outbox');
    }
    txSpy.mockRestore();

    // Stable: the conflicted entity row is byte-for-byte unchanged — the local edit
    // is discarded from the outbox, but the entity row is left in CONFLICT, not
    // reverted to server truth and not reset.
    const entityAfter = await customerRepo.getById('cust-conf-1');
    expect(entityAfter).toEqual(entityBefore);
    expect(entityAfter?.syncState).toBe('CONFLICT');

    // And clearConflicts did act on the outbox (the conflict item is gone).
    expect(await outboxRepo.getById('it-conflict')).toBeNull();
  });
});
