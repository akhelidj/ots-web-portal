/**
 * Equivalence harness — STEP 1 of the definition-driven REWORK rules consumer.
 * (Design & plan: docs/architecture/rework-rules-consumer.md; decision: docs/adr/0010.)
 *
 * WHAT THIS IS — and IS NOT (yet):
 * This file builds ONLY the proof harness. There is NO interpreter here. Its job is
 * the plumbing the eventual method-vs-interpreter equivalence proof will stand on:
 *
 *   1. snapshotReworkState() — given a seeded DB state, capture everything the
 *      design doc's proof depends on about the REWORK child of one report:
 *      child existence, status, version, reportNumber, and per serial-row membership
 *      (keyed by the STABLE serial string — see below) whether the row's
 *      inspectionData is PRESERVED (non-null) or BLANK (null), plus its disposition.
 *   2. diffReworkSnapshots() — a pure comparison of two such snapshots, returning a
 *      list of human-readable differences ([] === identical).
 *
 * The authority under test is the FROZEN IMPERATIVE ORACLE (api/test/rework-imperative-oracle.ts)
 * — a standalone, independent copy of the imperative syncReworkChildReport body as it stood
 * before retirement. The live imperative body has since been deleted (location 4 of the
 * drill-pipe hardcode retirement); the definition-driven interpreter is now the SOLE live
 * path, and the service's NULL arm throws a 412 precondition. The oracle was proven
 * byte-identical to the live body before deletion, so "interpreter reproduces the oracle"
 * is exactly "interpreter reproduces the retired method". This harness proves the diff is honest.
 *
 * WHY MEMBERSHIP IS KEYED BY SERIAL STRING, NOT serialNumberId:
 * The eventual proof compares two INDEPENDENT runs against independently-seeded state
 * (rework-rules-consumer.md, open question 2 — avoid shared-mutable-state bleed by not
 * running both against the same rows). Independent seeds mint different serialNumber
 * UUIDs, so raw ids never match across runs. The serial STRING is the stable business
 * identity of a serialNumberId; keying on it makes snapshots comparable across runs
 * while still capturing exactly "which serials are linked".
 *
 * SELF-VALIDATION (a harness that cannot fail is as useless as a proof that cannot):
 *   CHECK 1  — same behavior ⇒ EMPTY diff, no false positives. Two identical
 *              independent runs (both first-syncs ⇒ both version 1) produce byte-for-byte
 *              equal snapshots on a non-trivial state (child present, correct membership,
 *              generated reportNumber). diff === [].
 *   CHECK 1b — HONEST FINDING: a same-report re-sync is NOT version-idempotent.
 *              syncReworkChildReport bumps version on every call once the child exists
 *              (child-reports.service.ts:133-138, unconditional on membership change —
 *              rework-rules-consumer.md scenario 7). So re-syncing the SAME report is
 *              the wrong idempotency notion; the diff correctly ISOLATES exactly the
 *              version bump and nothing else. This is why CHECK 1 uses independent runs.
 *   CHECK 2  — different behavior ⇒ NON-EMPTY diff. Child present vs absent from real
 *              syncs, plus membership and preserved-vs-blank granularity on the pure
 *              diff function.
 */
import { PreconditionFailedException } from '@nestjs/common';
import {
  ChildReportStatus,
  ChildReportType,
  SerialDisposition,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FilesService } from '../files/files.service';
import { ChildReportsService } from './child-reports.service';
import { ReworkRulesInterpreter } from './rework-rules.interpreter';
import {
  resetInspectionDomain,
  seedTenant,
  seedInspectionReport,
} from '../../../test/seed-helpers';
import { imperativeReworkOracle } from '../../../test/rework-imperative-oracle';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The REAL `rules` block from the live drill-pipe definition — the interpreter's input for
 * the proof. Loaded from disk (not a hand-written literal) so the proof exercises exactly the
 * rule the system ships, and would break if that rule drifts from the method it mirrors.
 */
const DRILL_PIPE_DEFINITION = JSON.parse(
  readFileSync(
    join(__dirname, '../template/definitions/drill-pipe-v1.definition.json'),
    'utf-8',
  ),
) as { rules: unknown };
const DRILL_PIPE_RULES = DRILL_PIPE_DEFINITION.rules;

// ---------------------------------------------------------------------------
// Snapshot shape — exactly the dimensions rework-rules-consumer.md's proof asserts.
// ---------------------------------------------------------------------------
interface MemberSnapshot {
  /** Stable business identity of the linked serialNumberId (see header). */
  serial: string;
  /** true = row carries inspectionData (preserved); false = blank (created empty). */
  preserved: boolean;
  disposition: SerialDisposition | null;
}

interface ReworkStateSnapshot {
  child:
    | null
    | {
        status: ChildReportStatus;
        version: number;
        reportNumber: string | null;
        /** Sorted by serial for deterministic, order-independent comparison. */
        members: MemberSnapshot[];
      };
}

/**
 * Capture the resulting DB state of the REWORK child for one report. Reads the same
 * relations the service's own mapped response reads (serialNumbers → serialNumber).
 */
async function snapshotReworkState(
  prisma: PrismaService,
  tenantId: string,
  inspectionReportId: string,
): Promise<ReworkStateSnapshot> {
  const child = await prisma.childReport.findFirst({
    where: { tenantId, inspectionReportId, type: ChildReportType.REWORK },
    include: { serialNumbers: { include: { serialNumber: true } } },
  });
  if (!child) return { child: null };

  const members: MemberSnapshot[] = child.serialNumbers
    .map((row) => ({
      serial: row.serialNumber?.serial ?? `<missing:${row.serialNumberId}>`,
      preserved: row.inspectionData !== null,
      disposition: row.disposition ?? null,
    }))
    .sort((a, b) => a.serial.localeCompare(b.serial));

  return {
    child: {
      status: child.status,
      version: child.version,
      reportNumber: child.reportNumber ?? null,
      members,
    },
  };
}

