
import * as dotenv from 'dotenv';
dotenv.config({ path: 'api/.env' });
import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
    const email = 'admin@oilfield-tubular-services.com';
    const password = 'password123';
    const hash = await bcrypt.hash(password, 10);
    
    console.log(`Upserting admin user for ${email}...`);
    
    const tenant = await prisma.tenant.findFirst({ where: { name: 'Oilfield Tubular Services' } });
    if (!tenant) {
        console.error('Tenant "Oilfield Tubular Services" not found!');
        process.exit(1);
    }
    
    const user = await prisma.user.upsert({
        where: { email },
        update: { passwordHash: hash },
        create: {
            email,
            name: 'Anis Khelidj',
            passwordHash: hash,
            role: UserRole.ADMIN,
            tenantId: tenant.id
        }
    });
    
    console.log(`Admin user upserted. ID: ${user.id}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
