/**
 * Shared seed helpers for API integration specs (run against the ots_test DB).
 *
 * Factored out of the create-path spec so the create-path, workflow, and upcoming
 * revision-engine specs all agree on valid Tenant/Customer/Template row shapes
 * (e.g. Template requires fileBlob/hash/changeNote/createdById). Per-spec table
 * RESET is intentionally kept inline in each spec, since which tables a spec must
 * clear differs by spec — only the seeding is shared here.
 */
import { PrismaService } from '../src/app/prisma/prisma.service';

export function seedTenant(prisma: PrismaService, name = 'F2 test tenant') {
  return prisma.tenant.create({ data: { name } });
}

export function seedCustomer(prisma: PrismaService, tenantId: string) {
  return prisma.customer.create({
    data: { tenantId, name: 'Acme Drilling', code: 'ACME' },
  });
}

export function seedActiveTemplate(
  prisma: PrismaService,
  tenantId: string,
  templateKey: string,
) {
  return prisma.template.create({
    data: {
      tenantId,
      templateKey,
      templateVersion: 1,
      status: 'ACTIVE',
      fileBlob: Buffer.from(`template-blob-${templateKey}`),
      hash: `hash-${templateKey}`,
      changeNote: 'seed',
      createdById: 'seed-user',
    },
  });
}
