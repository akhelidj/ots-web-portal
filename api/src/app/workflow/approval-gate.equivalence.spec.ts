/**
 * Unit test — approval-gate correctness proof (definition-driven `engineGate`).
 *
 * The legacy hardcoded gate has been RETIRED; `engineGate` is now the sole
 * implementation. This spec pins `engineGate`, fed the REAL committed drill-pipe
 * definition (api/src/app/template/definitions/drill-pipe-v1.definition.json),
 * against an INDEPENDENT hardcoded expectation across the full case matrix:
 *   structural    — `toEqual` on the GateOutcome (arrays compared in order);
 *   byte-for-byte — `JSON.stringify` of the enforced HTTP body (catches array
 *                   order AND object-key order, which toEqual does not).
 * The expectation is derived from `ALL_32_KEYS_IN_ORDER`, NOT from the gate
 * source, so it proves `engineGate` produces the CORRECT answer — this is the
 * oracle that survived the legacy gate's retirement (formerly assertion (c)).
 *
 * The definition is LOADED FROM DISK (not a fixture) so this spec is the guardrail
 * that fails if that committed artifact ever drifts from the gate contract.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { SerialDisposition } from '@prisma/client';
import { InspectionData } from '../common/inspection-data.types';
import {
  engineGate,
  enforce,
  GateDefinition,
  GateOutcome,
  SerialRow,
} from './approval-gate';

const DEFINITION = JSON.parse(
  readFileSync(
    resolve(__dirname, '../template/definitions/drill-pipe-v1.definition.json'),
    'utf8',
  ),
) as GateDefinition;

/**
 * All 32 required keys populated — the passing baseline. Disposition resolves from the
 * declared source `body.emiResult` (which is ALSO a required item field on this template,
 * so the passing baseline necessarily carries it). The legacy `final.disposition` mirror
 * is deliberately NOT set: the definition declares a single source, so that field is inert.
 */
function fullValid(): InspectionData {
  return {
    box: {
      minTongSpace: '1',
      minOD: '1',
      minBoxThreads: '1',
      minEccShoulder: '1',
      maxCounterBoreDiameter: '1',
      maxCounterBoreLength: '1',
      bevelDiameterMin: '1',
      bevelDiameterMax: '1',
      condition: '1',
      hardBanding: '1',
    },
    pin: {
      minTongSpace: '1',
      minOD: '1',
      maxID: '1',
      minEccShoulder: '1',
      lengthPinConnMin: '1',
      lengthPinConnMax: '1',
      maxLengthPinBase: '1',
      bevelDiameterMin: '1',
      bevelDiameterMax: '1',
      condition: '1',
    },
    body: {
      wallRemaining: '1',
      odDecrease: '1',
      emiResult: SerialDisposition.PASS,
      slipArea: '1',
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
    },
  };
}

/** fullValid() with a mutation applied. */
function withData(mut: (d: InspectionData) => void): InspectionData {
  const d = fullValid();
  mut(d);
  return d;
}

function sn(serial: string, inspectionData: InspectionData | null): SerialRow {
  return { serial, inspectionData };
}

/** The enforced wire body (or null if the outcome throws nothing). */
function enforcedBody(outcome: GateOutcome): string | null {
  try {
    enforce(outcome);
    return null;
  } catch (e) {
    return JSON.stringify((e as BadRequestException).getResponse());
  }
}

