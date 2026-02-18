import * as dotenv from 'dotenv';
dotenv.config({ path: 'api/.env' });
import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function provisionTenant(name: string, adminEmail: string, adminName: string, passwordString: string) {
  console.log(`Provisioning tenant "${name}" with admin "${adminEmail}"...`);

  // Check if exist
  const existing = await prisma.tenant.findFirst({ where: { name } });
  if (existing) {
    console.log(`Tenant "${name}" already exists. Skipping.`);
    return;
  }

  const hash = await bcrypt.hash(passwordString, 10);

  const tenant = await prisma.tenant.create({
    data: { name },
  });
  console.log(`Tenant created with ID: ${tenant.id}`);

  const user = await prisma.user.create({
      data: {
          email: adminEmail,
          name: adminName,
          passwordHash: hash,
          role: UserRole.ADMIN,
          tenantId: tenant.id
      }
  });

  console.log(`User created. ID: ${user.id}`);
}

async function main() {
  const argTenant = process.argv[2];
  const argEmail = process.argv[3];
  const argName = process.argv[4];
  const argPass = process.argv[5];

  if (argTenant && argEmail) {
      // Manual run with args
      await provisionTenant(argTenant, argEmail, argName || 'Admin', argPass || 'password123');
  } else {
      // Default / Dev Bootstrap mode
      await provisionTenant('Oilfield Tubular Services', 'admin@oilfield-tubular-services.com', 'Anis Khelidj', 'password123');
      await provisionTenant('Acme Corp', 'admin@acme.com', 'Admin User', 'password123');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
