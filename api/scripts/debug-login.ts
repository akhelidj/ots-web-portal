
import * as dotenv from 'dotenv';
dotenv.config({ path: 'api/.env' });
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
    const email = 'verify-admin@ots.com';
    const password = 'password123';
    
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
        console.log('User not found');
        return;
    }
    console.log('User found:', user.email);
    console.log('Hash in DB:', user.passwordHash);
    
    const isValid = await bcrypt.compare(password, user.passwordHash);
    console.log('Password valid:', isValid);
}
main().catch(console.error).finally(() => prisma.$disconnect());
