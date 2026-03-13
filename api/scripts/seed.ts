import * as dotenv from 'dotenv';
dotenv.config({ path: 'api/.env' });
import { PrismaClient, UserRole, SerialDisposition, SerialApprovalStatus, InspectionReportStatus } from '@prisma/client';
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

async function provisionNobleCorporation(tenant: any, passwordString: string) {
  console.log(`\n--- Provisioning Noble Corporation for "${tenant.name}" ---`);
  const passwordHash = await bcrypt.hash(passwordString, 10);

  let customer = await prisma.customer.findFirst({ where: { name: 'Noble Corporation', tenantId: tenant.id } });
  if (!customer) {
    customer = await prisma.customer.create({
      data: {
        name: 'Noble Corporation',
        code: 'NCO',
        tenantId: tenant.id
      }
    });
    console.log(`Customer created: ${customer.name}`);
  }

  const email = 'customer@noble.com';
  let user = await prisma.user.findFirst({ where: { email, tenantId: tenant.id } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        name: 'Noble Customer',
        passwordHash,
        role: UserRole.CUSTOMER,
        tenantId: tenant.id,
        customerId: customer.id
      }
    });
    console.log(`User created: ${user.email}`);
  } else {
    user = await prisma.user.update({
      where: { id: user.id },
      data: { customerId: customer.id, passwordHash }
    });
    console.log(`User updated: ${user.email}`);
  }

  const template = await prisma.template.findFirst({ where: { tenantId: tenant.id, templateKey: 'DRILL_PIPE_REPORT' } });
  if (!template) {
    console.log("No template found, skipping report creation");
    return;
  }

  let report = await prisma.inspectionReport.findFirst({
    where: { customerId: customer.id, poNumber: 'PO-NOBLE-001', tenantId: tenant.id }
  });

  if (!report) {
    report = await prisma.inspectionReport.create({
      data: {
        poNumber: 'PO-NOBLE-001',
        status: InspectionReportStatus.IN_INSPECTION,
        tenantId: tenant.id,
        customerId: customer.id,
        templateKey: template.templateKey,
        templateVersion: template.templateVersion,
        templateHash: template.hash,
        reportNumber: 'REP-NCO-001'
      }
    });

    const sns: any[] = [];
    for (let i = 1; i <= 15; i++) {
        const isScrap = Math.random() < 0.2; // 20% chance to be SCRAP
        const disposition = isScrap ? SerialDisposition.SCRAP : SerialDisposition.PASS;
        
        sns.push({
            serial: `NCO-SN-${i.toString().padStart(3, '0')}`,
            inspectionReportId: report.id,
            tenantId: tenant.id,
            disposition: disposition,
            approvalStatus: SerialApprovalStatus.INSPECTED_DRAFT,
            inspectionData: {
              "box": {
                "minOD": "6 1/3\"",
                "condition": "OK",
                "hardBanding": "OK - FLUSHED",
                "minTongSpace": "8 1/4\"",
                "minBoxThreads": "5\"",
                "minEccShoulder": "5/8\"",
                "bevelDiameterMax": "1/6\"",
                "bevelDiameterMin": "6\"",
                "maxCounterBoreLength": "3/4\"",
                "maxCounterBoreDiameter": "5 5/16\""
              },
              "pin": {
                "maxID": "2 3/4\"",
                "minOD": "6 1/2\"",
                "condition": "SD",
                "minTongSpace": "7 3/8\"",
                "minEccShoulder": "5/8\"",
                "bevelDiameterMax": "1/16\"",
                "bevelDiameterMin": "6\"",
                "lengthPinConnMax": "3/8\"",
                "lengthPinConnMin": "4\"",
                "maxLengthPinBase": "4\""
              },
              "body": {
                "ipc": false,
                "slipArea": "ok",
                "emiResult": "PASS",
                "bentJoints": true,
                "odDecrease": "OK",
                "corrosionIn": true,
                "corrosionOut": true,
                "wallRemaining": "0.362\""
              },
              "final": {
                "isC2": false,
                "isNew": false,
                "isScrap": isScrap,
                "isPremium": false,
                "disposition": disposition
              },
              "remarks": ""
            }
        });
    }

    await prisma.serialNumber.createMany({
        data: sns
    });
    console.log(`Created report ${report.reportNumber} with 15 serial numbers`);
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
      await provisionNobleCorporation(t1, 'password123');
      
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