// Independent expected orderings (hardcoded, NOT derived from the gate source).
const ALL_BOX_KEYS_IN_ORDER = [
  'box.minTongSpace',
  'box.minOD',
  'box.minBoxThreads',
  'box.minEccShoulder',
  'box.maxCounterBoreDiameter',
  'box.maxCounterBoreLength',
  'box.bevelDiameterMin',
  'box.bevelDiameterMax',
  'box.condition',
  'box.hardBanding', // legacy order: box.hardBanding is reported LAST of the box keys
];
const ALL_32_KEYS_IN_ORDER = [
  'box.minTongSpace',
  'box.minOD',
  'box.minBoxThreads',
  'box.minEccShoulder',
  'box.maxCounterBoreDiameter',
  'box.maxCounterBoreLength',
  'box.bevelDiameterMin',
  'box.bevelDiameterMax',
  'box.condition',
  'pin.minTongSpace',
  'pin.minOD',
  'pin.maxID',
  'pin.minEccShoulder',
  'pin.lengthPinConnMin',
  'pin.lengthPinConnMax',
  'pin.maxLengthPinBase',
  'pin.bevelDiameterMin',
  'pin.bevelDiameterMax',
  'pin.condition',
  'box.hardBanding',
  'body.wallRemaining',
  'body.odDecrease',
  'body.emiResult',
  'body.slipArea',
  'body.corrosionIn',
  'body.corrosionOut',
  'body.ipc',
  'body.bentJoints',
  'final.isNew',
  'final.isPremium',
  'final.isC2',
  'final.isScrap',
];

interface Case {
  name: string;
  serials: SerialRow[];
  expected: GateOutcome;
  /** When set, the exact JSON wire body is pinned too (null = nothing thrown). */
  expectedBody?: string | null;
}

