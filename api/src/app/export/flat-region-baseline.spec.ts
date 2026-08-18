/**
 * Region path byte-unchanged proof (DB-free, engine-level, ADR-0005 structural).
 *
 * The flat-template engine change (region-optional engineMap) must NOT perturb the
 * existing single-region drill-pipe export. "The suites still pass" is not enough —
 * per the design doc §2b we pin the region export to a FROZEN canon captured from the
 * pre-change engine. This spec exports the REAL drill-pipe workbook + REAL definition
 * through `engineMap` and asserts the structural canon deep-equals that committed
 * baseline. The baseline is deterministic (frozenHeader → fixed reportNumber, reportDate
 * 'N/A') so it is machine-independent; canon() excludes docProps/ZIP timestamps by
 * construction.
 *
 * FREEZE PROTOCOL: the fixture was written by running this spec ONCE against the
 * un-edited engine (write-if-missing below). Every subsequent run asserts against it.
 * To re-baseline intentionally, delete the fixture and re-run on known-good code.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { SerialDisposition } from '@prisma/client';
import { engineMap, ExportDefinition } from './export-engine';
import { InspectionData } from '../common/inspection-data.types';
import {
  canon,
  frozenSnapshot,
  makeSerial,
  SheetCanon,
} from './flat-proof.testutil';
import * as ExcelJS from 'exceljs';

const TEMPLATE_PATH = resolve(__dirname, '../../../scripts/valid-template.xlsx');
const DEF_PATH = resolve(
  __dirname,
  '../template/definitions/drill-pipe-v1.definition.json',
);
const BASELINE_PATH = resolve(
  __dirname,
  '__fixtures__/region-export.canon.baseline.json',
);

const DEF = JSON.parse(readFileSync(DEF_PATH, 'utf8')) as ExportDefinition;
const clone = (): ExportDefinition =>
  JSON.parse(JSON.stringify(DEF)) as ExportDefinition;

/** Two serials with distinct, fully-populated row data → non-empty region rows. */
function row(seed: string): InspectionData {
  return {
    box: {
      minTongSpace: `${seed}-bts`,
      minOD: `${seed}-bod`,
      minBoxThreads: `${seed}-bthd`,
      minEccShoulder: `${seed}-becc`,
      maxCounterBoreDiameter: `${seed}-bcbd`,
      maxCounterBoreLength: `${seed}-bcbl`,
      bevelDiameterMin: `${seed}-bmin`,
      bevelDiameterMax: `${seed}-bmax`,
      condition: `${seed}-bcond`,
      hardBanding: `${seed}-bhard`,
    },
    pin: {
      minTongSpace: `${seed}-pts`,
      minOD: `${seed}-pod`,
      maxID: `${seed}-pid`,
      minEccShoulder: `${seed}-pecc`,
      lengthPinConnMin: `${seed}-pcmin`,
      lengthPinConnMax: `${seed}-pcmax`,
      maxLengthPinBase: `${seed}-pbase`,
      bevelDiameterMin: `${seed}-pbmin`,
      bevelDiameterMax: `${seed}-pbmax`,
      condition: `${seed}-pcond`,
    },
    body: {
      wallRemaining: `${seed}-wall`,
      odDecrease: `${seed}-od`,
      emiResult: SerialDisposition.PASS,
      slipArea: `${seed}-slip`,
      corrosionIn: true,
      corrosionOut: false,
      ipc: true,
      bentJoints: false,
    },
    final: {
      isNew: true,
      isPremium: false,
      isC2: true,
      isScrap: false,
      condition_notes: `${seed}-notes`,
    },
    remarks: `${seed}-remarks`,
  };
}

async function exportRegionCanon(def: ExportDefinition): Promise<SheetCanon[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    readFileSync(TEMPLATE_PATH) as unknown as ArrayBuffer,
  );
  const snapshot = frozenSnapshot();
  const chunk = [makeSerial('SN-001', row('a')), makeSerial('SN-002', row('b'))];
  await engineMap(def, workbook, snapshot, chunk);
  const buffer = (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
  return canon(Buffer.from(buffer));
}

describe('Region export — frozen structural baseline (engine, no DB)', () => {
  it('the real drill-pipe region export matches the pre-change frozen canon', async () => {
    const current = await exportRegionCanon(DEF);

    if (!existsSync(BASELINE_PATH)) {
      // FREEZE (run once on the un-edited engine). Captures the pre-change canon.
      mkdirSync(dirname(BASELINE_PATH), { recursive: true });
      writeFileSync(BASELINE_PATH, JSON.stringify(current, null, 2) + '\n');
      // eslint-disable-next-line no-console
      console.warn(`[baseline] wrote frozen canon → ${BASELINE_PATH}`);
      return;
    }

    const frozen = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as SheetCanon[];
    expect(current).toEqual(frozen);
  });

  it('non-vacuity: a token-mapping mutation diverges from the frozen baseline', async () => {
    // Guard the pin isn't vacuous: corrupt a region cell's source field and prove
    // the canon no longer equals the frozen baseline. If this passed, the baseline
    // would be too coarse to detect a real region regression.
    if (!existsSync(BASELINE_PATH)) return; // nothing to compare against on the freeze run
    const frozen = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as SheetCanon[];

    const mutant = clone();
    const entry = mutant.export.regions['serials'].find(
      (e) => e.token === '{{b_od}}',
    )!;
    entry.field = 'box.doesNotExist'; // resolves '' instead of the real box.minOD

    const mutated = await exportRegionCanon(mutant);
    expect(mutated).not.toEqual(frozen);
  });
});
