/**
 * A PATCH / transition response carries no `definitionJson` (only the list/detail
 * endpoints graft it). Upserting such a record must NOT wipe the cached definition —
 * that made the report's field sections flash "no usable field definition yet".
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { TestBed } from '@angular/core/testing';
import { LocalInspectionReport } from '@portal/core/offline/models/types';
import { DbService } from '@portal/core/offline/services/db.service';
import { InspectionReportLocalRepo } from '@portal/core/offline/repos/inspection-report-local.repo';

const DEF = { templateKey: 'T', templateVersion: 1, sections: [], fields: [] };

function report(
  overrides: Partial<LocalInspectionReport> = {},
): LocalInspectionReport {
  return {
    id: 'ir-1',
    version: 1,
    syncState: 'SYNCED',
    ...overrides,
  } as unknown as LocalInspectionReport;
}

describe('InspectionReportLocalRepo — definitionJson survives definition-less upserts', () => {
  let repo: InspectionReportLocalRepo;
  let dbService: DbService;

  beforeEach(async () => {
    const freshFactory = new IDBFactory();
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB =
      freshFactory;
    (window as unknown as { indexedDB: IDBFactory }).indexedDB = freshFactory;
    TestBed.configureTestingModule({});
    dbService = TestBed.inject(DbService);
    repo = TestBed.inject(InspectionReportLocalRepo);
    await dbService.openForTenant('test-tenant');
  });

  afterEach(() => dbService.close());

  it('keeps the cached definition when the incoming record has none (upsert)', async () => {
    await repo.upsert(report({ definitionJson: DEF }));
    await repo.upsert(report({ version: 2 })); // e.g. a PATCH response
    const stored = await repo.getById('ir-1');
    expect(stored?.version).toBe(2);
    expect(stored?.definitionJson).toEqual(DEF);
  });

  it('keeps the cached definition on bulkUpsert too', async () => {
    await repo.upsert(report({ definitionJson: DEF }));
    await repo.bulkUpsert([report({ version: 3 })]);
    expect((await repo.getById('ir-1'))?.definitionJson).toEqual(DEF);
  });

  it('still honours an explicit definition (incl. null) from the server', async () => {
    await repo.upsert(report({ definitionJson: DEF }));
    await repo.upsert(report({ version: 2, definitionJson: null }));
    expect((await repo.getById('ir-1'))?.definitionJson).toBeNull();
  });
});
