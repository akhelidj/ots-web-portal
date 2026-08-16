/**
 * REWORK rules interpreter — STEP 2 of the definition-driven REWORK rules consumer.
 * Contract: docs/adr/0010-rework-rules-consumer.md + docs/architecture/rework-rules-consumer.md.
 *
 * WHAT THIS IS:
 * A standalone, definition-driven consumer that reads `definition.rules` and reproduces
 * `ChildReportsService.syncReworkChildReport` (child-reports.service.ts:24-151) EXACTLY —
 * the imperative method it mirrors stays live as the equivalence baseline and is NOT
 * modified here. This unit is deliberately NOT wired into any live call path; it exists to
 * be judged by the equivalence harness (rework-rules-consumer.equivalence.integration.spec.ts)
 * before the hardcoded path is retired.
 *
 * ASYMMETRY (ADR-0007): this interpreter drives the PARENT-side trigger only — a parent
 * serial whose `body.emiResult` equals the rule value is ACCEPTED and creates the child. It
 * does NOT touch the child-side REWORK rejection guard (a separate method at
 * child-reports.service.ts:264/306); that guard is unchanged and remains authoritative.
 *
 * FIXED SEMANTICS OWNED BY THE ACTION NAME (ADR-0010, sub-decision 1): the reconciliation
 * mechanics (draft-delete vs non-draft-empty, blank-create vs preserve-existing, version-bump
 * timing) are intrinsic to `upsertChildReport` and reproduced from the method verbatim; the
 * definition declares only what varies (the `when` predicate, `childType`, `membership`,
 * `reportNumberSuffix`, `forbidChildDisposition`).
 *
 * FAIL LOUD (ADR-0010, sub-decision 2): unknown `action`, unknown `op`, malformed/absent
 * `when.field` or `when.value`, unknown `childType`, unknown `membership`, or an otherwise
 * malformed rule throws — no fallback to the legacy method. Rule selection: zero
 * `upsertChildReport` rules is a valid no-op (this tool type has no rework children); two or
 * more fail loud (multi-rule semantics are deferred — design open question 1).
 */
import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ChildReportStatus, ChildReportType, Prisma } from '@prisma/client';
import { InspectionData } from '../common/inspection-data.types';

// Allow-lists — the only tokens this interpreter understands. Anything outside them is an
// authoring error and fails loud (consistent with the export computed-resolver allow-list).
const KNOWN_ACTIONS = new Set(['upsertChildReport']);
const KNOWN_OPS = new Set(['eq']);
const KNOWN_MEMBERSHIP = new Set(['allItemsMatching']);

/** A single, validated `upsertChildReport` rule. `value` is compared with strict `===`. */
interface ParsedUpsertRule {
  when: { field: string; op: 'eq'; value: unknown };
  childType: ChildReportType;
  membership: 'allItemsMatching';
  /** '' when the rule omits it — an omitted suffix yields NO suffix, not a throw. */
  reportNumberSuffix: string;
}

/**
 * Resolve a dotted path (e.g. `body.emiResult`) against a JSON value, leniently: a missing
 * intermediate resolves to `undefined` rather than throwing. This mirrors the method's
 * optional chaining (`data.body?.emiResult`) exactly, so a serial that simply lacks the
 * field is a NON-match, not an error. (Structural validity of the path string — non-empty —
 * is enforced at parse time; this standalone unit has no field registry to validate against,
 * so "unresolvable when.field" here means a malformed rule, not an absent per-serial value.)
 */
function resolvePath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const segment of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[segment];
  }
  return cur;
}

/**
 * Validate one raw rule object into a ParsedUpsertRule, or throw. Every rule must carry a
 * KNOWN action (so a rule with any other action fails loud rather than being silently
 * skipped); since `upsertChildReport` is the only known action today, every rule that passes
 * validation is an upsertChildReport rule.
 */
