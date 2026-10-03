/**
 * Flat header-field round-trip — Phase D flat step 3b (unit, no DB).
 *
 * Step 3 renders EVERY flat field as a form input, so an inspector can type into a flat
 * HEADER-scope field; the form saves that value into the record serial's inspectionData.
 * But until 3b the builder emitted flat header fields as plain `field` globals, which the
 * engine reads from snapshot.header — so the typed value was silently dropped from the
 * exported file. 3b makes the builder emit `source: 'record'` for EVERY flat field, so
 * render-target and engine-read-source become the same axis and the loop closes.
 *
 * The decisive proof: fill a flat header field into inspectionData, run the REAL
 * engineMap export, and assert the typed value lands in the cell — read from the record,
 * NOT from snapshot.header. This FAILS against the pre-3b builder (header read from
 * snapshot.header) and PASSES after.
 */
import * as ExcelJS from 'exceljs';
import { buildDefinition } from './definition-builder';
import { DefineTemplateDto } from './definition-authoring.types';
import { engineMap, ExportDefinition } from '../export/export-engine';
import {
  canon,
  frozenHeader,
  frozenSnapshot,
  makeSerial,
} from '../export/flat-proof.testutil';
import { InspectionData, Snapshot } from '../common/inspection-data.types';

const META = { templateKey: 'FLAT_ROUNDTRIP', templateVersion: 1 };

/** A flat template whose only field is HEADER-scope (the round-trip gap's subject). */
function flatHeaderDto(): DefineTemplateDto {
  return {
    displayName: 'Flat Round-trip',
    fields: [
      { token: '{{poNumber}}', label: 'PO Number', type: 'text', required: false, scope: 'header' },
    ],
  };
}

/** A header-only workbook: the header token at B2, no marker row. */
async function workbookBuffer(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Flat');
  ws.getCell('A1').value = 'Report';
  ws.getCell('B2').value = '{{poNumber}}';
  ws.getCell('A4').value = 'End';
  return Buffer.from((await wb.xlsx.writeBuffer()) as unknown as ArrayBuffer);
}

async function exportCells(
  def: ExportDefinition,
  snapshot: Snapshot,
): Promise<Record<string, string>> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await workbookBuffer()) as unknown as ArrayBuffer);
  await engineMap(def, wb, snapshot, snapshot.serialNumbers);
  const sheets = await canon(
    Buffer.from((await wb.xlsx.writeBuffer()) as unknown as ArrayBuffer),
  );
  return sheets[0].cells;
}

function record(inspectionData: InspectionData, headerOver = {}): Snapshot {
  return frozenSnapshot(frozenHeader(headerOver), {
    serialNumbers: [makeSerial('REC-1', inspectionData)],
  } as Partial<Snapshot>);
}

describe('Flat header-field round-trip (step 3b)', () => {
  it('builder: EVERY flat field (incl. header-scope) carries source:record', () => {
    const def = buildDefinition(META, flatHeaderDto());
    expect(def.export.global).toContainEqual({
      token: '{{poNumber}}',
      field: 'poNumber',
      source: 'record',
    });
  });

  it('DECISIVE round-trip: a value typed into a flat header field lands in the export', async () => {
    const def = buildDefinition(META, flatHeaderDto()) as unknown as ExportDefinition;
    // Inspector typed 'TYPED-BY-INSPECTOR' → the form saved it into the record's
    // inspectionData. snapshot.header.poNumber stays the stale 'PO-FROZEN'.
    const snap = record({ poNumber: 'TYPED-BY-INSPECTOR' } as InspectionData);
    const cells = await exportCells(def, snap);
    // Pre-3b: B2 read snapshot.header.poNumber ('PO-FROZEN') → the typed value was lost.
    // Post-3b: B2 reads the record's inspectionData → the typed value survives.
    expect(cells['B2']).toBe('TYPED-BY-INSPECTOR');
  });

  it('the value comes from the RECORD, not snapshot.header (discriminator)', async () => {
    const def = buildDefinition(META, flatHeaderDto()) as unknown as ExportDefinition;
    // Same key, DIFFERENT values in the two stores. If the engine wrongly read the
    // header, B2 would show FROM-HEADER; the record store must win for a flat field.
    const snap = record({ poNumber: 'FROM-RECORD' } as InspectionData);
    (snap.header as unknown as Record<string, unknown>).poNumber = 'FROM-HEADER';
    const cells = await exportCells(def, snap);
    expect(cells['B2']).toBe('FROM-RECORD');
    expect(cells['B2']).not.toBe('FROM-HEADER');
  });
});