const cases: Case[] = [
  {
    name: '1. valid complete -> ok',
    serials: [sn('SN-1', fullValid())],
    expected: { status: 'ok' },
    expectedBody: null,
  },
  {
    name: '2a. required text field empty-string -> missing',
    serials: [sn('SN-1', withData((d) => (d.box!.minOD = '')))],
    expected: {
      status: 'failed',
      missingDispositionSerials: [],
      missingRequiredFields: { 'SN-1': ['box.minOD'] },
    },
    expectedBody:
      '{"code":"VALIDATION_FAILED","message":"Validation failed for one or more serial numbers.","missingDispositionSerials":[],"missingRequiredFields":{"SN-1":["box.minOD"]}}',
  },
  {
    name: '2b. required text field absent (undefined) -> missing',
    serials: [sn('SN-1', withData((d) => delete d.box!.minOD))],
    expected: {
      status: 'failed',
      missingDispositionSerials: [],
      missingRequiredFields: { 'SN-1': ['box.minOD'] },
    },
  },
  {
    name: '2c. whole section object absent -> all its keys missing (order)',
    serials: [sn('SN-1', withData((d) => delete d.box))],
    expected: {
      status: 'failed',
      missingDispositionSerials: [],
      missingRequiredFields: { 'SN-1': ALL_BOX_KEYS_IN_ORDER },
    },
  },
  {
    name: '3. ORDERING flip: box.hardBanding + pin.minTongSpace missing',
    serials: [
      sn(
        'SN-1',
        withData((d) => {
          delete d.box!.hardBanding;
          delete d.pin!.minTongSpace;
        }),
      ),
    ],
    expected: {
      status: 'failed',
      missingDispositionSerials: [],
      // legacy order: pin.minTongSpace (idx 9) BEFORE box.hardBanding (idx 19)
      missingRequiredFields: { 'SN-1': ['pin.minTongSpace', 'box.hardBanding'] },
    },
  },
  {
    // The disposition source (body.emiResult) is ALSO a required item field, so clearing
    // it flags BOTH failure modes at once — there is no "missing disposition only" state
    // on drill-pipe. This honestly reflects the single-source reality.
    name: '4a. disposition source absent -> missing disposition AND missing required field',
    serials: [sn('SN-1', withData((d) => delete d.body!.emiResult))],
    expected: {
      status: 'failed',
      missingDispositionSerials: ['SN-1'],
      missingRequiredFields: { 'SN-1': ['body.emiResult'] },
    },
  },
  {
    name: '4b. disposition source empty-string -> missing disposition (truthy coalesce) AND missing field',
    serials: [sn('SN-1', withData((d) => (d.body!.emiResult = '')))],
    expected: {
      status: 'failed',
      missingDispositionSerials: ['SN-1'],
      missingRequiredFields: { 'SN-1': ['body.emiResult'] },
    },
  },
  {
    // Single-source regression guard: a value living ONLY at the legacy top-level
    // `disposition` is NOT read (the definition declares body.emiResult as the sole
    // source). It neither satisfies disposition nor fills the required field.
    name: '4c. legacy top-level `disposition` is NOT a source -> still missing',
    serials: [
      sn(
        'SN-1',
        withData((d) => {
          delete d.body!.emiResult;
          d.disposition = 'PASS';
        }),
      ),
    ],
    expected: {
      status: 'failed',
      missingDispositionSerials: ['SN-1'],
      missingRequiredFields: { 'SN-1': ['body.emiResult'] },
    },
  },
  {
    // Single-source regression guard: legacy `final.disposition` is inert too.
    name: '4d. legacy final.disposition is NOT a source -> still missing',
    serials: [
      sn(
        'SN-1',
        withData((d) => {
          delete d.body!.emiResult;
          d.final!.disposition = 'PASS';
        }),
      ),
    ],
    expected: {
      status: 'failed',
      missingDispositionSerials: ['SN-1'],
      missingRequiredFields: { 'SN-1': ['body.emiResult'] },
    },
  },
  {
    name: '5. missing (other) field AND missing disposition source',
    serials: [
      sn(
        'SN-1',
        withData((d) => {
          d.box!.minOD = '';
          delete d.body!.emiResult;
        }),
      ),
    ],
    expected: {
      status: 'failed',
      missingDispositionSerials: ['SN-1'],
      // definition order: box.minOD (early) before body.emiResult (body section)
      missingRequiredFields: { 'SN-1': ['box.minOD', 'body.emiResult'] },
    },
  },
  {
    name: '6. empty serial list -> empty',
    serials: [],
    expected: { status: 'empty' },
    expectedBody:
      '{"code":"VALIDATION_FAILED","message":"Cannot request approval: No serial numbers added","missingDispositionSerials":[],"missingRequiredFields":{}}',
  },
  {
    name: '7. GOTCHA: all boolean fields false, text filled, disposition set -> ok',
    serials: [
      sn(
        'SN-1',
        withData((d) => {
          d.body!.corrosionIn = false;
          d.body!.corrosionOut = false;
          d.body!.ipc = false;
          d.body!.bentJoints = false;
          d.final!.isNew = false;
          d.final!.isPremium = false;
          d.final!.isC2 = false;
          d.final!.isScrap = false;
        }),
      ),
    ],
    expected: { status: 'ok' },
    expectedBody: null,
  },
  {
    name: '8a. optional remarks absent -> ok',
    serials: [sn('SN-1', fullValid())],
    expected: { status: 'ok' },
    expectedBody: null,
  },
  {
    name: '8b. optional remarks filled -> ok (never gated)',
    serials: [sn('SN-1', withData((d) => (d.remarks = 'a note')))],
    expected: { status: 'ok' },
    expectedBody: null,
  },
  {
    name: '9. inspectionData null -> all 32 keys (order) + disposition missing',
    serials: [sn('SN-1', null)],
    expected: {
      status: 'failed',
      missingDispositionSerials: ['SN-1'],
      missingRequiredFields: { 'SN-1': ALL_32_KEYS_IN_ORDER },
    },
  },
  {
    name: '10. multi-serial: valid / missing-field / missing-disposition-source',
    serials: [
      sn('SN-A', fullValid()),
      sn('SN-B', withData((d) => (d.box!.minOD = ''))),
      sn('SN-C', withData((d) => delete d.body!.emiResult)),
    ],
    expected: {
      status: 'failed',
      // SN-C's cleared emiResult is both the disposition source and a required field.
      missingDispositionSerials: ['SN-C'],
      missingRequiredFields: {
        'SN-B': ['box.minOD'],
        'SN-C': ['body.emiResult'],
      },
    },
  },
  {
    // Corrected behavior (was an inverted gotcha under the phantom source): body.emiResult
    // IS the disposition source now, so a present emiResult satisfies disposition even
    // though the legacy final.disposition mirror is absent — it is no longer consulted.
    name: '11. emiResult present satisfies disposition; legacy final.disposition absent is irrelevant -> ok',
    serials: [
      sn(
        'SN-1',
        withData((d) => {
          delete d.final!.disposition;
        }),
      ),
    ],
    expected: { status: 'ok' },
    expectedBody: null,
  },
  {
    name: "12. whitespace / '0' values are present (no trim, no truthiness)",
    serials: [
      sn(
        'SN-1',
        withData((d) => {
          d.box!.minOD = '   ';
          d.box!.condition = '0';
        }),
      ),
    ],
    expected: { status: 'ok' },
    expectedBody: null,
  },
];

