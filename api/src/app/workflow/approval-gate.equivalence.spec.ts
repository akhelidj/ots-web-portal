/**
 * Unit test — Phase B1 approval-gate EQUIVALENCE proof.
 *
 * Proves the definition-driven `engineGate`, fed the REAL committed drill-pipe
 * definition (api/src/app/template/definitions/drill-pipe-v1.definition.json),
 * produces results IDENTICAL to the legacy hardcoded `legacyGate` across the
 * full case matrix. "Identical" is asserted three ways per case:
 *   (a) structural   — `toEqual` on the GateOutcome (arrays compared in order);
 *   (b) byte-for-byte — `JSON.stringify` of the enforced HTTP body (catches array
 *                       order AND object-key order, which toEqual does not);
 *   (c) literal       — both equal an independent hardcoded expectation, so we
 *                       prove they agree on the CORRECT answer, not just agree.
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
  legacyGate,
  engineGate,
  enforce,
  GateDefinition,
  GateOutcome,
  SerialRow,
} from './approval-gate';

const KEY = 'DRILL_PIPE_REPORT';

const DEFINITION = JSON.parse(
  readFileSync(
    resolve(__dirname, '../template/definitions/drill-pipe-v1.definition.json'),
    'utf8',
  ),
) as GateDefinition;

/** All 32 required keys populated + a (final) disposition — the passing baseline. */
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
      disposition: 'PASS',
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
    name: '4a. disposition absent -> missing disposition',
    serials: [sn('SN-1', withData((d) => delete d.final!.disposition))],
    expected: {
      status: 'failed',
      missingDispositionSerials: ['SN-1'],
      missingRequiredFields: {},
    },
  },
  {
    name: '4b. disposition empty-string -> missing (truthy coalesce)',
    serials: [sn('SN-1', withData((d) => (d.final!.disposition = '')))],
    expected: {
      status: 'failed',
      missingDispositionSerials: ['SN-1'],
      missingRequiredFields: {},
    },
  },
  {
    name: '4c. disposition via top-level `disposition` only -> present',
    serials: [
      sn(
        'SN-1',
        withData((d) => {
          delete d.final!.disposition;
          d.disposition = 'PASS';
        }),
      ),
    ],
    expected: { status: 'ok' },
    expectedBody: null,
  },
  {
    name: '4d. disposition via final.disposition only -> present',
    serials: [
      sn(
        'SN-1',
        withData((d) => {
          d.final!.disposition = 'ACCEPT';
        }),
      ),
    ],
    expected: { status: 'ok' },
    expectedBody: null,
  },
  {
    name: '5. missing field AND missing disposition',
    serials: [
      sn(
        'SN-1',
        withData((d) => {
          d.box!.minOD = '';
          delete d.final!.disposition;
        }),
      ),
    ],
    expected: {
      status: 'failed',
      missingDispositionSerials: ['SN-1'],
      missingRequiredFields: { 'SN-1': ['box.minOD'] },
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
    name: '10. multi-serial: valid / missing-field / missing-disposition',
    serials: [
      sn('SN-A', fullValid()),
      sn('SN-B', withData((d) => (d.box!.minOD = ''))),
      sn('SN-C', withData((d) => delete d.final!.disposition)),
    ],
    expected: {
      status: 'failed',
      missingDispositionSerials: ['SN-C'],
      missingRequiredFields: { 'SN-B': ['box.minOD'] },
    },
  },
  {
    name: '11. GOTCHA: emiResult set but disposition unset -> missing disposition only',
    serials: [
      sn(
        'SN-1',
        withData((d) => {
          // body.emiResult stays PASS (a required field, present) but the gate's
          // disposition SOURCE is final.disposition/disposition — both cleared.
          delete d.final!.disposition;
        }),
      ),
    ],
    expected: {
      status: 'failed',
      missingDispositionSerials: ['SN-1'],
      missingRequiredFields: {},
    },
    expectedBody:
      '{"code":"VALIDATION_FAILED","message":"Validation failed for one or more serial numbers.","missingDispositionSerials":["SN-1"],"missingRequiredFields":{}}',
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

describe('approval gate — engineGate == legacyGate for the committed drill-pipe definition', () => {
  it.each(cases)('$name', ({ serials, expected, expectedBody }) => {
    const legacy = legacyGate(KEY, serials);
    const engine = engineGate(DEFINITION, serials);

    // (a) structural equivalence between the two implementations
    expect(engine).toEqual(legacy);
    // (c) both agree with the independent literal expectation
    expect(legacy).toEqual(expected);
    expect(engine).toEqual(expected);

    // (b) byte-for-byte identical enforced HTTP body (incl. object-key order)
    const legacyBody = enforcedBody(legacy);
    const engineBody = enforcedBody(engine);
    expect(engineBody).toBe(legacyBody);
    if (expectedBody !== undefined) {
      expect(engineBody).toBe(expectedBody);
    }
  });
});

describe('mutation guard — the equivalence harness FAILS on a broken definition', () => {
  const clone = (): GateDefinition =>
    JSON.parse(JSON.stringify(DEFINITION)) as GateDefinition;

  it('(a) dropping a required:true flag makes engineGate diverge', () => {
    const mutant = clone();
    mutant.fields.find((f) => f.key === 'box.minOD')!.required = false;

    const serials = [sn('SN-1', withData((d) => delete d.box!.minOD))];
    const legacy = legacyGate(KEY, serials);
    const engine = engineGate(mutant, serials);

    // legacy still flags box.minOD; the mutant no longer does
    expect(engine).not.toEqual(legacy);
    expect(enforcedBody(engine)).not.toBe(enforcedBody(legacy));
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
    const legacy = legacyGate(KEY, serials);
    const engine = engineGate(mutant, serials);

    expect(engine).not.toEqual(legacy);
    expect(enforcedBody(engine)).not.toBe(enforcedBody(legacy));
  });

  it('(c) flipping disposition.requiredForApproval hides a missing disposition', () => {
    const mutant = clone();
    mutant.disposition!.requiredForApproval = false;

    const serials = [sn('SN-1', withData((d) => delete d.final!.disposition))];
    const legacy = legacyGate(KEY, serials);
    const engine = engineGate(mutant, serials);

    // legacy flags the missing disposition; the mutant passes it
    expect(engine).not.toEqual(legacy);
  });
});
