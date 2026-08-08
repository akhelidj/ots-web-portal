/**
 * Layer A — Phase B2 export VALUE equivalence (unit, exhaustive, no DB).
 *
 * Proves the definition-driven token computation (`engineGlobalTokens` /
 * `engineRowTokens`, fed the REAL committed drill-pipe definition) produces token
 * maps IDENTICAL to the extracted-verbatim legacy computation (`legacyGlobalTokens`
 * / `legacyRowTokens`). This is the fixture-independent proof of the value layer —
 * every transform and edge case (booleans, ranges, coalesce, whenEmpty, the
 * "undefined"/"[object Object]" quirks) is exercised here, including tokens absent
 * from the real .xlsx fixture (so Layer B needn't). Inputs use string scalars, as
 * the live client emits (see inspection-data.types.ts), so both maps are all-strings.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SerialDisposition } from '@prisma/client';
import { InspectionData, Snapshot } from '../common/inspection-data.types';
import {
  legacyGlobalTokens,
  legacyRowTokens,
} from './mappings/drill-pipe-report.v1.mapping';
import {
  engineGlobalTokens,
  engineRowTokens,
  ExportDefinition,
} from './export-engine';

const DEF = JSON.parse(
  readFileSync(
    resolve(__dirname, '../template/definitions/drill-pipe-v1.definition.json'),
    'utf8',
  ),
) as ExportDefinition;

const clone = (): ExportDefinition =>
  JSON.parse(JSON.stringify(DEF)) as ExportDefinition;

function makeHeader(over: Partial<Snapshot['header']> = {}): Snapshot['header'] {
  return {
    id: 'r1',
    poNumber: 'PO-1',
    reportNumber: 'RPT-1',
    status: 'APPROVED' as Snapshot['header']['status'],
    customerId: 'c1',
    createdAt: '2026-01-01T08:00:00Z',
    updatedAt: '2026-02-02T08:00:00Z',
    grade: 'G',
    range: 'R',
    weight: 'W',
    nomWT: 'NWT',
    nomOD: 'NOD',
    nomID: 'NID',
    connection: 'CONN',
    inspectionAddress: 'ADDR',
    standardUsed: 'STD',
    inspectorComment: 'CMT',
    equipmentUsed: null,
    inspectionMethod: null,
    customerName: 'Acme',
    ...over,
  };
}

function makeSnapshot(
  header: Snapshot['header'],
  extras: Partial<Snapshot> = {},
): Snapshot {
  return {
    header,
    template: { key: 'DRILL_PIPE_REPORT', version: 1, hash: 'h', versionId: null },
    serialNumbers: [],
    childReports: [],
    transitionLogs: [],
    ...extras,
  } as Snapshot;
}

function makeSerial(
  serial: string,
  inspectionData?: InspectionData,
): Snapshot['serialNumbers'][number] {
  return {
    id: 's1',
    serial,
    inspectionData,
    disposition: null,
    updatedAt: '2026-01-01T08:00:00Z',
  } as Snapshot['serialNumbers'][number];
}

/** All row fields populated with distinctive string scalars + booleans true. */
function fullRow(): InspectionData {
  return {
    box: {
      minTongSpace: 'a1',
      minOD: 'a2',
      minBoxThreads: 'a3',
      minEccShoulder: 'a4',
      maxCounterBoreDiameter: 'a5',
      maxCounterBoreLength: 'a6',
      bevelDiameterMin: 'a7',
      bevelDiameterMax: 'a8',
      condition: 'a9',
      hardBanding: 'a10',
    },
    pin: {
      minTongSpace: 'b1',
      minOD: 'b2',
      maxID: 'b3',
      minEccShoulder: 'b4',
      lengthPinConnMin: 'b5',
      lengthPinConnMax: 'b6',
      maxLengthPinBase: 'b7',
      bevelDiameterMin: 'b8',
      bevelDiameterMax: 'b9',
      condition: 'b10',
    },
    body: {
      wallRemaining: 'c1',
      odDecrease: 'c2',
      emiResult: SerialDisposition.PASS,
      slipArea: 'c3',
      corrosionIn: true,
      corrosionOut: true,
      ipc: true,
      bentJoints: true,
    },
    final: {
      isNew: true,
      isPremium: true,
      isC2: true,
      isScrap: true,
      condition_notes: 'the-notes',
    },
    remarks: 'top-remarks',
  };
}

const SNAP = makeSnapshot(makeHeader());

// -------------------------------------------------------------------- globals

