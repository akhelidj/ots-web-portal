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
 * The authority under test is the imperative syncReworkChildReport
 * (child-reports.service.ts:24-151) — the SOLE authority today (the definition's
 * `rules` block is dormant JSON with no consumer). So the proof is "an interpreter
 * reproduces this one method", not "two live paths agree"; there is nothing to diff
 * until the interpreter exists. This step proves the diff harness itself is honest.
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
import {
  ChildReportStatus,
  ChildReportType,
  SerialDisposition,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FilesService } from '../files/files.service';
import { ChildReportsService } from './child-reports.service';
import {
  resetInspectionDomain,
  seedTenant,
  seedInspectionReport,
} from '../../../test/seed-helpers';

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
    // it without onModuleInit (which reconciles the attachment storage dir).
    service = new ChildReportsService(prisma, new FilesService(prisma));
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
      await service.syncReworkChildReport(tenantId, reportId);
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

    await service.syncReworkChildReport(tenantId, reportId);
    const s1 = await snapshotReworkState(prisma, tenantId, reportId);
    await service.syncReworkChildReport(tenantId, reportId); // identical inputs
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
      await service.syncReworkChildReport(tenantId, reportId);
      return snapshotReworkState(prisma, tenantId, reportId);
    })();

    await resetInspectionDomain(prisma);

    const absent = await (async () => {
      // No REWORK serials ⇒ syncReworkChildReport creates no child.
      const { tenantId, reportId } = await seedReworkScenario({
        reworkSerials: [],
        passSerials: ['SN-A', 'SN-B'],
        reportNumber: 'RPT-100',
      });
      await service.syncReworkChildReport(tenantId, reportId);
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
});
