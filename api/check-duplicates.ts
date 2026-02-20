import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function run() {
  const customers = await prisma.customer.findMany();
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const c of customers) {
    const key = `${c.tenantId}-${c.name}`;
    if (seen.has(key)) duplicates.push(key);
    seen.add(key);
  }
  if (duplicates.length > 0) {
    console.error('Found duplicates:', duplicates);
    process.exit(1);
  } else {
    console.log('No duplicates found. Safe to migrate.');
  }
}
run().finally(() => prisma.$disconnect());
