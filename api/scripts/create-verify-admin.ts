
import * as dotenv from 'dotenv';
dotenv.config({ path: 'api/.env' });
import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
    const email = 'verify-admin@ots.com';
    const password = 'password123';
    const hash = await bcrypt.hash(password, 10);
    
    const tenant = await prisma.tenant.findFirst({ where: { name: 'Oilfield Tubular Services' } });
    if (!tenant) throw new Error('Tenant not found');

    // Upsert user handling composite unique
    const user = await prisma.user.upsert({
        where: { 
            tenantId_email: {
                tenantId: tenant.id,
                email: email
            }
        },
        update: {
            passwordHash: hash,
            name: 'Verify Admin',
            role: UserRole.ADMIN,
        },
        create: {
            email,
            name: 'Verify Admin',
            passwordHash: hash,
            role: UserRole.ADMIN,
            tenantId: tenant.id
        }
    });
    console.log(`Created verify-admin: ${user.id}`);
}
main().catch(console.error).finally(() => prisma.$disconnect());
