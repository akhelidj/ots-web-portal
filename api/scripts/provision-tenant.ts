import * as dotenv from 'dotenv';
dotenv.config({ path: 'api/.env' });
import { PrismaClient, UserRole } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const tenantName = process.argv[2] || 'OTS Tenant';
  const adminEmail = process.argv[3] || 'admin@oilfield-tubular-services.com';

  console.log(`Provisioning tenant "${tenantName}" with admin "${adminEmail}"...`);

  const tenant = await prisma.tenant.create({
    data: {
      name: tenantName,
      users: {
        create: {
          email: adminEmail,
          role: UserRole.ADMIN,
        },
      },
    },
    include: {
      users: true,
    },
  });

  console.log('Tenant provisioned successfully:');
  console.log(JSON.stringify(tenant, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
