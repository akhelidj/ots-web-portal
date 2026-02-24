import * as dotenv from 'dotenv';
dotenv.config({ path: 'api/.env' });
import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function provisionTenant(name: string, adminEmail: string, adminName: string, passwordString: string) {
  console.log(`Provisioning tenant "${name}" with admin "${adminEmail}"...`);

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
    console.log(`User created. ID: ${user.id}`);
  }

  // Provision initial template
  const templateKey = 'DRILL_PIPE_REPORT';
  const existingTemplate = await prisma.template.findFirst({
    where: { tenantId: tenant.id, templateKey, status: 'ACTIVE' }
  });

  if (!existingTemplate) {
    console.log(`No active template found for ${templateKey}. Provisioning one...`);
    const fs = require('fs');
    const path = require('path');
    const crypto = require('crypto');
    
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