describe('Layer A — global (header) token equivalence: engine == legacy', () => {
  const g = (h: Snapshot['header'], extras?: Partial<Snapshot>) => {
    const s = makeSnapshot(h, extras);
    return { engine: engineGlobalTokens(DEF, s), legacy: legacyGlobalTokens(s) };
  };

  it('G1 all header fields populated', () => {
    const eqUsed = [
      { name: 'Rig', number: '7' },
      { name: 'Cell' },
      { number: '3' }, // name-less → "undefined" quirk (KNOWN-ISSUES #13)
    ];
    const methods = [
      'MPI',
      { name: 'UT' },
      {} as { name?: string }, // name-less object → "[object Object]" (#14)
    ];
    const { engine, legacy } = g(
      makeHeader({
        equipmentUsed: eqUsed as Snapshot['header']['equipmentUsed'],
        inspectionMethod: methods as Snapshot['header']['inspectionMethod'],
      }),
    );
    expect(engine).toEqual(legacy);
    // lock the deliberately-preserved quirks explicitly
    expect(engine['{{equipment}}']).toBe('Rig #7, Cell, undefined #3');
    expect(engine['{{methods}}']).toBe('MPI, UT, [object Object]');
  });

  it('G2 empty header → whenEmpty fallbacks (N/A / None specified / comment)', () => {
    const { engine, legacy } = g(
      makeHeader({
        customerName: undefined,
        reportNumber: null,
        poNumber: '',
        standardUsed: null,
        inspectionAddress: null,
        grade: null,
        range: null,
        weight: null,
        nomWT: null,
        nomOD: null,
        nomID: null,
        connection: null,
        inspectorComment: null,
        equipmentUsed: [],
        inspectionMethod: [],
        updatedAt: undefined as unknown as string,
        createdAt: undefined as unknown as string,
      }),
    );
    expect(engine).toEqual(legacy);
    expect(engine['{{customer}}']).toBe('N/A');
    expect(engine['{{equipment}}']).toBe('None specified');
    expect(engine['{{methods}}']).toBe('None specified');
    expect(engine['{{inspectorComment}}']).toBe('No comments provided.');
    expect(engine['{{reportDate}}']).toBe('N/A');
  });

  it('G3 reportDate falls back updatedAt → createdAt → N/A', () => {
    const onlyCreated = g(
      makeHeader({ updatedAt: undefined as unknown as string }),
    );
    expect(onlyCreated.engine).toEqual(onlyCreated.legacy);

    const neither = g(
      makeHeader({
        updatedAt: undefined as unknown as string,
        createdAt: undefined as unknown as string,
      }),
    );
    expect(neither.engine).toEqual(neither.legacy);
    expect(neither.engine['{{reportDate}}']).toBe('N/A');
  });

  it('G4 inspectedBy/approvedBy resolved from transition logs + users', () => {
    const extras: Partial<Snapshot> = {
      transitionLogs: [
        { toStatus: 'IN_INSPECTION', userId: 'u1', timestamp: '2026-01-02' },
        { toStatus: 'APPROVED', userId: 'u2', timestamp: '2026-01-05' },
      ] as Snapshot['transitionLogs'],
      users: [
        { id: 'u1', name: 'Ivy Inspector', email: 'ivy@x.co' },
        { id: 'u2', name: null, email: 'sam@x.co' },
      ],
    };
    const { engine, legacy } = g(makeHeader(), extras);
    expect(engine).toEqual(legacy);
    expect(engine['{{inspectedBy}}']).toBe('Ivy Inspector');
    expect(engine['{{approvedBy}}']).toBe('sam@x.co'); // name null → email
  });

  it('G5 no transition logs → injected header names (or N/A)', () => {
    const { engine, legacy } = g(
      makeHeader({ inspectedByName: 'Pre Set', approvedByName: undefined }),
    );
    expect(engine).toEqual(legacy);
    expect(engine['{{inspectedBy}}']).toBe('Pre Set');
    expect(engine['{{approvedBy}}']).toBe('N/A');
  });
});

// ---------------------------------------------------------------------- rows

