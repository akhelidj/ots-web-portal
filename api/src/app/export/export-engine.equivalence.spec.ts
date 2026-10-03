/**
 * Layer A — Phase B2 export VALUE equivalence (unit, exhaustive, no DB).
 *
 * Proves the definition-driven token computation (`engineGlobalTokens` /
 * `engineRowTokens`, fed the REAL committed drill-pipe definition) produces token
 * maps IDENTICAL to a FROZEN GOLDEN — a self-contained, verbatim copy of the
 * (now-retired) legacy drill-pipe token computation, inlined below.
 *
 * INDEPENDENCE (critical): the golden was the legacy `legacyGlobalTokens` /
 * `legacyRowTokens` before the legacy mapper was deleted. Those functions reached
 * into `computed-token-helpers.ts` (`deriveReportDate` / `deriveActors`) — helpers
 * the ENGINE also calls (export-engine.ts COMPUTED). If the golden imported them, a
 * bug in that shared machinery would corrupt BOTH sides and the equivalence would
 * pass vacuously. So the golden inlines its OWN copies of those derivations and
 * shares NO code path with `engineGlobalTokens` / `engineRowTokens`. It is a frozen
 * literal: it never changes when the engine changes.
 *
 * Every transform and edge case (booleans, ranges, coalesce, whenEmpty, the
 * "undefined"/"[object Object]" quirks) is exercised here, including tokens absent
 * from the real .xlsx fixture (so Layer B needn't). Inputs use string scalars, as
 * the live client emits (see inspection-data.types.ts), so both maps are all-strings.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SerialDisposition } from '@prisma/client';
import { InspectionData, Snapshot } from '../common/inspection-data.types';
import {
  engineGlobalTokens,
  engineRowTokens,
  ExportDefinition,
} from './export-engine';

// ============================================================================
// FROZEN GOLDEN — verbatim copy of the retired legacy token computation.
// Self-contained: inlines its own deriveReportDate/deriveActors so it shares no
// helper with the engine path. Do NOT refactor these to call shared machinery —
// their whole value is being an INDEPENDENT oracle. Frozen as of the legacy-export
// retirement; the "undefined"/"[object Object]" quirks (KNOWN-ISSUES #13/#14) are
// preserved deliberately.
// ============================================================================

/** Resolve the 18 global (header) tokens for one snapshot. Frozen golden. */
function goldenGlobalTokens(snapshot: Snapshot): Record<string, string> {
  const h = snapshot.header;

  // Inlined copy of deriveReportDate (NOT the shared helper).
  const reportDate = h.updatedAt
    ? new Date(h.updatedAt).toLocaleDateString()
    : h.createdAt
      ? new Date(h.createdAt).toLocaleDateString()
      : 'N/A';

  const eqNames =
    (h.equipmentUsed || [])
      .map((e) => `${e.name}${e.number ? ' #' + e.number : ''}`)
      .join(', ') || 'None specified';
  const mNames =
    (h.inspectionMethod || [])
      .map((m) => (typeof m === 'string' ? m : m.name || m))
      .join(', ') || 'None specified';

  // Inlined copy of deriveActors (NOT the shared helper).
  let inspectedBy = h.inspectedByName || 'N/A';
  let approvedBy = h.approvedByName || 'N/A';
  const transitionLogs = snapshot.transitionLogs || [];
  if (Array.isArray(transitionLogs) && transitionLogs.length > 0) {
    const asc = [...transitionLogs].sort(
      (a, b) =>
        new Date(a.timestamp ?? 0).getTime() -
        new Date(b.timestamp ?? 0).getTime(),
    );
    const inspectLog = asc.find(
      (l) =>
        l.toStatus === 'IN_INSPECTION' || l.toStatus === 'PENDING_APPROVAL',
    );
    if (inspectLog?.userId) {
      const u = (snapshot.users || []).find((u) => u.id === inspectLog.userId);
      if (u) inspectedBy = u.name || u.email;
    }
    const approveLog = [...asc]
      .reverse()
      .find((l) => l.toStatus === 'APPROVED' || l.toStatus === 'CLOSED');
    if (approveLog?.userId) {
      const u = (snapshot.users || []).find((u) => u.id === approveLog.userId);
      if (u) approvedBy = u.name || u.email;
    }
  }

  return {
    '{{customer}}': h.customerName || 'N/A',
    '{{reportNumber}}': h.reportNumber || 'N/A',
    '{{reportDate}}': reportDate,
    '{{poNumber}}': h.poNumber || 'N/A',
    '{{standardUsed}}': h.standardUsed || 'N/A',
    '{{inspectionAddress}}': h.inspectionAddress || 'N/A',
    '{{grade}}': h.grade || 'N/A',
    '{{range}}': h.range || 'N/A',
    '{{weight}}': h.weight || 'N/A',
    '{{nomWT}}': h.nomWT || 'N/A',
    '{{nomOD}}': h.nomOD || 'N/A',
    '{{nomID}}': h.nomID || 'N/A',
    '{{connection}}': h.connection || 'N/A',
    '{{equipment}}': eqNames,
    '{{methods}}': mNames,
    '{{inspectorComment}}': h.inspectorComment || 'No comments provided.',
    '{{inspectedBy}}': inspectedBy,
    '{{approvedBy}}': approvedBy,
  };
}