/**
 * Pure diff of two snapshots. Returns [] iff identical. Membership is compared as a
 * set keyed by serial string, so ordering and run-local UUIDs never matter.
 */
function diffReworkSnapshots(
  a: ReworkStateSnapshot,
  b: ReworkStateSnapshot,
): string[] {
  const diffs: string[] = [];
  const ca = a.child;
  const cb = b.child;

  if ((ca === null) !== (cb === null)) {
    diffs.push(
      `child existence: ${ca ? 'present' : 'absent'} → ${cb ? 'present' : 'absent'}`,
    );
    return diffs; // one side has no child; nothing further to compare
  }
  if (ca === null || cb === null) return diffs; // both absent ⇒ identical

  if (ca.status !== cb.status)
    diffs.push(`child.status: ${ca.status} → ${cb.status}`);
  if (ca.version !== cb.version)
    diffs.push(`child.version: ${ca.version} → ${cb.version}`);
  if (ca.reportNumber !== cb.reportNumber)
    diffs.push(`child.reportNumber: ${ca.reportNumber} → ${cb.reportNumber}`);

  const ma = new Map(ca.members.map((m) => [m.serial, m]));
  const mb = new Map(cb.members.map((m) => [m.serial, m]));
  for (const serial of [...new Set([...ma.keys(), ...mb.keys()])].sort()) {
    const x = ma.get(serial);
    const y = mb.get(serial);
    if (!x) {
      diffs.push(`member ${serial}: absent → present`);
      continue;
    }
    if (!y) {
      diffs.push(`member ${serial}: present → absent`);
      continue;
    }
    if (x.preserved !== y.preserved)
      diffs.push(`member ${serial}.preserved: ${x.preserved} → ${y.preserved}`);
    if (x.disposition !== y.disposition)
      diffs.push(
        `member ${serial}.disposition: ${x.disposition} → ${y.disposition}`,
      );
  }
  return diffs;
}

