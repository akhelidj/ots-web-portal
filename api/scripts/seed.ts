import * as dotenv from 'dotenv';
dotenv.config({ path: 'api/.env' });
import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const prisma = new PrismaClient();

async function provisionTenant(name: string, adminEmail: string, adminName: string, passwordString: string) {
  console.log(`\n--- Provisioning tenant "${name}" ---`);

  // Check if exist
  let tenant = await prisma.tenant.findFirst({ where: { name } });
  if (tenant) {
    console.log(`Tenant "${name}" already exists (ID: ${tenant.id}).`);
  } else {
    tenant = await prisma.tenant.create({
      data: { name },
    });
    console.log(`Tenant created with ID: ${tenant.id}`);
  }

  const hash = await bcrypt.hash(passwordString, 10);

  let user = await prisma.user.findUnique({
    where: {
      tenantId_email: {
        tenantId: tenant.id,
        email: adminEmail
      }
    }
  });

  if (user) {
    console.log(`User "${adminEmail}" already exists. Updating password to ensure access.`);
    user = await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: hash }
    });
  } else {
    user = await prisma.user.create({
      data: {
        email: adminEmail,
        name: adminName,
        passwordHash: hash,
        role: UserRole.ADMIN,
        tenantId: tenant.id
      }
    });
    console.log(`Admin user created. ID: ${user.id}`);
  }

  // Provision initial template
  const templateKey = 'DRILL_PIPE_REPORT';
  const existingTemplate = await prisma.template.findFirst({
    where: { tenantId: tenant.id, templateKey, status: 'ACTIVE' }
  });

  if (!existingTemplate) {
    console.log(`No active template found for ${templateKey}. Provisioning one...`);
    const filePath = path.join(__dirname, 'valid-template.xlsx');
    if (fs.existsSync(filePath)) {
      const fileBuffer = fs.readFileSync(filePath);
      const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
      
      await prisma.template.create({
        data: {
          tenantId: tenant.id,
          templateKey,
          templateVersion: 1,
          status: 'ACTIVE',
          fileBlob: fileBuffer,
          hash: fileHash,
          changeNote: 'Initial automated provision',
          createdById: user.id
        }
      });
      console.log(`Template ${templateKey} v1 provisioned successfully.`);
    } else {
      console.warn(`Template file not found at ${filePath}. Skipping template provision.`);
    }
  } else {
    console.log(`Active template for ${templateKey} already exists.`);
  }

  return tenant;
}

async function provisionRolesForTenant(tenant: any, domain: string, passwordString: string) {
  console.log(`\n--- Provisioning roles for "${tenant.name}" (@${domain}) ---`);
  const passwordHash = await bcrypt.hash(passwordString, 10);

  const users = [
    { email: `receiver@${domain}`, role: UserRole.RECEIVER, name: 'Charlie (Receiver)' },
    { email: `supervisor@${domain}`, role: UserRole.SUPERVISOR, name: 'Alice (Supervisor)' },
    { email: `inspector@${domain}`, role: UserRole.INSPECTOR, name: 'Bob (Inspector)' },
    { email: `customer@${domain}`, role: UserRole.CUSTOMER, name: 'Dave (Customer)' },
  ];

  for (const u of users) {
    const existing = await prisma.user.findFirst({ where: { email: u.email, tenantId: tenant.id } });
    if (!existing) {
        await prisma.user.create({
            data: {
                email: u.email,
                name: u.name,
                passwordHash,
                role: u.role,
                tenantId: tenant.id
            }
        });
        console.log(`Created ${u.role}: ${u.email}`);
    } else {
        await prisma.user.update({
            where: { id: existing.id },
            data: { name: u.name, passwordHash } // update names and passwords to ensure consistent state
        });
        console.log(`Updated ${u.role}: ${u.email} (Name: ${u.name})`);
    }
  }
}

async function main() {
  const argTenant = process.argv[2];
  const argEmail = process.argv[3];
  const argName = process.argv[4];
  const argPass = process.argv[5];

  if (argTenant && argEmail) {
      // Manual run with args
      const t = await provisionTenant(argTenant, argEmail, argName || 'Admin', argPass || 'password123');
      const domainMatch = argEmail.match(/@(.+)$/);
      const domain = domainMatch ? domainMatch[1] : 'example.com';
      await provisionRolesForTenant(t, domain, argPass || 'password123');
  } else {
      // Default / Dev Bootstrap mode
      const t1 = await provisionTenant('Oilfield Tubular Services', 'admin@oilfield-tubular-services.com', 'Anis Khelidj', 'password123');
      await provisionRolesForTenant(t1, 'oilfield-tubular-services.com', 'password123');
      
      const t2 = await provisionTenant('Acme Corp', 'admin@acme.com', 'Admin User', 'password123');
      await provisionRolesForTenant(t2, 'acme.com', 'password123');
      
      console.log('\n--- Seed completed successfully! ---');
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
