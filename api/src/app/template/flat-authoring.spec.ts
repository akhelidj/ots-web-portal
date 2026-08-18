/**
 * Flat (region-less) authoring — end to end (unit, no DB) — Phase D flat step 2.
 *
 * Proves the relaxed authoring layer:
 *   - a header-only ops description BUILDS a `regions: []` definition, with item fields
 *     placed as global `source: 'record'` entries (fork #2);
 *   - it PASSES all seven validator checks (incl. the engine dry-run through the flat
 *     resolver);
 *   - it ties into step 1's proven engine: the built definition runs through `engineMap`
 *     and its tokens land at the right cells with maxRow === templateMaxRow (no clone);
 *   - a flat field's value resolves from the RECORD serial's inspectionData, not header
 *     (fork #2, decisive);
 *   - the reachability-flip guards still hold: 2+ regions rejected, a region without a
 *     marker rejected, malformed rejected; and the flat dry-run is non-vacuous.
 */
import * as ExcelJS from 'exceljs';
import { buildDefinition } from './definition-builder';
import { validateDefinition } from './definition-validator';
import {
  CandidateDefinition,
  DefineTemplateDto,
} from './definition-authoring.types';
import { engineMap, ExportDefinition } from '../export/export-engine';
import {
  canon,
  frozenHeader,
  frozenSnapshot,
  makeSerial,
  maxRowOf,
} from '../export/flat-proof.testutil';
import { InspectionData, Snapshot } from '../common/inspection-data.types';

const META = { templateKey: 'CASING_FLAT', templateVersion: 1 };

/** Header-only description: a header metadata field + a record (item) field. NO region. */
function flatDto(): DefineTemplateDto {
  return {
    displayName: 'Flat Casing Report',
    fields: [
      { token: '{{poNumber}}', label: 'PO Number', type: 'text', required: false, scope: 'header' },
      { token: '{{casingWeight}}', label: 'Casing Weight', type: 'text', required: true, scope: 'item', section: 'Body' },
    ],
  };
}

const FLAT_TOKENS: ReadonlySet<string> = new Set(['{{poNumber}}', '{{casingWeight}}']);
const clone = (d: CandidateDefinition): CandidateDefinition =>
  JSON.parse(JSON.stringify(d)) as CandidateDefinition;

/** A header-only workbook: header token at B2, record token at D4, NO marker row. */
async function flatWorkbookBuffer(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Flat');
  ws.getCell('A1').value = 'Casing Report';
  ws.getCell('B2').value = '{{poNumber}}';
  ws.getCell('D4').value = '{{casingWeight}}';
  ws.getCell('A6').value = 'End';
  return Buffer.from((await wb.xlsx.writeBuffer()) as unknown as ArrayBuffer);
}

async function runEngine(
  buffer: Buffer,
  def: ExportDefinition,
  snapshot: Snapshot,
  chunk: Snapshot['serialNumbers'],
) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  await engineMap(def, wb, snapshot, chunk);
  return canon(Buffer.from((await wb.xlsx.writeBuffer()) as unknown as ArrayBuffer));
}

function recordSnapshot(inspectionData: InspectionData, headerOver = {}): Snapshot {
  return frozenSnapshot(frozenHeader(headerOver), {
    serialNumbers: [makeSerial('REC-1', inspectionData)],
  } as Partial<Snapshot>);
}

describe('Flat authoring — build', () => {
  it('builds a region-less definition; item fields become global record entries', () => {
    const def = buildDefinition(META, flatDto());

    expect(def.regions).toEqual([]); // no repeating region
    expect(def.export.regions).toEqual({}); // no row-token export

    // FLAT: every field (header + item scope) → global with source:'record', resolved
    // from the record's inspectionData (step 3b — the report IS one record).
    expect(def.export.global).toContainEqual({
      token: '{{poNumber}}',
      field: 'poNumber',
      source: 'record',
    });
    expect(def.export.global).toContainEqual({
      token: '{{casingWeight}}',
      field: 'casingWeight',
      source: 'record',
    });
    // A flat item field carries no `region` binding (there is no region).
    const item = def.fields.find((f) => f.key === 'casingWeight')!;
    expect(item.scope).toBe('item');
    expect('region' in item).toBe(false);
  });
});