/** Resolve the 31 per-row tokens for one serial. Frozen golden (pure). */
function goldenRowTokens(
  sn: Snapshot['serialNumbers'][number],
): Record<string, string> {
  const yesNo = (val: unknown) =>
    val === undefined || val === null ? '' : val ? '1' : '';

  const d: InspectionData = sn.inspectionData || {};
  const box: NonNullable<InspectionData['box']> = d.box || {};
  const pin: NonNullable<InspectionData['pin']> = d.pin || {};
  const body: NonNullable<InspectionData['body']> = d.body || {};
  const final: NonNullable<InspectionData['final']> = d.final || {};
  const boxBvl = box.bevelDiameterMin
    ? `${box.bevelDiameterMin}-${box.bevelDiameterMax || ''}`
    : '';
  const pinConn = pin.lengthPinConnMin
    ? `${pin.lengthPinConnMin}-${pin.lengthPinConnMax || ''}`
    : '';
  const pinBvl = pin.bevelDiameterMin
    ? `${pin.bevelDiameterMin}-${pin.bevelDiameterMax || ''}`
    : '';

  return {
    '{{sn}}': sn.serial || '',
    '{{b_ts}}': box.minTongSpace || '',
    '{{b_od}}': box.minOD || '',
    '{{b_thd}}': box.minBoxThreads || '',
    '{{b_ecc}}': box.minEccShoulder || '',
    '{{b_cbd}}': box.maxCounterBoreDiameter || '',
    '{{b_cbl}}': box.maxCounterBoreLength || '',
    '{{b_bvl}}': boxBvl,
    '{{b_cond}}': box.condition || '',
    '{{b_hard}}': box.hardBanding || '',
    '{{p_ts}}': pin.minTongSpace || '',
    '{{p_od}}': pin.minOD || '',
    '{{p_id}}': pin.maxID || '',
    '{{p_ecc}}': pin.minEccShoulder || '',
    '{{p_conn}}': pinConn,
    '{{p_base}}': pin.maxLengthPinBase || '',
    '{{p_bvl}}': pinBvl,
    '{{p_cond}}': pin.condition || '',
    '{{wall}}': body.wallRemaining || '',
    '{{od_decr}}': body.odDecrease || '',
    '{{emi}}': body.emiResult || '',
    '{{slip}}': body.slipArea || '',
    '{{corr_in}}': yesNo(body.corrosionIn),
    '{{corr_out}}': yesNo(body.corrosionOut),
    '{{ipc}}': yesNo(body.ipc),
    '{{bent}}': yesNo(body.bentJoints),
    '{{jc_new}}': final.isNew ? 'X' : '',
    '{{jc_prem}}': final.isPremium ? 'X' : '',
    '{{jc_c2}}': final.isC2 ? 'X' : '',
    '{{jc_scrap}}': final.isScrap ? 'X' : '',
    '{{remarks}}': final.condition_notes || final.remarks || d.remarks || '',
  };
}

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