describe('REWORK rules-consumer equivalence harness [integration]', () => {
  let prisma: PrismaService;
  let service: ChildReportsService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
    // FilesService is a constructor dep syncReworkChildReport never touches; construct
    // it without onModuleInit (which reconciles the attachment storage dir). The
    // ReworkRulesInterpreter is now a constructor dep too (the wired gate routes to it
    // when the report's template carries a definitionJson) — supplied here with prisma,
    // its only dep, exactly as the DI module provides it.
    service = new ChildReportsService(
      prisma,
      new FilesService(prisma),
      new ReworkRulesInterpreter(prisma),
    );
  });

  afterAll(async () => {
    await prisma?.onModuleDestroy();
  });

  beforeEach(() => resetInspectionDomain(prisma));

  /**
   * Seed tenant → report (optional reportNumber) → serials whose
   * inspectionData.body.emiResult is REWORK (the trigger) or PASS (a non-matching
   * control). Only body.emiResult matters to syncReworkChildReport, so serials are
   * created directly rather than via the full gate-passing seedApprovableSerial.
   */
  async function seedReworkScenario(opts: {
    reworkSerials: string[];
    passSerials?: string[];
    /** Serials with an arbitrary (possibly falsy) body.emiResult — for coherence tests. */
    rawSerials?: { serial: string; emiResult: unknown }[];
    reportNumber?: string | null;
  }): Promise<{ tenantId: string; reportId: string }> {
    const tenant = await seedTenant(prisma);
    const report = await seedInspectionReport(prisma, tenant.id);
    if (opts.reportNumber !== undefined) {
      await prisma.inspectionReport.update({
        where: { id: report.id },
        data: { reportNumber: opts.reportNumber },
      });
    }
    const mk = (serial: string, emiResult: SerialDisposition) =>
      prisma.serialNumber.create({
        data: {
          tenantId: tenant.id,
          inspectionReportId: report.id,
          serial,
          inspectionData: { body: { emiResult } } as never,
        },
      });
    for (const s of opts.reworkSerials) await mk(s, SerialDisposition.REWORK);
    for (const s of opts.passSerials ?? []) await mk(s, SerialDisposition.PASS);
    for (const rs of opts.rawSerials ?? [])
      await prisma.serialNumber.create({
        data: {
          tenantId: tenant.id,
          inspectionReportId: report.id,
          serial: rs.serial,
          inspectionData: { body: { emiResult: rs.emiResult } } as never,
        },
      });
    return { tenantId: tenant.id, reportId: report.id };
  }

  // A rich but reproducible scenario: two REWORK serials, one PASS control, a parent
  // reportNumber so the child's generated `_rework` number is exercised.
  const RICH = {
    reworkSerials: ['SN-A', 'SN-B'],
    passSerials: ['SN-C'],
    reportNumber: 'RPT-100',
  } as const;

  it('CHECK 1 — same behavior ⇒ EMPTY diff (no false positives)', async () => {
    // Two INDEPENDENT identical runs. Both are first-syncs ⇒ both child version 1, so
    // the deterministic version increment cannot introduce a spurious difference here.
    const runOnce = async () => {
      const { tenantId, reportId } = await seedReworkScenario({ ...RICH });
      await imperativeReworkOracle(prisma, tenantId, reportId);
      return snapshotReworkState(prisma, tenantId, reportId);
    };

    const s1 = await runOnce();
    await resetInspectionDomain(prisma);
    const s2 = await runOnce();

    const diff = diffReworkSnapshots(s1, s2);
    // eslint-disable-next-line no-console
    console.log(
      '[CHECK 1] snapshot =',
      JSON.stringify(s1),
      '\n[CHECK 1] idempotent-run diff =',
      JSON.stringify(diff),
    );

    // The snapshot must be non-trivial, or an empty diff would prove nothing.
    expect(s1.child).not.toBeNull();
    expect(s1.child?.status).toBe(ChildReportStatus.DRAFT);
    expect(s1.child?.version).toBe(1);
    expect(s1.child?.reportNumber).toBe('RPT-100_rework');
    expect(s1.child?.members.map((m) => m.serial)).toEqual(['SN-A', 'SN-B']); // SN-C excluded
    // The actual proof the harness makes no false positive:
    expect(diff).toEqual([]);
  });

  it('CHECK 1b — same-report re-sync is NOT version-idempotent; diff isolates exactly the version bump', async () => {
    const { tenantId, reportId } = await seedReworkScenario({ ...RICH });

    await imperativeReworkOracle(prisma, tenantId, reportId);
    const s1 = await snapshotReworkState(prisma, tenantId, reportId);
    await imperativeReworkOracle(prisma, tenantId, reportId); // identical inputs
    const s2 = await snapshotReworkState(prisma, tenantId, reportId);

    const diff = diffReworkSnapshots(s1, s2);
    // eslint-disable-next-line no-console
    console.log('[CHECK 1b] same-report re-sync diff =', JSON.stringify(diff));

    expect(s1.child?.version).toBe(1); // first sync created the child, no bump
    expect(s2.child?.version).toBe(2); // second sync bumps because child pre-existed
    // Everything else is stable ⇒ the diff surfaces precisely one field, and no more.
    expect(diff).toEqual(['child.version: 1 → 2']);
  });

  it('CHECK 2 — different behavior ⇒ NON-EMPTY diff (child present vs absent)', async () => {
    const present = await (async () => {
      const { tenantId, reportId } = await seedReworkScenario({ ...RICH });
      await imperativeReworkOracle(prisma, tenantId, reportId);
      return snapshotReworkState(prisma, tenantId, reportId);
    })();

    await resetInspectionDomain(prisma);

    const absent = await (async () => {
      // No REWORK serials ⇒ the oracle creates no child.
      const { tenantId, reportId } = await seedReworkScenario({
        reworkSerials: [],
        passSerials: ['SN-A', 'SN-B'],
        reportNumber: 'RPT-100',
      });
      await imperativeReworkOracle(prisma, tenantId, reportId);
      return snapshotReworkState(prisma, tenantId, reportId);
    })();

    const diff = diffReworkSnapshots(present, absent);
    // eslint-disable-next-line no-console
    console.log('[CHECK 2] present-vs-absent diff =', JSON.stringify(diff));

    expect(present.child).not.toBeNull();
    expect(absent.child).toBeNull();
    expect(diff.length).toBeGreaterThan(0);
    expect(diff).toContain('child existence: present → absent');
  });

  it('CHECK 2 — diff detects membership and preserved-vs-blank differences (granularity)', () => {
    // Pure-function checks: the DB positive (CHECK 1) can prove "empty on same", but
    // only hand-built snapshots can prove the diff SEES membership and preserved
    // changes (a real difference in exactly those fields must be reported).
    const base: ReworkStateSnapshot = {
      child: {
        status: ChildReportStatus.DRAFT,
        version: 2,
        reportNumber: 'RPT-100_rework',
        members: [
          { serial: 'SN-A', preserved: true, disposition: null },
          { serial: 'SN-B', preserved: false, disposition: null },
        ],
      },
    };

    const fewerMembers: ReworkStateSnapshot = {
      child: { ...base.child!, members: [base.child!.members[0]] },
    };
    const membershipDiff = diffReworkSnapshots(base, fewerMembers);
    expect(membershipDiff).toContain('member SN-B: present → absent');

    const blankedA: ReworkStateSnapshot = {
      child: {
        ...base.child!,
        members: [
          { serial: 'SN-A', preserved: false, disposition: null }, // was preserved:true
          base.child!.members[1],
        ],
      },
    };
    const preservedDiff = diffReworkSnapshots(base, blankedA);
    expect(preservedDiff).toContain('member SN-A.preserved: true → false');
  });

  // =========================================================================
  // STEP 3 — the equivalence PROOF. For each design-doc scenario, run BOTH the frozen
  // imperativeReworkOracle AND interpreter.syncFromRules(REAL rules) against
  // INDEPENDENT identical seeds, snapshot each, and assert diffReworkSnapshots === [].
  // (The oracle replaces the now-retired live imperative body as the method-side authority;
  // it was proven byte-identical to that body before deletion.)
  //
  // Independent seeds are MANDATORY: the version-bump non-idempotency (CHECK 1b) means a
  // shared second run would show version drift that is a sequencing artifact, not a real
  // path difference (rework-rules-consumer.md open question 2). Membership keyed by serial
  // STRING already bridges the differing serialNumber UUIDs across the two seeds.
  //
  // The ENTIRE scenario — including any setup syncs and cross-sync mutations — runs on the
  // SAME path, so each proof is a true end-to-end equivalence, not just the final call. For
  // scenarios where the child pre-exists (S3/S5/S6/S7) both paths must reproduce the
  // unconditional version bump identically, or the diff catches it on the version dimension.
  // =========================================================================
  describe('method ↔ interpreter equivalence [proof]', () => {
    let interpreter: ReworkRulesInterpreter;
    beforeAll(() => {
      // Constructed unwired, exactly as it lives in the tree — prisma is its only dep.
      interpreter = new ReworkRulesInterpreter(prisma);
    });

    type Sync = (tenantId: string, reportId: string) => Promise<unknown>;

    /** Overwrite one serial's body.emiResult (moves it into / out of the match set). */
    const setEmi = (reportId: string, serial: string, emiResult: unknown) =>
      prisma.serialNumber.updateMany({
        where: { inspectionReportId: reportId, serial },
        data: { inspectionData: { body: { emiResult } } as never },
      });

    const setChildStatus = (reportId: string, status: ChildReportStatus) =>
      prisma.childReport.updateMany({
        where: { inspectionReportId: reportId, type: ChildReportType.REWORK },
        data: { status },
      });

    /**
     * Give an existing child serial row real inspectionData + a disposition, so the
     * "preserve existing rows untouched" behavior is genuinely exercised (preserved:true with
     * a disposition), rather than every row being an indistinguishable blank.
     */
    async function markChildRowInspected(reportId: string, serial: string) {
      const child = await prisma.childReport.findFirst({
        where: { inspectionReportId: reportId, type: ChildReportType.REWORK },
      });
      const sn = await prisma.serialNumber.findFirst({
        where: { inspectionReportId: reportId, serial },
      });
      if (!child || !sn) {
        throw new Error('markChildRowInspected: child/serial not found');
      }
      await prisma.childReportSerialNumber.updateMany({
        where: { childReportId: child.id, serialNumberId: sn.id },
        data: {
          inspectionData: { body: { emiResult: 'PASS' } } as never,
          disposition: SerialDisposition.PASS,
        },
      });
    }

    /**
     * Run `build` (seed + syncs) on a given path against a FRESH domain, snapshot the result,
     * do it again on the other path against another fresh seed, and assert the two snapshots
     * diff empty. `build` uses the `sync` it is handed for EVERY sync it performs.
     */
    async function proveEquivalent(
      label: string,
      build: (sync: Sync) => Promise<{ tenantId: string; reportId: string }>,
    ): Promise<{ methodSnap: ReworkStateSnapshot }> {
      await resetInspectionDomain(prisma);
      const m = await build((t, r) => imperativeReworkOracle(prisma, t, r));
      const methodSnap = await snapshotReworkState(prisma, m.tenantId, m.reportId);

      await resetInspectionDomain(prisma);
      const i = await build((t, r) =>
        interpreter.syncFromRules(t, r, DRILL_PIPE_RULES),
      );
      const interpSnap = await snapshotReworkState(prisma, i.tenantId, i.reportId);

      const diff = diffReworkSnapshots(methodSnap, interpSnap);
      // eslint-disable-next-line no-console
      console.log(
        `[PROOF ${label}]` +
          `\n  method      = ${JSON.stringify(methodSnap)}` +
          `\n  interpreter = ${JSON.stringify(interpSnap)}` +
          `\n  diff = ${JSON.stringify(diff)}`,
      );
      expect(diff).toEqual([]);
      return { methodSnap };
    }

    it('S1 — no rework + no child ⇒ no-op, no child', async () => {
      const { methodSnap } = await proveEquivalent('S1', async (sync) => {
        const s = await seedReworkScenario({
          reworkSerials: [],
          passSerials: ['SN-A'],
          reportNumber: 'RPT-100',
        });
        await sync(s.tenantId, s.reportId);
        return s;
      });
      expect(methodSnap.child).toBeNull();
    });

    it('S2 — no rework + existing DRAFT child ⇒ child deleted', async () => {
      const { methodSnap } = await proveEquivalent('S2', async (sync) => {
        const s = await seedReworkScenario({
          reworkSerials: ['SN-A'],
          reportNumber: 'RPT-100',
        });
        await sync(s.tenantId, s.reportId); // creates DRAFT child v1
        await setEmi(s.reportId, 'SN-A', SerialDisposition.PASS);
        await sync(s.tenantId, s.reportId); // empty match + DRAFT ⇒ delete
        return s;
      });
      expect(methodSnap.child).toBeNull();
    });

    it('S3 — no rework + existing non-DRAFT child ⇒ rows wiped, version++, child retained', async () => {
      const { methodSnap } = await proveEquivalent('S3', async (sync) => {
        const s = await seedReworkScenario({
          reworkSerials: ['SN-A'],
          reportNumber: 'RPT-100',
        });
        await sync(s.tenantId, s.reportId); // DRAFT v1
        await setChildStatus(s.reportId, ChildReportStatus.APPROVED);
        await setEmi(s.reportId, 'SN-A', SerialDisposition.PASS);
        await sync(s.tenantId, s.reportId); // empty match + non-DRAFT ⇒ wipe rows, v++
        return s;
      });
      expect(methodSnap.child?.status).toBe(ChildReportStatus.APPROVED);
      expect(methodSnap.child?.version).toBe(2);
      expect(methodSnap.child?.members).toEqual([]);
    });

    it('S4 — some rework + no child ⇒ child created DRAFT v1, matching rows linked', async () => {
      const { methodSnap } = await proveEquivalent('S4', async (sync) => {
        const s = await seedReworkScenario({
          reworkSerials: ['SN-A', 'SN-B'],
          passSerials: ['SN-C'],
          reportNumber: 'RPT-100',
        });
        await sync(s.tenantId, s.reportId);
        return s;
      });
      expect(methodSnap.child?.status).toBe(ChildReportStatus.DRAFT);
      expect(methodSnap.child?.version).toBe(1);
      expect(methodSnap.child?.reportNumber).toBe('RPT-100_rework');
      expect(methodSnap.child?.members.map((m) => m.serial)).toEqual([
        'SN-A',
        'SN-B',
      ]);
    });

    it('S5 — set grows ⇒ new serial added blank, existing preserved, version++', async () => {
      const { methodSnap } = await proveEquivalent('S5', async (sync) => {
        const s = await seedReworkScenario({
          reworkSerials: ['SN-A'],
          passSerials: ['SN-B'],
          reportNumber: 'RPT-100',
        });
        await sync(s.tenantId, s.reportId); // child w/ SN-A (blank)
        await markChildRowInspected(s.reportId, 'SN-A'); // SN-A now carries data
        await setEmi(s.reportId, 'SN-B', SerialDisposition.REWORK); // grows set
        await sync(s.tenantId, s.reportId); // add SN-B blank, preserve SN-A, v2
        return s;
      });
      expect(methodSnap.child?.version).toBe(2);
      expect(methodSnap.child?.members.map((m) => m.serial)).toEqual([
        'SN-A',
        'SN-B',
      ]);
      expect(
        methodSnap.child?.members.find((m) => m.serial === 'SN-A')?.preserved,
      ).toBe(true);
      expect(
        methodSnap.child?.members.find((m) => m.serial === 'SN-B')?.preserved,
      ).toBe(false);
    });

    it('S6 — set shrinks ⇒ departed serial deleted, survivor preserved, version++', async () => {
      const { methodSnap } = await proveEquivalent('S6', async (sync) => {
        const s = await seedReworkScenario({
          reworkSerials: ['SN-A', 'SN-B'],
          reportNumber: 'RPT-100',
        });
        await sync(s.tenantId, s.reportId); // SN-A, SN-B (blank)
        await markChildRowInspected(s.reportId, 'SN-A'); // SN-A carries data
        await setEmi(s.reportId, 'SN-B', SerialDisposition.PASS); // SN-B leaves set
        await sync(s.tenantId, s.reportId); // delete SN-B row, preserve SN-A, v2
        return s;
      });
      expect(methodSnap.child?.version).toBe(2);
      expect(methodSnap.child?.members.map((m) => m.serial)).toEqual(['SN-A']);
      expect(
        methodSnap.child?.members.find((m) => m.serial === 'SN-A')?.preserved,
      ).toBe(true);
    });

    it('S7 — set unchanged, re-sync ⇒ unconditional version bump on BOTH paths', async () => {
      const { methodSnap } = await proveEquivalent('S7', async (sync) => {
        const s = await seedReworkScenario({
          reworkSerials: ['SN-A'],
          reportNumber: 'RPT-100',
        });
        await sync(s.tenantId, s.reportId); // v1
        await sync(s.tenantId, s.reportId); // v2 (unconditional bump)
        return s;
      });
      expect(methodSnap.child?.version).toBe(2);
      expect(methodSnap.child?.members.map((m) => m.serial)).toEqual(['SN-A']);
    });

    it('S8 — parent with no reportNumber ⇒ child created with null reportNumber', async () => {
      const { methodSnap } = await proveEquivalent('S8', async (sync) => {
        const s = await seedReworkScenario({
          reworkSerials: ['SN-A'],
          reportNumber: null,
        });
        await sync(s.tenantId, s.reportId);
        return s;
      });
      expect(methodSnap.child).not.toBeNull();
      expect(methodSnap.child?.reportNumber).toBeNull();
    });

    it('S9 — false/0-is-valid coherence: falsy-but-present non-REWORK serial does NOT match', async () => {
      const { methodSnap } = await proveEquivalent('S9', async (sync) => {
        const s = await seedReworkScenario({
          reworkSerials: ['SN-A'],
          passSerials: ['SN-P'],
          // Present but falsy emiResult: strict `=== REWORK` must exclude it. A truthiness
          // shortcut would (wrongly) treat it as "no disposition" — same non-match here, but
          // the point is both paths compare by value, not truthiness.
          rawSerials: [{ serial: 'SN-F', emiResult: '' }],
          reportNumber: 'RPT-100',
        });
        await sync(s.tenantId, s.reportId);
        return s;
      });
      expect(methodSnap.child?.members.map((m) => m.serial)).toEqual(['SN-A']);
    });
  });

  // =========================================================================
  // STEP 4 — the MUTATION GUARD. Proves the 9-scenario proof is NON-VACUOUS: every
  // deliberate corruption of the rule the interpreter consumes (NOT the method, seed, or
  // diff) must make diffReworkSnapshots(method, interpreter) go non-empty on the named
  // dimension, or the interpreter must THROW where fail-loud is required. A corruption that
  // leaves all snapshots equivalent would mean the proof never actually read the rule — a
  // vacuous-proof FINDING, surfaced by a failing test, never papered over.
  //
  // The method side is untouched throughout (it takes no rule — it IS the oracle). Only the
  // interpreter's `rules` input is corrupted, via a deep clone of the real definition rule.
  // =========================================================================
  describe('mutation guard — proof non-vacuity [guard]', () => {
    let interpreter: ReworkRulesInterpreter;
    beforeAll(() => {
      interpreter = new ReworkRulesInterpreter(prisma);
    });

    type Sync = (tenantId: string, reportId: string) => Promise<unknown>;

    /** Shape of the single rule in the definition — for typed, `any`-free mutation. */
    interface RawRule {
      when: { field: string; op: string; value: unknown };
      then: {
        action: string;
        childType: string;
        membership: string;
        reportNumberSuffix?: string;
        forbidChildDisposition?: string[];
      };
    }

    /** Deep-clone the REAL rules array and corrupt its one rule. */
    function corrupt(mut: (rule: RawRule) => void): unknown {
      const rules = JSON.parse(JSON.stringify(DRILL_PIPE_RULES)) as RawRule[];
      mut(rules[0]);
      return rules;
    }

    // Scenario 4 (some rework + no child) is the workhorse: it exercises match set,
    // childType, and reportNumber in one shot, so most mutations surface there.
    async function buildS4(sync: Sync) {
      const s = await seedReworkScenario({
        reworkSerials: ['SN-A', 'SN-B'],
        passSerials: ['SN-C'],
        reportNumber: 'RPT-100',
      });
      await sync(s.tenantId, s.reportId);
      return s;
    }

    /** Method (real) vs interpreter (corrupted rule), each on its own fresh seed. */
    async function methodVsCorrupted(
      label: string,
      corruptedRules: unknown,
    ): Promise<string[]> {
      await resetInspectionDomain(prisma);
      const m = await buildS4((t, r) => imperativeReworkOracle(prisma, t, r));
      const methodSnap = await snapshotReworkState(prisma, m.tenantId, m.reportId);

      await resetInspectionDomain(prisma);
      const i = await buildS4((t, r) =>
        interpreter.syncFromRules(t, r, corruptedRules),
      );
      const interpSnap = await snapshotReworkState(prisma, i.tenantId, i.reportId);

      const diff = diffReworkSnapshots(methodSnap, interpSnap);
      // eslint-disable-next-line no-console
      console.log(
        `[MUTATION ${label}]` +
          `\n  method      = ${JSON.stringify(methodSnap)}` +
          `\n  interpreter = ${JSON.stringify(interpSnap)}` +
          `\n  diff = ${JSON.stringify(diff)}`,
      );
      return diff;
    }

    it('M1 — when.value REWORK→PASS ⇒ interpreter matches wrong serials (membership diff)', async () => {
      const diff = await methodVsCorrupted(
        'M1 when.value=PASS',
        corrupt((r) => {
          r.when.value = 'PASS';
        }),
      );
      // Interpreter now links the PASS serial (SN-C) and drops SN-A/SN-B.
      expect(diff.length).toBeGreaterThan(0);
      expect(diff).toEqual(
        expect.arrayContaining([
          'member SN-A: present → absent',
          'member SN-B: present → absent',
          'member SN-C: absent → present',
        ]),
      );
    });

    it('M2 — childType REWORK→SCRAP ⇒ REWORK child absent on interpreter side (existence diff)', async () => {
      const diff = await methodVsCorrupted(
        'M2 childType=SCRAP',
        corrupt((r) => {
          r.then.childType = 'SCRAP';
        }),
      );
      // Interpreter built a SCRAP child; the REWORK-filtered snapshot sees nothing.
      expect(diff).toContain('child existence: present → absent');
    });

    it('M3 — reportNumberSuffix dropped ⇒ NO throw (optional) + bare reportNumber (reportNumber diff)', async () => {
      let threw = false;
      let diff: string[] = [];
      try {
        diff = await methodVsCorrupted(
          'M3 suffix dropped',
          corrupt((r) => {
            delete r.then.reportNumberSuffix;
          }),
        );
      } catch {
        threw = true;
      }
      expect(threw).toBe(false); // suffix is optional — dropping it must NOT fail loud
      // Interpreter yields the bare parent number; method appended `_rework`.
      expect(diff).toContain('child.reportNumber: RPT-100_rework → RPT-100');
    });

    // -- Fail-loud boundary: these corruptions must THROW, not silently diverge. The throw
    //    happens in selectUpsertRule before any DB read, so a seeded report is incidental.
    async function expectInterpreterThrows(
      corruptedRules: unknown,
      messagePattern: RegExp,
    ) {
      const s = await seedReworkScenario({
        reworkSerials: ['SN-A'],
        reportNumber: 'RPT-100',
      });
      await expect(
        interpreter.syncFromRules(s.tenantId, s.reportId, corruptedRules),
      ).rejects.toThrow(messagePattern);
    }

    it('M4 — op eq→unknown ⇒ interpreter throws (fail-loud)', async () => {
      await resetInspectionDomain(prisma);
      await expectInterpreterThrows(
        corrupt((r) => {
          r.when.op = 'neq';
        }),
        /unknown op/,
      );
      // eslint-disable-next-line no-console
      console.log('[MUTATION M4 op=neq] threw as required (unknown op)');
    });

    it('M5 — membership→garbage ⇒ interpreter throws (fail-loud)', async () => {
      await resetInspectionDomain(prisma);
      await expectInterpreterThrows(
        corrupt((r) => {
          r.then.membership = 'garbage';
        }),
        /unknown membership/,
      );
      // eslint-disable-next-line no-console
      console.log('[MUTATION M5 membership=garbage] threw as required');
    });

    it('M6 — action→unknown ⇒ interpreter throws (fail-loud)', async () => {
      await resetInspectionDomain(prisma);
      await expectInterpreterThrows(
        corrupt((r) => {
          r.then.action = 'frobnicate';
        }),
        /unknown action/,
      );
      // eslint-disable-next-line no-console
      console.log('[MUTATION M6 action=frobnicate] threw as required');
    });

    it('M7 — version-bump sensitivity: a no-bump interpreter variant diverges on scenario 7', async () => {
      // Scenario 7 (unchanged re-sync, child pre-exists) — BOTH real paths bump to v2 (proven
      // green in S7). Here we model an interpreter VARIANT that omits the unconditional bump.
      // Scenario 7 hits exactly the `if (existingChild) increment` branch on the 2nd sync, so
      // reverting the single bump the real interpreter applied reproduces that variant's output
      // bit-for-bit (only the version differs). If the diff stays green, the proof's S7 pass was
      // incidental — it isn't: the version dimension fires.
      await resetInspectionDomain(prisma);
      const m = await seedReworkScenario({
        reworkSerials: ['SN-A'],
        reportNumber: 'RPT-100',
      });
      await imperativeReworkOracle(prisma, m.tenantId, m.reportId); // v1
      await imperativeReworkOracle(prisma, m.tenantId, m.reportId); // v2 (bump)
      const methodSnap = await snapshotReworkState(prisma, m.tenantId, m.reportId);

      await resetInspectionDomain(prisma);
      const i = await seedReworkScenario({
        reworkSerials: ['SN-A'],
        reportNumber: 'RPT-100',
      });
      await interpreter.syncFromRules(i.tenantId, i.reportId, DRILL_PIPE_RULES); // v1
      await interpreter.syncFromRules(i.tenantId, i.reportId, DRILL_PIPE_RULES); // v2 (bump)
      // Model the no-bump variant: undo exactly the one re-sync bump it would have skipped.
      await prisma.childReport.updateMany({
        where: {
          inspectionReportId: i.reportId,
          type: ChildReportType.REWORK,
        },
        data: { version: { decrement: 1 } },
      });
      const noBumpSnap = await snapshotReworkState(prisma, i.tenantId, i.reportId);

      const diff = diffReworkSnapshots(methodSnap, noBumpSnap);
      // eslint-disable-next-line no-console
      console.log(
        `[MUTATION M7 no-bump variant]` +
          `\n  method (real, bumps)   = ${JSON.stringify(methodSnap)}` +
          `\n  variant (skips bump)   = ${JSON.stringify(noBumpSnap)}` +
          `\n  diff = ${JSON.stringify(diff)}`,
      );
      expect(methodSnap.child?.version).toBe(2);
      expect(noBumpSnap.child?.version).toBe(1);
      // The version dimension the proof's S7 relies on fires exactly here.
      expect(diff).toContain('child.version: 2 → 1');
    });
  });

  // =========================================================================
  // STEP 5 — the WIRED GATE. These tests drive the SERVICE method (the real controller entry)
  // and vary the template's definitionJson, exercising the gate's routing after retirement:
  //
  //   (a) definitionJson NULL / no template row ⇒ the imperative body is RETIRED, so the gate
  //       now THROWS a 412 PreconditionFailedException (G1 = template present with null column,
  //       G2 = no template row at all). The new defensive contract: a report whose pinned
  //       template carries no rework rules is a server misconfiguration, not an inspector-fixable
  //       state, and the throw happens before any reconciliation (no child is created).
  //   (b) definitionJson = REAL ⇒ gate routes to the interpreter — result equals the
  //       interpreter-direct oracle, through the wired service rather than a direct call (G3/G4).
  //   (c) ROUTING DISCRIMINATOR (G5) — a populated definition whose suffix is altered to
  //       something the retired imperative body could NEVER emit forces the distinction: only a
  //       genuine route-through yields the altered reportNumber.
  // =========================================================================
  describe('wired gate — definitionJson routing [gate]', () => {
    let interpreter: ReworkRulesInterpreter;
    beforeAll(() => {
      interpreter = new ReworkRulesInterpreter(prisma);
    });

    type Sync = (tenantId: string, reportId: string) => Promise<unknown>;
    type AfterSeed = (tenantId: string, reportId: string) => Promise<void>;

    /** Overwrite one serial's body.emiResult (moves it into / out of the match set). */
    const setEmi = (reportId: string, serial: string, emiResult: unknown) =>
      prisma.serialNumber.updateMany({
        where: { inspectionReportId: reportId, serial },
        data: { inspectionData: { body: { emiResult } } as never },
      });

    /**
     * Create the Template row the seeded report pins (DRILL_PIPE_REPORT@1), carrying the given
     * definitionJson. `null` leaves the column NULL — the real pre-cutover state the gate must
     * treat as "no definition". The gate keys on tenantId_templateKey_templateVersion only, so
     * the blob/hash are incidental filler.
     */
    async function attachTemplate(
      tenantId: string,
      definitionJson: unknown | null,
    ) {
      await prisma.template.create({
        data: {
          tenantId,
          templateKey: 'DRILL_PIPE_REPORT',
          templateVersion: 1,
          status: 'ACTIVE',
          fileBlob: Buffer.from('gate-test'),
          hash: 'hash-DRILL_PIPE_REPORT',
          changeNote: 'gate-test',
          createdById: 'seed-user',
          definitionJson: (definitionJson ?? undefined) as never,
        },
      });
    }

    // Scenario builders shared by the wired-service run and the interpreter-direct oracle.
    // `afterSeed` runs after seeding and BEFORE any sync — the wired path uses it to attach
    // the template; the oracle omits it (the interpreter reads rules directly, no template).

    /** CREATE: two rework serials + no child ⇒ DRAFT v1 child, SN-A/SN-B linked. */
    async function buildCreate(sync: Sync, afterSeed?: AfterSeed) {
      const s = await seedReworkScenario({
        reworkSerials: ['SN-A', 'SN-B'],
        passSerials: ['SN-C'],
        reportNumber: 'RPT-100',
      });
      if (afterSeed) await afterSeed(s.tenantId, s.reportId);
      await sync(s.tenantId, s.reportId);
      return s;
    }

    /** DELETE: rework serial creates a DRAFT child, then leaves the set ⇒ child deleted. */
    async function buildDelete(sync: Sync, afterSeed?: AfterSeed) {
      const s = await seedReworkScenario({
        reworkSerials: ['SN-A'],
        reportNumber: 'RPT-100',
      });
      if (afterSeed) await afterSeed(s.tenantId, s.reportId);
      await sync(s.tenantId, s.reportId); // creates DRAFT child v1
      await setEmi(s.reportId, 'SN-A', SerialDisposition.PASS);
      await sync(s.tenantId, s.reportId); // empty match + DRAFT ⇒ delete
      return s;
    }

    /**
     * Run `build` through the WIRED SERVICE with the template carrying `wiredDefinition`
     * (null ⇒ imperative branch, real ⇒ interpreter branch), then run the SAME `build` through
     * the interpreter directly (real rules) on an independent seed, and assert the two snapshots
     * diff empty. Reuses the proven snapshot+diff so the gate is measured on the same dimensions.
     */
    async function proveGateEquivalent(
      label: string,
      build: (sync: Sync, afterSeed?: AfterSeed) => Promise<{
        tenantId: string;
        reportId: string;
      }>,
      wiredDefinition: unknown | null,
    ): Promise<{ wiredSnap: ReworkStateSnapshot }> {
      await resetInspectionDomain(prisma);
      const m = await build(
        (t, r) => service.syncReworkChildReport(t, r),
        (t) => attachTemplate(t, wiredDefinition),
      );
      const wiredSnap = await snapshotReworkState(prisma, m.tenantId, m.reportId);

      await resetInspectionDomain(prisma);
      const i = await build((t, r) =>
        interpreter.syncFromRules(t, r, DRILL_PIPE_RULES),
      );
      const oracleSnap = await snapshotReworkState(prisma, i.tenantId, i.reportId);

      const diff = diffReworkSnapshots(wiredSnap, oracleSnap);
      // eslint-disable-next-line no-console
      console.log(
        `[GATE ${label}]` +
          `\n  wired-service = ${JSON.stringify(wiredSnap)}` +
          `\n  interp-oracle = ${JSON.stringify(oracleSnap)}` +
          `\n  diff = ${JSON.stringify(diff)}`,
      );
      expect(diff).toEqual([]);
      return { wiredSnap };
    }

    it('G1 — definitionJson NULL (template present, null column) ⇒ service THROWS 412 (defensive contract)', async () => {
      await resetInspectionDomain(prisma);
      const s = await seedReworkScenario({
        reworkSerials: ['SN-A', 'SN-B'],
        reportNumber: 'RPT-100',
      });
      await attachTemplate(s.tenantId, null); // ACTIVE template, definitionJson NULL
      await expect(
        service.syncReworkChildReport(s.tenantId, s.reportId),
      ).rejects.toThrow(PreconditionFailedException);
      // The throw precedes any reconciliation — no REWORK child is created.
      const snap = await snapshotReworkState(prisma, s.tenantId, s.reportId);
      expect(snap.child).toBeNull();
    });

    it('G2 — no template row at all ⇒ service THROWS 412 (null definition, defensive contract)', async () => {
      await resetInspectionDomain(prisma);
      // seedReworkScenario attaches no Template ⇒ gate finds none ⇒ definition null ⇒ throw.
      const s = await seedReworkScenario({
        reworkSerials: ['SN-A'],
        reportNumber: 'RPT-100',
      });
      await expect(
        service.syncReworkChildReport(s.tenantId, s.reportId),
      ).rejects.toThrow(/no rework rules/);
      const snap = await snapshotReworkState(prisma, s.tenantId, s.reportId);
      expect(snap.child).toBeNull();
    });

    it('G3 — definitionJson populated, create ⇒ gate ROUTES to interpreter (matches oracle)', async () => {
      const { wiredSnap } = await proveGateEquivalent(
        'G3 POP create',
        buildCreate,
        DRILL_PIPE_DEFINITION,
      );
      expect(wiredSnap.child?.status).toBe(ChildReportStatus.DRAFT);
      expect(wiredSnap.child?.version).toBe(1);
      expect(wiredSnap.child?.reportNumber).toBe('RPT-100_rework');
      expect(wiredSnap.child?.members.map((m) => m.serial)).toEqual([
        'SN-A',
        'SN-B',
      ]);
    });

    it('G4 — definitionJson populated, empty-set delete ⇒ gate ROUTES to interpreter (matches oracle)', async () => {
      const { wiredSnap } = await proveGateEquivalent(
        'G4 POP delete',
        buildDelete,
        DRILL_PIPE_DEFINITION,
      );
      expect(wiredSnap.child).toBeNull();
    });

    it('G5 — routing discriminator: a populated definition with an altered suffix yields output the imperative body CANNOT produce', async () => {
      // If the gate fell through to the imperative body, reportNumber would be the hardcoded
      // `RPT-100_rework`. Only a genuine route-through reads the (altered) suffix from the
      // definition. This is the decisive proof the interpreter was actually consulted — not the
      // imperative body producing a coincidentally-equal result.
      await resetInspectionDomain(prisma);
      const s = await seedReworkScenario({
        reworkSerials: ['SN-A'],
        reportNumber: 'RPT-100',
      });
      const mutated = JSON.parse(JSON.stringify(DRILL_PIPE_DEFINITION)) as {
        rules: { then: { reportNumberSuffix?: string } }[];
      };
      mutated.rules[0].then.reportNumberSuffix = '_reworkGATE';
      await attachTemplate(s.tenantId, mutated);

      await service.syncReworkChildReport(s.tenantId, s.reportId);
      const snap = await snapshotReworkState(prisma, s.tenantId, s.reportId);
      // eslint-disable-next-line no-console
      console.log(
        `[GATE G5 discriminator] reportNumber = ${snap.child?.reportNumber} (imperative could only emit RPT-100_rework)`,
      );

      expect(snap.child).not.toBeNull();
      expect(snap.child?.reportNumber).toBe('RPT-100_reworkGATE');
    });
  });
});
