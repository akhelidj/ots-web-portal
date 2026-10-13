/**
 * Pure rewrite of a stored definition that still carries legacy SUPERVISOR-signer
 * `signature` fields onto the `supervisorSignature` system role (ADR-0012). Used by
 * `api/scripts/migrate-supervisor-signature-role.ts`; kept here so it is unit-tested.
 */

import { createHash } from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { referencedTokens } from '../template/definition-validator';
import type { CandidateDefinition } from '../template/definition-authoring.types';
import { SUPERVISOR_SIGNATURE_SLOT as ROLE } from './signature-slots';

interface Field {
  key?: string;
  type?: string;
  signer?: string;
  role?: string;
  [k: string]: unknown;
}
interface ExportEntry {
  token: string;
  computed?: string;
  signature?: string;
  [k: string]: unknown;
}
export interface Definition {
  fields: Field[];
  export: { global: ExportEntry[]; [k: string]: unknown };
  [k: string]: unknown;
}

const isLegacy = (f: Field): f is Field & { key: string } =>
  f?.type === 'signature' && f.signer === 'SUPERVISOR' && !!f.key;

const slotOf = (key: string): string => `field:${key}`;

/** Pure: the migrated definition + the legacy slots it replaces (null → nothing to do). */
export function migrateDefinition(
  def: Definition,
): { next: Definition; slots: string[] } | null {
  const legacy = (def.fields ?? []).filter(isLegacy);
  if (legacy.length === 0) return null;

  const roleBound = (def.export?.global ?? []).some((e) => e.computed === ROLE);
  const roleFieldTaken = (def.fields ?? []).some((f) => f.role === ROLE);
  const promoteKey = roleBound || roleFieldTaken ? null : legacy[0]?.key ?? null;

  const fields: Field[] = [];
  for (const f of def.fields) {
    if (!isLegacy(f)) {
      fields.push(f);
    } else if (f.key === promoteKey) {
      const { signer: _signer, ...rest } = f;
      fields.push({ ...rest, type: 'text', role: ROLE });
    }
    // other legacy fields: dropped — their export entry is re-pointed below.
  }

  const legacyKeys = new Set(legacy.map((f) => f.key));
  const global = def.export.global.map((e): ExportEntry => {
    const key = e.signature?.startsWith('field:')
      ? e.signature.slice('field:'.length)
      : undefined;
    if (!key || !legacyKeys.has(key)) return e;
    const { signature: _s, ...rest } = e;
    return key === promoteKey
      ? { ...rest, computed: ROLE }
      : { ...rest, signature: ROLE };
  });

  return {
    next: { ...def, fields, export: { ...def.export, global } },
    slots: legacy.map((f) => slotOf(f.key)),
  };
}

const REASON =
  'Migrate legacy SUPERVISOR signature field to the supervisorSignature system role';

/** Same token-set signature the definition service records (sorted, de-duplicated). */
function tokenSetHash(def: Definition): string {
  let tokens: string[] = [];
  try {
    tokens = [
      ...new Set(referencedTokens(def as unknown as CandidateDefinition)),
    ].sort();
  } catch {
    tokens = [];
  }
  return createHash('sha256').update(JSON.stringify(tokens)).digest('hex');
}

export async function migrateLegacySupervisorTemplates(
  prisma: PrismaClient,
  opts: { apply: boolean; log?: (m: string) => void },
): Promise<{ migrated: number }> {
  const { apply } = opts;
  const log = opts.log ?? (() => undefined);

  const templates = await prisma.template.findMany({
    where: { definitionJson: { not: Prisma.DbNull } },
  });

  let migrated = 0;
  for (const t of templates) {
    const plan = migrateDefinition(t.definitionJson as unknown as Definition);
    if (!plan) continue;

    const rows = await prisma.reportSignature.findMany({
      where: {
        tenantId: t.tenantId,
        slot: { in: plan.slots },
        inspectionReport: {
          templateKey: t.templateKey,
          templateVersion: t.templateVersion,
        },
      },
      orderBy: { signedAt: 'asc' },
    });
    log(
      `${t.templateKey} v${t.templateVersion} (${t.tenantId}): replace ${plan.slots.join(', ')}; ` +
        `${rows.length} frozen signature row(s) to copy to "${ROLE}"`,
    );
    if (!apply) continue;

    await prisma.$transaction(async (tx) => {
      const fresh = await tx.template.findUniqueOrThrow({ where: { id: t.id } });
      const again = migrateDefinition(fresh.definitionJson as unknown as Definition);
      if (!again) return; // someone migrated it meanwhile
      const prior = fresh.definitionJson as unknown as Definition;

      const last = await tx.templateDefinitionRevision.findFirst({
        where: { templateId: t.id },
        orderBy: { revisionNumber: 'desc' },
        select: { revisionNumber: true },
      });
      await tx.templateDefinitionRevision.create({
        data: {
          templateId: t.id,
          revisionNumber: (last?.revisionNumber ?? 0) + 1,
          definitionJson: prior as unknown as Prisma.InputJsonValue,
          tokenSetHash: tokenSetHash(prior),
          tokensChanged: tokenSetHash(prior) !== tokenSetHash(again.next),
          revisedById: t.createdById,
          revisionReason: REASON,
          tenantId: t.tenantId,
        },
      });
      await tx.template.update({
        where: { id: t.id },
        data: { definitionJson: again.next as unknown as Prisma.InputJsonValue },
      });

      for (const r of rows) {
        const exists = await tx.reportSignature.findFirst({
          where: {
            tenantId: r.tenantId,
            inspectionReportId: r.inspectionReportId,
            slot: ROLE,
            revisionNumber: r.revisionNumber,
          },
          select: { id: true },
        });
        if (exists) continue;
        await tx.reportSignature.create({
          data: {
            tenantId: r.tenantId,
            inspectionReportId: r.inspectionReportId,
            slot: ROLE,
            signedById: r.signedById,
            storageKey: r.storageKey,
            hash: r.hash,
            signedAt: r.signedAt,
            revisionNumber: r.revisionNumber,
          },
        });
      }
    });
    migrated++;
  }

  return { migrated };
}

