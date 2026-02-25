import * as dotenv from 'dotenv';
dotenv.config({ path: 'api/.env' });
import { PrismaClient, UserRole } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.user.updateMany({
    where: { email: 'inspector@ots.com' },
    data: { name: 'Bob (Inspector)' }
  });
  await prisma.user.updateMany({
    where: { email: 'supervisor@ots.com' },
    data: { name: 'Alice (Supervisor)' }
  });
  await prisma.user.updateMany({
    where: { email: 'receiver@ots.com' },
    data: { name: 'Charlie (Receiver)' }
  });
  await prisma.user.updateMany({
    where: { email: 'customer@ots.com' },
    data: { name: 'Dave (Customer)' }
  });
  console.log('User names updated!');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
