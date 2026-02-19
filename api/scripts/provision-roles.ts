
import * as dotenv from 'dotenv';
dotenv.config({ path: 'api/.env' });
import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const tenantName = 'Oilfield Tubular Services';
  const tenant = await prisma.tenant.findFirst({ where: { name: tenantName } });
  
  if (!tenant) {
    console.error(`Tenant ${tenantName} not found. Run db:provision first.`);
    return;
  }

  const passwordHash = await bcrypt.hash('password123', 10);

  const users = [
    { email: 'receiver@ots.com', role: UserRole.RECEIVER },
    { email: 'supervisor@ots.com', role: UserRole.SUPERVISOR },
    { email: 'inspector@ots.com', role: UserRole.INSPECTOR },
    { email: 'customer@ots.com', role: UserRole.CUSTOMER },
  ];

  for (const u of users) {
    const existing = await prisma.user.findFirst({ where: { email: u.email, tenantId: tenant.id } });
    if (!existing) {
        await prisma.user.create({
            data: {
                email: u.email,
                name: u.role,
                passwordHash,
                role: u.role,
                tenantId: tenant.id
            }
        });
        console.log(`Created ${u.role}: ${u.email}`);
    } else {
        console.log(`Exists ${u.role}: ${u.email}`);
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