function parseUpsertRule(raw: unknown): ParsedUpsertRule {
  if (raw == null || typeof raw !== 'object') {
    throw new BadRequestException('rework rules: malformed rule (not an object)');
  }
  const rule = raw as Record<string, unknown>;

  const then = rule.then;
  if (then == null || typeof then !== 'object') {
    throw new BadRequestException('rework rules: malformed rule (missing "then")');
  }
  const thenObj = then as Record<string, unknown>;

  const action = thenObj.action;
  if (typeof action !== 'string' || !KNOWN_ACTIONS.has(action)) {
    throw new BadRequestException(
      `rework rules: unknown action "${String(action)}"`,
    );
  }

  const when = rule.when;
  if (when == null || typeof when !== 'object') {
    throw new BadRequestException('rework rules: malformed rule (missing "when")');
  }
  const whenObj = when as Record<string, unknown>;

  if (typeof whenObj.field !== 'string' || whenObj.field.length === 0) {
    throw new BadRequestException(
      'rework rules: unknown/unresolvable when.field',
    );
  }
  if (typeof whenObj.op !== 'string' || !KNOWN_OPS.has(whenObj.op)) {
    throw new BadRequestException(
      `rework rules: unknown op "${String(whenObj.op)}"`,
    );
  }
  // A rule must state a value to compare against; a missing value would make absent-field
  // serials match under `undefined === undefined`, which is never intended.
  if (whenObj.value === undefined) {
    throw new BadRequestException('rework rules: malformed rule (missing when.value)');
  }

  const childTypeRaw = thenObj.childType;
  if (
    typeof childTypeRaw !== 'string' ||
    !Object.values(ChildReportType).includes(childTypeRaw as ChildReportType)
  ) {
    throw new BadRequestException(
      `rework rules: unknown childType "${String(childTypeRaw)}"`,
    );
  }

  const membership = thenObj.membership;
  if (typeof membership !== 'string' || !KNOWN_MEMBERSHIP.has(membership)) {
    throw new BadRequestException(
      `rework rules: unknown membership "${String(membership)}"`,
    );
  }

  const suffixRaw = thenObj.reportNumberSuffix;
  if (suffixRaw !== undefined && typeof suffixRaw !== 'string') {
    throw new BadRequestException(
      'rework rules: reportNumberSuffix must be a string when present',
    );
  }

  return {
    when: { field: whenObj.field, op: 'eq', value: whenObj.value },
    childType: childTypeRaw as ChildReportType,
    membership: 'allItemsMatching',
    reportNumberSuffix: suffixRaw ?? '',
  };
}

/**
 * Select the single `upsertChildReport` rule from `definition.rules`, or return null when
 * there is none. Throws on 2+ (design open question 1). Every rule is validated, so an
 * unknown-action rule fails loud even if another valid rule is present.
 */
function selectUpsertRule(rules: unknown): ParsedUpsertRule | null {
  if (!Array.isArray(rules)) {
    throw new BadRequestException(
      'rework rules: definition.rules must be an array',
    );
  }
  const upserts = rules.map(parseUpsertRule);
  if (upserts.length === 0) return null;
  if (upserts.length > 1) {
    throw new BadRequestException(
      `rework rules: ${upserts.length} upsertChildReport rules found; multi-rule not supported`,
    );
  }
  return upserts[0] ?? null; // length === 1 here; `?? null` satisfies noUncheckedIndexedAccess
}

@Injectable()
export class ReworkRulesInterpreter {
  constructor(private prisma: PrismaService) {}