describe('Layer A — global (header) token equivalence: engine == frozen golden', () => {
  const g = (h: Snapshot['header'], extras?: Partial<Snapshot>) => {
    const s = makeSnapshot(h, extras);
    return { engine: engineGlobalTokens(DEF, s), golden: goldenGlobalTokens(s) };
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
    const { engine, golden } = g(
      makeHeader({
        equipmentUsed: eqUsed as Snapshot['header']['equipmentUsed'],
        inspectionMethod: methods as Snapshot['header']['inspectionMethod'],
      }),
    );
    expect(engine).toEqual(golden);
    // lock the deliberately-preserved quirks explicitly
    expect(engine['{{equipment}}']).toBe('Rig #7, Cell, undefined #3');
    expect(engine['{{methods}}']).toBe('MPI, UT, [object Object]');
  });

  it('G2 empty header → whenEmpty fallbacks (N/A / None specified / comment)', () => {
    const { engine, golden } = g(
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
    expect(engine).toEqual(golden);
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
    expect(onlyCreated.engine).toEqual(onlyCreated.golden);

    const neither = g(
      makeHeader({
        updatedAt: undefined as unknown as string,
        createdAt: undefined as unknown as string,
      }),
    );
    expect(neither.engine).toEqual(neither.golden);
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
    const { engine, golden } = g(makeHeader(), extras);
    expect(engine).toEqual(golden);
    expect(engine['{{inspectedBy}}']).toBe('Ivy Inspector');
    expect(engine['{{approvedBy}}']).toBe('sam@x.co'); // name null → email
  });

  it('G5 no transition logs → injected header names (or N/A)', () => {
    const { engine, golden } = g(
      makeHeader({ inspectedByName: 'Pre Set', approvedByName: undefined }),
    );
    expect(engine).toEqual(golden);
    expect(engine['{{inspectedBy}}']).toBe('Pre Set');
    expect(engine['{{approvedBy}}']).toBe('N/A');
  });
});

// ---------------------------------------------------------------------- rows

describe('Layer A — per-row token equivalence: engine == frozen golden', () => {
  const r = (s: Snapshot['serialNumbers'][number]) => ({
    engine: engineRowTokens(DEF, SNAP, s),
    golden: goldenRowTokens(s),
  });

  it('R1 fully-populated row (strings + booleans true)', () => {
    const { engine, golden } = r(makeSerial('SN-1', fullRow()));
    expect(engine).toEqual(golden);
    expect(engine['{{sn}}']).toBe('SN-1'); // rowSerial source
    expect(engine['{{b_bvl}}']).toBe('a7-a8'); // range compose
    expect(engine['{{corr_in}}']).toBe('1'); // boolFlag true
    expect(engine['{{jc_new}}']).toBe('X'); // boolCheckbox true
    expect(engine['{{remarks}}']).toBe('the-notes'); // coalesce first
  });

  it('R2 empty inspectionData → all row tokens empty (except serial)', () => {
    const { engine, golden } = r(makeSerial('SN-2', {}));
    expect(engine).toEqual(golden);
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
    const { engine, golden } = r(makeSerial('SN-3', d));
    expect(engine).toEqual(golden);
    expect(engine['{{corr_in}}']).toBe('');
    expect(engine['{{jc_new}}']).toBe('');
  });

  it('R4 range: only-min → "min-", missing → ""', () => {
    const d = fullRow();
    d.box!.bevelDiameterMax = undefined; // only min
    delete d.pin!.bevelDiameterMin; // both effectively gone for p_bvl (min falsy)
    d.pin!.bevelDiameterMax = 'x';
    const { engine, golden } = r(makeSerial('SN-4', d));
    expect(engine).toEqual(golden);
    expect(engine['{{b_bvl}}']).toBe('a7-'); // min present, max empty
    expect(engine['{{p_bvl}}']).toBe(''); // min empty → blank
  });

  it('R5 remarks coalesce order: condition_notes → final.remarks → remarks', () => {
    const only2 = fullRow();
    delete only2.final!.condition_notes;
    only2.final!.remarks = 'final-remarks';
    expect(r(makeSerial('a', only2)).engine).toEqual(
      r(makeSerial('a', only2)).golden,
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
    expect(r(makeSerial('a', none)).engine).toEqual(r(makeSerial('a', none)).golden);
    expect(engineRowTokens(DEF, SNAP, makeSerial('a', none))['{{remarks}}']).toBe('');
  });

  it("R6 '0' and whitespace scalars are kept (truthy ||), not blanked", () => {
    const d = fullRow();
    d.box!.minOD = '0';
    d.box!.minTongSpace = '   ';
    const { engine, golden } = r(makeSerial('SN-6', d));
    expect(engine).toEqual(golden);
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
    expect(engineRowTokens(mutant, SNAP, s)).not.toEqual(goldenRowTokens(s));
  });

  it('a token-mapping change makes the engine token map diverge', () => {
    const mutant = clone();
    const entry = mutant.export.regions.serials.find(
      (e) => e.token === '{{b_od}}',
    )!;
    entry.field = 'box.minID'; // no such field → resolves '' vs golden box.minOD
    const s = makeSerial('SN-1', fullRow());
    expect(engineRowTokens(mutant, SNAP, s)).not.toEqual(goldenRowTokens(s));
  });
});