describe('approval gate — engineGate matches the independent literal expectation for the committed drill-pipe definition', () => {
  it.each(cases)('$name', ({ serials, expected, expectedBody }) => {
    const engine = engineGate(DEFINITION, serials);

    // structural — engineGate agrees with the independent hardcoded expectation
    // (the surviving oracle; legacyGate is retired, so there is no cross-impl check).
    expect(engine).toEqual(expected);

    // byte-for-byte — enforced HTTP body against the independent literal (catches
    // array AND object-key order, which toEqual does not).
    const engineBody = enforcedBody(engine);
    if (expectedBody !== undefined) {
      expect(engineBody).toBe(expectedBody);
    }
  });
});

describe('mutation guard — the harness FAILS on a broken definition', () => {
  // Non-vacuity is proven by mutant-engine vs REAL-engine (the committed
  // definition), no legacy reference: a corruption of the definition must make
  // engineGate(mutant) diverge from engineGate(DEFINITION), or the proof above
  // could pass on any definition.
  const clone = (): GateDefinition =>
    JSON.parse(JSON.stringify(DEFINITION)) as GateDefinition;

  it('(a) dropping a required:true flag makes engineGate diverge', () => {
    const mutant = clone();
    mutant.fields.find((f) => f.key === 'box.minOD')!.required = false;

    const serials = [sn('SN-1', withData((d) => delete d.box!.minOD))];
    const real = engineGate(DEFINITION, serials);
    const engine = engineGate(mutant, serials);

    // the real definition still flags box.minOD; the mutant no longer does
    expect(engine).not.toEqual(real);
    expect(enforcedBody(engine)).not.toBe(enforcedBody(real));
  });

  it('(b) swapping two field positions makes missingKeys order diverge', () => {
    const mutant = clone();
    const i = mutant.fields.findIndex((f) => f.key === 'box.minTongSpace');
    const j = mutant.fields.findIndex((f) => f.key === 'box.minOD');
    [mutant.fields[i], mutant.fields[j]] = [mutant.fields[j], mutant.fields[i]];

    const serials = [
      sn(
        'SN-1',
        withData((d) => {
          delete d.box!.minTongSpace;
          delete d.box!.minOD;
        }),
      ),
    ];
    const real = engineGate(DEFINITION, serials);
    const engine = engineGate(mutant, serials);

    expect(engine).not.toEqual(real);
    expect(enforcedBody(engine)).not.toBe(enforcedBody(real));
  });

  it('(c) flipping disposition.requiredForApproval hides a missing disposition', () => {
    const mutant = clone();
    mutant.disposition!.requiredForApproval = false;

    // Clear the disposition source. Under the real definition this flags a missing
    // disposition (on top of the coincident missing required field); the mutant, with
    // requiredForApproval off, reports only the missing field — so the two diverge on the
    // disposition array. (body.emiResult being both source and required field means both
    // outcomes carry the field error; only the disposition error distinguishes them.)
    const serials = [sn('SN-1', withData((d) => delete d.body!.emiResult))];
    const real = engineGate(DEFINITION, serials);
    const engine = engineGate(mutant, serials);

    // the real definition flags the missing disposition; the mutant passes it
    expect(engine).not.toEqual(real);
  });
});