  /**
   * Definition-driven analogue of ChildReportsService.syncReworkChildReport. Given the
   * `definition.rules` array, executes the sole `upsertChildReport` rule against the report's
   * serials, reproducing the method's DB effects exactly. Returns the mapped child (or null
   * on the no-op / delete branches), matching the method's return contract.
   */
  async syncFromRules(
    tenantId: string,
    inspectionReportId: string,
    rules: unknown,
  ) {
    const rule = selectUpsertRule(rules);
    // Zero upsertChildReport rules → this tool type has no rework children: valid no-op.
    if (!rule) return null;

    const report = await this.prisma.inspectionReport.findFirst({
      where: { id: inspectionReportId, tenantId },
      include: {
        serialNumbers: true,
        // Parameterized by the rule's childType (the method hardcodes REWORK).
        childReports: { where: { type: rule.childType } },
      },
    });

    if (!report) {
      throw new NotFoundException('Inspection Report not found');
    }

    // Match set: serials whose when.field path `eq`-compares to when.value. Strict === means
    // a falsy-but-present value that is not the target (e.g. PASS, 0, false) does NOT match.
    const matchSerials = report.serialNumbers.filter((sn) => {
      const actual = resolvePath(sn.inspectionData, rule.when.field);
      return actual === rule.when.value; // op: 'eq'
    });

    const existingChild = report.childReports[0];

    if (matchSerials.length === 0) {
      if (existingChild) {
        if (existingChild.status === ChildReportStatus.DRAFT) {
          await this.prisma.$transaction([
            this.prisma.childReportSerialNumber.deleteMany({
              where: { childReportId: existingChild.id },
            }),
            this.prisma.childReport.delete({ where: { id: existingChild.id } }),
          ]);
          return null;
        } else {
          const [, updated] = await this.prisma.$transaction([
            this.prisma.childReportSerialNumber.deleteMany({
              where: { childReportId: existingChild.id },
            }),
            this.prisma.childReport.update({
              where: { id: existingChild.id },
              data: { version: { increment: 1 } },
              include: {
                attachments: true,
                serialNumbers: { include: { serialNumber: true } },
              },
            }),
          ]);
          return this.mapChildReportResponse(updated);
        }
      }
      return null;
    }

    let crId: string;
    if (existingChild) {
      crId = existingChild.id;
    } else {
      let generatedChildReportNumber: string | undefined = undefined;
      // Suffix synthesized only when the parent HAS a reportNumber. An omitted
      // reportNumberSuffix yields the bare parent number (no suffix), not a throw.
      if (report.reportNumber) {
        generatedChildReportNumber = `${report.reportNumber}${rule.reportNumberSuffix}`;
      }
      const newCr = await this.prisma.childReport.create({
        data: {
          tenantId,
          inspectionReportId,
          reportNumber: generatedChildReportNumber,
          type: rule.childType,
          status: ChildReportStatus.DRAFT,
          version: 1,
        },
      });
      crId = newCr.id;
    }

    await this.prisma.$transaction(async (tx) => {
      const existingRows = await tx.childReportSerialNumber.findMany({
        where: { childReportId: crId },
      });
      const existingMap = new Map(
        existingRows.map((r) => [r.serialNumberId, r]),
      );

      const matchSnIds = new Set(matchSerials.map((sn) => sn.id));

      // Delete rows whose serial left the match set.
      const toDelete = existingRows.filter(
        (r) => !matchSnIds.has(r.serialNumberId),
      );
      if (toDelete.length > 0) {
        await tx.childReportSerialNumber.deleteMany({
          where: { id: { in: toDelete.map((r) => r.id) } },
        });
      }

      // Create newly-matching rows BLANK (inspectionData/disposition intentionally omitted);
      // already-existing matching rows are left untouched (data preserved).
      const toCreate = matchSerials.filter((sn) => !existingMap.has(sn.id));
      if (toCreate.length > 0) {
        await tx.childReportSerialNumber.createMany({
          data: toCreate.map((sn) => ({
            childReportId: crId,
            serialNumberId: sn.id,
          })),
        });
      }

      // Version bumps whenever the child pre-existed — unconditionally, on every re-sync,
      // regardless of whether membership changed. This is the documented non-idempotency the
      // harness surfaced; it is reproduced deliberately, not "improved".
      if (existingChild) {
        await tx.childReport.update({
          where: { id: crId },
          data: { version: { increment: 1 } },
        });
      }
    });

    const result = await this.prisma.childReport.findUnique({
      where: { id: crId },
      include: {
        attachments: true,
        serialNumbers: { include: { serialNumber: true } },
      },
    });
    return this.mapChildReportResponse(result);
  }

  /**
   * Response mapping — reproduced from ChildReportsService.mapChildReportResponse so this
   * consumer returns the same shape as the method it replaced. This duplication is
   * INTENTIONAL and does NOT converge automatically now that the imperative rework body is
   * retired: the service still keeps its own mapChildReportResponse alive for 4 other callers
   * (getChildReports, getChildReportById, updateChildReport, updateChildReportSerialNumber).
   * Collapsing the two copies onto one shared helper is a SEPARATE extract-to-shared-helper
   * refactor, deliberately out of scope for this retirement.
   */
  private mapChildReportResponse(
    cr: Prisma.ChildReportGetPayload<{
      include: {
        attachments: true;
        serialNumbers: { include: { serialNumber: true } };
      };
    }> | null,
  ) {
    if (!cr) return cr;
    return {
      ...cr,
      attachmentCount: cr.attachments.length,
      serialNumbers: cr.serialNumbers
        ? cr.serialNumbers.map((sn) => ({
            id: sn.serialNumberId,
            serial: sn.serialNumber?.serial || '',
            inspectionData: sn.inspectionData as InspectionData | null,
            disposition: sn.disposition,
            approvalStatus: sn.approvalStatus,
          }))
        : [],
    };
  }
}