describe('Flat authoring — validate (all seven checks)', () => {
  it('accepts a valid flat definition', () => {
    const def = buildDefinition(META, flatDto());
    expect(validateDefinition(def, FLAT_TOKENS)).toEqual({ ok: true });
  });

  it('still rejects a flat field whose token is absent from the sheet (check 1)', () => {
    const def = buildDefinition(META, flatDto());
    expect(validateDefinition(def, new Set(['{{poNumber}}']))).toMatchObject({
      ok: false,
      check: 'tokens-exist',
    });
  });

  it('still rejects a non-renderable field type (check 2) for a flat definition', () => {
    const def = clone(buildDefinition(META, flatDto()));
    (def.fields[1] as { type: string }).type = 'list';
    expect(validateDefinition(def, FLAT_TOKENS)).toMatchObject({
      ok: false,
      check: 'types-renderable',
    });
  });
});

describe('Flat authoring — ties into step-1 engine', () => {
  it('the built flat definition exports header + record tokens with no rows cloned', async () => {
    const def = buildDefinition(META, flatDto()) as unknown as ExportDefinition;
    const buffer = await flatWorkbookBuffer();
    const before = maxRowOf(await canon(buffer));

    // Both fields live in the record's inspectionData now (step 3b). snapshot.header
    // keeps its default poNumber ('PO-FROZEN'); the record value must win.
    const snapshot = recordSnapshot({
      poNumber: 'PO-9',
      casingWeight: '42.7',
    } as InspectionData);
    const sheets = await runEngine(buffer, def, snapshot, snapshot.serialNumbers);

    expect(sheets[0].cells['B2']).toBe('PO-9'); // flat header token from inspectionData (3b)
    expect(sheets[0].cells['D4']).toBe('42.7'); // record token from inspectionData
    expect(maxRowOf(sheets)).toBe(before); // no clone — flat signature
  });

  it('DECISIVE (fork #2): a flat field resolves from the record store, not header', async () => {
    const def = buildDefinition(META, flatDto()) as unknown as ExportDefinition;
    const buffer = await flatWorkbookBuffer();

    // Put a DIFFERENT value under the same key in the header. If resolution wrongly
    // read header columns, D4 would show FROM-HEADER; fork #2 says it must be the record.
    const snapshot = recordSnapshot(
      { casingWeight: 'FROM-RECORD' } as InspectionData,
      { poNumber: 'PO-9' },
    );
    (snapshot.header as unknown as Record<string, unknown>).casingWeight =
      'FROM-HEADER';

    const sheets = await runEngine(buffer, def, snapshot, snapshot.serialNumbers);
    expect(sheets[0].cells['D4']).toBe('FROM-RECORD'); // value flows from inspectionData
    expect(sheets[0].cells['D4']).not.toBe('FROM-HEADER');
  });
});

describe('Flat authoring — reachability-flip guards intact', () => {
  it('rejects a region WITHOUT a marker (structural, at build)', () => {
    const dto = { ...flatDto(), region: { id: 'serials' } } as unknown as DefineTemplateDto;
    expect(() => buildDefinition(META, dto)).toThrow(/id and a marker/i);
  });

  it('rejects 2+ regions (validator check 6)', () => {
    // A valid single-region candidate, then a second region pushed in.
    const regionDto: DefineTemplateDto = {
      ...flatDto(),
      region: { id: 'serials', marker: '{{sn}}' },
      fields: [{ token: '{{poNumber}}', label: 'PO', type: 'text', required: false, scope: 'header' }],
    };
    const c = clone(buildDefinition(META, regionDto));
    c.regions.push({ id: 'second', label: 'second', marker: '{{sn}}', chunkSize: null });
    expect(validateDefinition(c, new Set(['{{poNumber}}', '{{sn}}']))).toMatchObject({
      ok: false,
      check: 'single-region',
    });
  });

  it('rejects a malformed body (no fields array)', () => {
    expect(() =>
      buildDefinition(META, { displayName: 'x' } as unknown as DefineTemplateDto),
    ).toThrow(/fields/i);
  });

  it('flat dry-run is NON-VACUOUS: a bad flat candidate is rejected by the engine dry-run', () => {
    // Reference an undefined transform on a flat record entry: shallow-valid, but the
    // engine flat resolver (engineFlatTokens → applyTransform) throws → dry-run rejects.
    const c = clone(buildDefinition(META, flatDto()));
    c.export.global
      .find((e) => e.token === '{{casingWeight}}')!.transform = 'noSuchTransform';
    expect(validateDefinition(c, FLAT_TOKENS)).toMatchObject({
      ok: false,
      check: 'engine-dry-run',
    });
    // And the same candidate WITHOUT the corruption is accepted — the check discriminates.
    expect(validateDefinition(buildDefinition(META, flatDto()), FLAT_TOKENS)).toEqual({
      ok: true,
    });
  });
});