describe('Layer A — per-row token equivalence: engine == legacy', () => {
  const r = (s: Snapshot['serialNumbers'][number]) => ({
    engine: engineRowTokens(DEF, SNAP, s),
    legacy: legacyRowTokens(s),
  });

  it('R1 fully-populated row (strings + booleans true)', () => {
    const { engine, legacy } = r(makeSerial('SN-1', fullRow()));
    expect(engine).toEqual(legacy);
    expect(engine['{{sn}}']).toBe('SN-1'); // rowSerial source
    expect(engine['{{b_bvl}}']).toBe('a7-a8'); // range compose
    expect(engine['{{corr_in}}']).toBe('1'); // boolFlag true
    expect(engine['{{jc_new}}']).toBe('X'); // boolCheckbox true
    expect(engine['{{remarks}}']).toBe('the-notes'); // coalesce first
  });

  it('R2 empty inspectionData → all row tokens empty (except serial)', () => {
    const { engine, legacy } = r(makeSerial('SN-2', {}));
    expect(engine).toEqual(legacy);
    expect(engine['{{sn}}']).toBe('SN-2');
    expect(engine['{{b_od}}']).toBe('');
    expect(engine['{{jc_new}}']).toBe('');
    expect(engine['{{corr_in}}']).toBe('');
  });

  it('R3 booleans FALSE → boolFlag "" and boolCheckbox "" (not "1"/"X")', () => {
    const d = fullRow();
    d.body!.corrosionIn = false;
    d.body!.corrosionOut = false;
    d.body!.ipc = false;
    d.body!.bentJoints = false;
    d.final!.isNew = false;
    d.final!.isPremium = false;
    d.final!.isC2 = false;
    d.final!.isScrap = false;
    const { engine, legacy } = r(makeSerial('SN-3', d));
    expect(engine).toEqual(legacy);
    expect(engine['{{corr_in}}']).toBe('');
    expect(engine['{{jc_new}}']).toBe('');
  });

  it('R4 range: only-min → "min-", missing → ""', () => {
    const d = fullRow();
    d.box!.bevelDiameterMax = undefined; // only min
    delete d.pin!.bevelDiameterMin; // both effectively gone for p_bvl (min falsy)
    d.pin!.bevelDiameterMax = 'x';
    const { engine, legacy } = r(makeSerial('SN-4', d));
    expect(engine).toEqual(legacy);
    expect(engine['{{b_bvl}}']).toBe('a7-'); // min present, max empty
    expect(engine['{{p_bvl}}']).toBe(''); // min empty → blank
  });

  it('R5 remarks coalesce order: condition_notes → final.remarks → remarks', () => {
    const only2 = fullRow();
    delete only2.final!.condition_notes;
    only2.final!.remarks = 'final-remarks';
    expect(r(makeSerial('a', only2)).engine).toEqual(
      r(makeSerial('a', only2)).legacy,
    );
    expect(engineRowTokens(DEF, SNAP, makeSerial('a', only2))['{{remarks}}']).toBe(
      'final-remarks',
    );

    const only3 = fullRow();
    delete only3.final!.condition_notes;
    expect(engineRowTokens(DEF, SNAP, makeSerial('a', only3))['{{remarks}}']).toBe(
      'top-remarks',
    );

    const none = fullRow();
    delete none.final!.condition_notes;
    delete none.remarks;
    expect(r(makeSerial('a', none)).engine).toEqual(r(makeSerial('a', none)).legacy);
    expect(engineRowTokens(DEF, SNAP, makeSerial('a', none))['{{remarks}}']).toBe('');
  });

  it("R6 '0' and whitespace scalars are kept (truthy ||), not blanked", () => {
    const d = fullRow();
    d.box!.minOD = '0';
    d.box!.minTongSpace = '   ';
    const { engine, legacy } = r(makeSerial('SN-6', d));
    expect(engine).toEqual(legacy);
    expect(engine['{{b_od}}']).toBe('0');
    expect(engine['{{b_ts}}']).toBe('   ');
  });
});

// ----------------------------------------------------------- mutation guard

describe('Layer A — mutation guard (token-map comparison is not vacuous)', () => {
  it('a transform change makes the engine token map diverge', () => {
    const mutant = clone();
    (mutant.transforms.boolCheckbox as { whenTrue: string }).whenTrue = 'Y';
    const s = makeSerial('SN-1', fullRow());
    expect(engineRowTokens(mutant, SNAP, s)).not.toEqual(legacyRowTokens(s));
  });

  it('a token-mapping change makes the engine token map diverge', () => {
    const mutant = clone();
    const entry = mutant.export.regions.serials.find(
      (e) => e.token === '{{b_od}}',
    )!;
    entry.field = 'box.minID'; // no such field → resolves '' vs legacy box.minOD
    const s = makeSerial('SN-1', fullRow());
    expect(engineRowTokens(mutant, SNAP, s)).not.toEqual(legacyRowTokens(s));
  });
});
